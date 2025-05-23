
"use server";

import pg from 'pg';
// Configure pg to return numeric types as numbers instead of strings
pg.types.setTypeParser(20, (val) => parseInt(val, 10)); // int8
pg.types.setTypeParser(21, (val) => parseInt(val, 10)); // int2
pg.types.setTypeParser(23, (val) => parseInt(val, 10)); // int4
pg.types.setTypeParser(1700, (val) => parseFloat(val)); // numeric
// Configure pg to return timestamp without timezone as strings
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE


import { Pool } from 'pg';
import type { HotelRoom, Transaction } from '@/lib/types';
import {
  ROOM_AVAILABILITY_STATUS,
  TRANSACTION_LIFECYCLE_STATUS,
  ROOM_CLEANING_STATUS,
  ROOM_CLEANING_STATUS_TEXT,
  TRANSACTION_PAYMENT_STATUS
} from '@/lib/constants';
import { format as formatDateTime, parseISO, addHours as dateFnsAddHours, differenceInMilliseconds } from 'date-fns';
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
  const client = await pool.connect();
  const manilaTimeZone = 'Asia/Manila';

  try {
    await client.query('BEGIN');

    // Debugging: Log the initial state of the transaction
    const initialTransactionCheckQuery = `
      SELECT status, is_paid 
      FROM transactions 
      WHERE id = $1 AND tenant_id = $2 AND branch_id = $3
    `;
    const initialTransactionCheckRes = await client.query(initialTransactionCheckQuery, [transactionId, tenantId, branchId]);

    if (initialTransactionCheckRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Transaction not found for checkout." };
    }
    const initialTransactionState = initialTransactionCheckRes.rows[0];

    if (Number(initialTransactionState.status) !== TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN) {
      await client.query('ROLLBACK');
      return { 
        success: false, 
        message: `Transaction is not in 'Checked-In' state (current status: ${initialTransactionState.status}, is_paid: ${initialTransactionState.is_paid}). Cannot check out.` 
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
      LEFT JOIN hotel_rates hr ON t.hotel_rate_id = hr.id AND hr.tenant_id = t.tenant_id AND hr.branch_id = t.branch_id AND hr.status = '1'
      WHERE t.id = $1 AND t.tenant_id = $2 AND t.branch_id = $3 AND t.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN}
      FOR UPDATE;
    `;
    const transactionRes = await client.query(transactionDetailsQuery, [transactionId, tenantId, branchId]);

    if (transactionRes.rows.length === 0) {
      await client.query('ROLLBACK');
      // This message means the transaction ISN'T in '0' (Checked-In) state, or doesn't exist with that ID/tenant/branch.
      // The initial check already handles this for status, so this might be redundant or a more specific error.
      return { success: false, message: "Active transaction for this room not found, already checked out, or not in 'Checked-In' state (status '0')." };
    }
    const transaction = transactionRes.rows[0];

    // 2. Calculate checkout time, hours used, and total amount
    const checkOutTime = toZonedTime(new Date(), manilaTimeZone);
    // Ensure check_in_time is treated as a string from the DB
    const checkInTime = parseISO(String(transaction.check_in_time).replace(' ', 'T')); 

    const diffMs = differenceInMilliseconds(checkOutTime, checkInTime);
    let hoursUsed = Math.ceil(diffMs / (1000 * 60 * 60));
    if (hoursUsed <= 0) hoursUsed = 1; // Minimum 1 hour charge

    let totalAmount = parseFloat(transaction.rate_price || '0');
    const rateHours = parseInt(transaction.rate_hours || '0', 10);
    const excessHourPrice = transaction.rate_excess_hour_price ? parseFloat(transaction.rate_excess_hour_price) : null;

    if (rateHours > 0 && hoursUsed > rateHours && excessHourPrice && excessHourPrice > 0) {
      totalAmount += (hoursUsed - rateHours) * excessHourPrice;
    } else if (rateHours > 0) { // Base rate applies if within standard hours or no excess pricing
      totalAmount = parseFloat(transaction.rate_price || '0');
    } else if (rateHours === 0 && excessHourPrice && excessHourPrice > 0) { // Per hour rate
        totalAmount = hoursUsed * excessHourPrice;
    }
    // Ensure minimum charge is base rate price if stay occurred
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
        tender_amount = $4,
        client_payment_method = $5,
        is_paid = ${TRANSACTION_PAYMENT_STATUS.PAID.toString()},
        status = '${TRANSACTION_LIFECYCLE_STATUS.CHECKED_OUT.toString()}',
        check_out_by_user_id = $6,
        updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $7
      RETURNING *;
    `;
    const updatedTransactionResult = await client.query(updateTransactionQueryText, [
      formatDateTime(checkOutTime, "yyyy-MM-dd HH:mm:ssXXX", { timeZone: manilaTimeZone }),
      hoursUsed,
      totalAmount.toFixed(2),
      tenderAmountAtCheckout.toFixed(2),
      paymentMethodAtCheckout,
      staffUserId,
      transactionId
    ]);

    const updatedTransaction = updatedTransactionResult.rows[0];


    // 4. Update the room status and cleaning status
    const newCleaningStatus = ROOM_CLEANING_STATUS.INSPECTION;
    const cleaningNotes = `Room set to '${ROOM_CLEANING_STATUS_TEXT[newCleaningStatus]}' after checkout by user ID ${staffUserId}.`;

    const updateRoomQueryText = `
      UPDATE hotel_room
      SET
        is_available = ${ROOM_AVAILABILITY_STATUS.AVAILABLE},
        transaction_id = NULL,
        cleaning_status = '${newCleaningStatus.toString()}',
        cleaning_notes = $1,
        updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $2 AND tenant_id = $3 AND branch_id = $4;
    `;
    await client.query(updateRoomQueryText, [cleaningNotes, roomId, tenantId, branchId]);

    // 5. Log the cleaning status change
    const logCleaningQueryText = `
      INSERT INTO room_cleaning_logs (room_id, tenant_id, branch_id, room_cleaning_status, notes, user_id, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'));
    `;
    await client.query(logCleaningQueryText, [
      roomId,
      tenantId,
      branchId,
      newCleaningStatus.toString(),
      cleaningNotes,
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
        cleaning_notes: cleaningNotes,
      },
      transaction: {
        ...updatedTransaction,
        status: Number(updatedTransaction.status),
        is_paid: Number(updatedTransaction.is_paid),
        is_accepted: updatedTransaction.is_accepted !== null ? Number(updatedTransaction.is_accepted) : null,
        is_admin_created: updatedTransaction.is_admin_created !== null ? Number(updatedTransaction.is_admin_created) : null,
        total_amount: parseFloat(updatedTransaction.total_amount),
        tender_amount: parseFloat(updatedTransaction.tender_amount),
        // Ensure all date fields are consistently strings
        check_in_time: String(updatedTransaction.check_in_time),
        check_out_time: String(updatedTransaction.check_out_time),
        reserved_check_in_datetime: updatedTransaction.reserved_check_in_datetime ? String(updatedTransaction.reserved_check_in_datetime) : null,
        reserved_check_out_datetime: updatedTransaction.reserved_check_out_datetime ? String(updatedTransaction.reserved_check_out_datetime) : null,
        created_at: String(updatedTransaction.created_at),
        updated_at: String(updatedTransaction.updated_at),
      } as Transaction,
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[checkOutGuestAndFreeRoom DB Error]', error);
    const dbError = error as any;
    return {
      success: false,
      message: `Database error during checkout: ${dbError.message || String(dbError)}`,
    };
  } finally {
    client.release();
  }
}
