
"use server";

import pg from 'pg';
// Configure pg to return numeric types as numbers instead of strings
pg.types.setTypeParser(20, (val) => parseInt(val, 10)); // int8/bigint
pg.types.setTypeParser(21, (val) => parseInt(val, 10)); // int2/smallint
pg.types.setTypeParser(23, (val) => parseInt(val, 10)); // int4/integer
pg.types.setTypeParser(1700, (val) => parseFloat(val)); // numeric/decimal
// Configure pg to return timestamp without timezone as strings
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE


import { Pool } from 'pg';
import type { HotelRoom, Transaction } from '@/lib/types';
import {
  ROOM_AVAILABILITY_STATUS,
  TRANSACTION_LIFECYCLE_STATUS,
  TRANSACTION_LIFECYCLE_STATUS_TEXT,
  ROOM_CLEANING_STATUS,
  ROOM_CLEANING_STATUS_TEXT,
  TRANSACTION_PAYMENT_STATUS,
  HOTEL_ENTITY_STATUS
} from '@/lib/constants';
import { format as formatDateTime, parseISO, differenceInMilliseconds } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in staff/transactions/checkOutGuestAndFreeRoom action', err);
});

export async function checkOutGuestAndFreeRoom(
  transactionId: number,
  staffUserId: number,
  tenantId: number,
  branchId: number,
  roomId: number,
  tenderAmountAtCheckout: number,
  paymentMethodAtCheckout: string
): Promise<{ success: boolean; message?: string; updatedRoomData?: Partial<HotelRoom> & { id: number }, transaction?: Transaction }> {
  if (!staffUserId || staffUserId <= 0) {
    return { success: false, message: "Invalid staff user ID for checkout." };
  }
  if (!transactionId || !roomId) {
    return { success: false, message: "Transaction ID or Room ID missing for checkout."};
  }

  const client = await pool.connect();
  const manilaTimeZone = 'Asia/Manila';

  try {
    await client.query('BEGIN');

    // Check current status of the transaction
    const initialTransactionCheckQuery = `
      SELECT status, is_paid
      FROM transactions
      WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND hotel_room_id = $4
    `;
    const initialTransactionCheckRes = await client.query(initialTransactionCheckQuery, [transactionId, tenantId, branchId, roomId]);

    if (initialTransactionCheckRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: `Transaction (ID: ${transactionId}) not found for room ${roomId}.` };
    }
    const initialTransactionState = initialTransactionCheckRes.rows[0];
    const initialStatusNumber = Number(initialTransactionState.status);

    if (initialStatusNumber !== TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN) {
      await client.query('ROLLBACK');
      const currentStatusText = TRANSACTION_LIFECYCLE_STATUS_TEXT[initialStatusNumber as keyof typeof TRANSACTION_LIFECYCLE_STATUS_TEXT] || 'Unknown';
      const expectedStatusText = TRANSACTION_LIFECYCLE_STATUS_TEXT[TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN];
      return {
        success: false,
        message: `Transaction (ID: ${transactionId}) is not in a valid state for checkout. Current status: ${currentStatusText} (Expected: ${expectedStatusText})`,
      };
    }

    // 1. Fetch the active transaction and its rate details
    const transactionDetailsQuery = `
      SELECT
        t.*,
        hr.price as rate_price,
        hr.hours as rate_hours,
        hr.excess_hour_price as rate_excess_hour_price
      FROM transactions t
      LEFT JOIN hotel_rates hr ON t.hotel_rate_id = hr.id AND hr.tenant_id = t.tenant_id AND hr.branch_id = t.branch_id AND hr.status = '${HOTEL_ENTITY_STATUS.ACTIVE}'
      WHERE t.id = $1 AND t.tenant_id = $2 AND t.branch_id = $3 AND t.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN}
      FOR UPDATE OF t;
    `;
    const transactionRes = await client.query(transactionDetailsQuery, [transactionId, tenantId, branchId]);

    if (transactionRes.rows.length === 0) {
      await client.query('ROLLBACK');
      // This should ideally be caught by the initial check, but it's a safeguard.
      return { success: false, message: "Active transaction for checkout not found or not in 'Checked-In' state." };
    }
    const transaction = transactionRes.rows[0];

    // 2. Calculate checkout time, hours used, and total amount
    const checkOutTimeObject = toZonedTime(new Date(), manilaTimeZone);
    const checkOutTimeStringForDb = formatDateTime(checkOutTimeObject, "yyyy-MM-dd HH:mm:ssXXX", { timeZone: manilaTimeZone });

    const checkInTime = parseISO(String(transaction.check_in_time).replace(' ', 'T'));

    const diffMs = differenceInMilliseconds(checkOutTimeObject, checkInTime);
    let hoursUsed = Math.ceil(diffMs / (1000 * 60 * 60));
    if (hoursUsed <= 0) hoursUsed = 1; // Minimum 1 hour charge

    let totalAmount = parseFloat(transaction.rate_price || '0');
    const rateHours = parseInt(transaction.rate_hours || '0', 10);
    const excessHourPrice = transaction.rate_excess_hour_price ? parseFloat(transaction.rate_excess_hour_price) : null;

    if (rateHours > 0 && hoursUsed > rateHours && excessHourPrice && excessHourPrice > 0) {
      totalAmount += (hoursUsed - rateHours) * excessHourPrice;
    } else if (rateHours > 0) {
      totalAmount = parseFloat(transaction.rate_price || '0');
    } else if (rateHours === 0 && excessHourPrice && excessHourPrice > 0) {
        totalAmount = hoursUsed * excessHourPrice;
    }

    if (hoursUsed > 0 && totalAmount < parseFloat(transaction.rate_price || '0') && rateHours > 0) {
        totalAmount = parseFloat(transaction.rate_price || '0');
    }


    // 3. Update the transaction
    const updateTransactionQueryText = `
      UPDATE transactions
      SET
        check_out_time = $1,
        hours_used = $2,
        total_amount = $3,
        tender_amount = $4, -- This is the tender amount for this specific checkout operation
        client_payment_method = $5,
        is_paid = ${TRANSACTION_PAYMENT_STATUS.PAID}, -- Mark as fully paid
        status = '${TRANSACTION_LIFECYCLE_STATUS.CHECKED_OUT.toString()}', -- Mark as checked-out
        check_out_by_user_id = $6,
        updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $7
      RETURNING *;
    `;
    const updatedTransactionResult = await client.query(updateTransactionQueryText, [
      checkOutTimeStringForDb,
      hoursUsed,
      totalAmount.toFixed(2),
      tenderAmountAtCheckout.toFixed(2),
      paymentMethodAtCheckout,
      staffUserId,
      transactionId
    ]);

    const updatedTransactionRow = updatedTransactionResult.rows[0];

    // 4. Update the room status and cleaning status
    const newCleaningStatus = ROOM_CLEANING_STATUS.INSPECTION;
    const cleaningNotesForRoom = `${ROOM_CLEANING_STATUS_TEXT[newCleaningStatus]} after checkout by user ID ${staffUserId}.`;

    const updateRoomQueryText = `
      UPDATE hotel_room
      SET
        is_available = ${ROOM_AVAILABILITY_STATUS.AVAILABLE},
        transaction_id = NULL,
        cleaning_status = ${newCleaningStatus},
        cleaning_notes = $1,
        updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $2 AND tenant_id = $3 AND branch_id = $4;
    `;
    await client.query(updateRoomQueryText, [cleaningNotesForRoom, roomId, tenantId, branchId]);

    // 5. Log the cleaning status change
    const logCleaningQueryText = `
      INSERT INTO room_cleaning_logs (room_id, tenant_id, branch_id, room_cleaning_status, notes, user_id, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'));
    `;
    await client.query(logCleaningQueryText, [
      roomId,
      tenantId,
      branchId,
      newCleaningStatus,
      cleaningNotesForRoom, // Use the same note for the log
      staffUserId
    ]);

    await client.query('COMMIT');

    return {
      success: true,
      message: "Guest checked out successfully. Room is now available and marked for inspection.",
      updatedRoomData: {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.AVAILABLE,
        transaction_id: null,
        active_transaction_id: null,
        active_transaction_client_name: null,
        active_transaction_check_in_time: null,
        active_transaction_rate_name: null,
        active_transaction_rate_hours: null,
        active_transaction_lifecycle_status: null,
        cleaning_status: newCleaningStatus,
        cleaning_notes: cleaningNotesForRoom,
      },
      transaction: {
        ...updatedTransactionRow,
        status: Number(updatedTransactionRow.status),
        is_paid: Number(updatedTransactionRow.is_paid),
        is_accepted: updatedTransactionRow.is_accepted !== null ? Number(updatedTransactionRow.is_accepted) : null,
        is_admin_created: updatedTransactionRow.is_admin_created !== null ? Number(updatedTransactionRow.is_admin_created) : null,
        total_amount: parseFloat(updatedTransactionRow.total_amount),
        tender_amount: parseFloat(updatedTransactionRow.tender_amount),
        check_in_time: String(updatedTransactionRow.check_in_time),
        check_out_time: updatedTransactionRow.check_out_time ? String(updatedTransactionRow.check_out_time) : null,
        reserved_check_in_datetime: updatedTransactionRow.reserved_check_in_datetime ? String(updatedTransactionRow.reserved_check_in_datetime) : null,
        reserved_check_out_datetime: updatedTransactionRow.reserved_check_out_datetime ? String(updatedTransactionRow.reserved_check_out_datetime) : null,
        created_at: String(updatedTransactionRow.created_at),
        updated_at: String(updatedTransactionRow.updated_at),
      } as Transaction,
    };

  } catch (dbError: any) {
    await client.query('ROLLBACK');
    console.error('[checkOutGuestAndFreeRoom DB Error]', dbError);
    const errorMessage = dbError && dbError.message ? dbError.message : 'Unknown database error occurred during checkout.';
    return {
      success: false,
      message: `Database error during checkout: ${errorMessage}`,
    };
  } finally {
    client.release();
  }
}
