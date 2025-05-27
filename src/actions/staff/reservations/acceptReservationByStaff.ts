
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
import type { Transaction, SimpleRate } from '@/lib/types';
import { transactionUnassignedUpdateSchema, TransactionUnassignedUpdateData } from '@/lib/schemas';
import {
  TRANSACTION_LIFECYCLE_STATUS,
  TRANSACTION_PAYMENT_STATUS,
  TRANSACTION_IS_ACCEPTED_STATUS
} from '../../../lib/constants';
import { logActivity } from '../../activityLogger';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('[acceptReservationByStaff Pool Error] Unexpected error on idle client:', err);
});

export async function acceptReservationByStaff(
  transactionId: number,
  data: TransactionUnassignedUpdateData,
  tenantId: number,
  branchId: number,
  staffUserId: number
): Promise<{ success: boolean; message?: string; updatedTransaction?: Transaction }> {
  if (!staffUserId || staffUserId <= 0) {
    return { success: false, message: "Invalid staff user ID." };
  }
  // Critical check for constants availability
  if (
    !TRANSACTION_LIFECYCLE_STATUS ||
    typeof TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE === 'undefined' ||
    typeof TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM === 'undefined' ||
    !TRANSACTION_PAYMENT_STATUS ||
    typeof TRANSACTION_PAYMENT_STATUS.PAID === 'undefined' ||
    typeof TRANSACTION_PAYMENT_STATUS.UNPAID === 'undefined' ||
    typeof TRANSACTION_PAYMENT_STATUS.ADVANCE_PAID === 'undefined' ||
    !TRANSACTION_IS_ACCEPTED_STATUS ||
    typeof TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED === 'undefined'
  ) {
    const errorMessage = "Server configuration error: Critical status constants are missing or undefined in acceptReservationByStaff.";
    console.error('[acceptReservationByStaff] CRITICAL ERROR:', errorMessage, {
        PENDING_BRANCH_ACCEPTANCE_is_defined: typeof TRANSACTION_LIFECYCLE_STATUS?.PENDING_BRANCH_ACCEPTANCE !== 'undefined',
        RESERVATION_NO_ROOM_is_defined: typeof TRANSACTION_LIFECYCLE_STATUS?.RESERVATION_NO_ROOM !== 'undefined',
        ACCEPTED_is_defined: typeof TRANSACTION_IS_ACCEPTED_STATUS?.ACCEPTED !== 'undefined',
    });
    return { success: false, message: errorMessage };
  }

  const validatedFields = transactionUnassignedUpdateSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessages = Object.values(validatedFields.error.flatten().fieldErrors).flat().join(' ');
    const errorMessage = "Invalid data: " + errorMessages;
    return { success: false, message: errorMessage };
  }

  const {
    client_name,
    selected_rate_id,
    client_payment_method,
    notes,
    is_advance_reservation,
    reserved_check_in_datetime,
    reserved_check_out_datetime,
    is_paid,
    tender_amount_at_checkin,
  } = validatedFields.data;

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    // Ensure we are updating a PENDING_BRANCH_ACCEPTANCE transaction
    const currentTxRes = await client.query(
      "SELECT client_name FROM transactions WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND status::INTEGER = $4",
      [transactionId, tenantId, branchId, TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE]
    );

    if (currentTxRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Reservation not found or not pending branch acceptance." };
    }

    // When staff accept, it becomes an unassigned reservation ready for room assignment.
    // Status changes to RESERVATION_NO_ROOM ('3')
    // is_accepted changes to ACCEPTED ('2')
    const newTransactionLifecycleStatus = TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM;
    const finalIsAcceptedStatus = TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED;

    // is_paid is a number (0, 1, or 2)
    const finalIsPaidStatus = is_paid ?? TRANSACTION_PAYMENT_STATUS.UNPAID;

    const updateQuery = `
      UPDATE transactions
      SET
        client_name = COALESCE($1, client_name),
        hotel_rate_id = $2,
        client_payment_method = $3,
        notes = $4,
        status = $5, -- Set to '3' (RESERVATION_NO_ROOM)
        is_accepted = $6, -- Set to 2 (ACCEPTED)
        accepted_by_user_id = $7,
        reserved_check_in_datetime = $8,
        reserved_check_out_datetime = $9,
        is_paid = $10, -- Store the payment status (0, 1, or 2)
        tender_amount = $11,
        updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $12 AND tenant_id = $13 AND branch_id = $14 AND status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE}
      RETURNING *;
    `;

    const res = await client.query(updateQuery, [
      client_name,
      selected_rate_id,
      client_payment_method ?? null,
      notes ?? null,
      newTransactionLifecycleStatus.toString(), // status '3'
      finalIsAcceptedStatus,                 // is_accepted 2 (as SMALLINT)
      staffUserId,
      is_advance_reservation ? reserved_check_in_datetime : null,
      is_advance_reservation ? reserved_check_out_datetime : null,
      finalIsPaidStatus, // is_paid number (0, 1, or 2)
      (finalIsPaidStatus === TRANSACTION_PAYMENT_STATUS.UNPAID) ? null : tender_amount_at_checkin,
      transactionId,
      tenantId,
      branchId,
    ]);

    if (res.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Reservation not found, already processed, or not pending acceptance when attempting update." };
    }

    const updatedTransactionRow = res.rows[0];

    try {
        await logActivity({
            tenant_id: Number(tenantId),
            branch_id: Number(branchId),
            actor_user_id: staffUserId,
            action_type: 'STAFF_ACCEPTED_ADMIN_RESERVATION',
            description: `Staff (ID: ${staffUserId}) accepted admin-created reservation for '${updatedTransactionRow.client_name}' (Transaction ID: ${transactionId}). Status set to ${newTransactionLifecycleStatus}.`,
            target_entity_type: 'Transaction',
            target_entity_id: transactionId.toString(),
            details: {
                client_name: updatedTransactionRow.client_name,
                new_status: newTransactionLifecycleStatus,
                new_is_accepted: finalIsAcceptedStatus,
                rate_id: selected_rate_id,
                is_paid: finalIsPaidStatus
            }
        }, client);
    } catch (logError) {
        console.error('[acceptReservationByStaff] Failed to log activity, but reservation acceptance was successful. Error:', logError);
    }

    await client.query('COMMIT');

    // Fetch related names for the returned object
    let rateName = null;
    if (updatedTransactionRow.hotel_rate_id) {
      const rateRes = await client.query('SELECT name FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [updatedTransactionRow.hotel_rate_id, tenantId, branchId]);
      if (rateRes.rows.length > 0) rateName = rateRes.rows[0].name;
    }
    let roomName = null;
    if (updatedTransactionRow.hotel_room_id) {
        const roomNameRes = await client.query('SELECT room_name FROM hotel_room WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [updatedTransactionRow.hotel_room_id, tenantId, branchId]);
        if (roomNameRes.rows.length > 0) roomName = roomNameRes.rows[0].room_name;
    }


    return {
      success: true,
      message: "Reservation accepted and updated successfully. It is now in the unassigned list for room allocation.",
      updatedTransaction: {
        id: Number(updatedTransactionRow.id),
        tenant_id: Number(updatedTransactionRow.tenant_id),
        branch_id: Number(updatedTransactionRow.branch_id),
        hotel_room_id: updatedTransactionRow.hotel_room_id ? Number(updatedTransactionRow.hotel_room_id) : null,
        hotel_rate_id: updatedTransactionRow.hotel_rate_id ? Number(updatedTransactionRow.hotel_rate_id) : null,
        client_name: String(updatedTransactionRow.client_name),
        client_payment_method: updatedTransactionRow.client_payment_method ? String(updatedTransactionRow.client_payment_method) : null,
        notes: updatedTransactionRow.notes ? String(updatedTransactionRow.notes) : null,
        check_in_time: updatedTransactionRow.check_in_time ? String(updatedTransactionRow.check_in_time) : null,
        check_out_time: updatedTransactionRow.check_out_time ? String(updatedTransactionRow.check_out_time) : null,
        hours_used: updatedTransactionRow.hours_used ? Number(updatedTransactionRow.hours_used) : null,
        total_amount: updatedTransactionRow.total_amount ? parseFloat(updatedTransactionRow.total_amount) : null,
        tender_amount: updatedTransactionRow.tender_amount ? parseFloat(updatedTransactionRow.tender_amount) : null,
        is_paid: updatedTransactionRow.is_paid !== null ? Number(updatedTransactionRow.is_paid) : null,
        created_by_user_id: Number(updatedTransactionRow.created_by_user_id),
        check_out_by_user_id: updatedTransactionRow.check_out_by_user_id ? Number(updatedTransactionRow.check_out_by_user_id) : null,
        accepted_by_user_id: updatedTransactionRow.accepted_by_user_id ? Number(updatedTransactionRow.accepted_by_user_id) : null,
        declined_by_user_id: updatedTransactionRow.declined_by_user_id ? Number(updatedTransactionRow.declined_by_user_id) : null,
        status: Number(updatedTransactionRow.status),
        created_at: String(updatedTransactionRow.created_at),
        updated_at: String(updatedTransactionRow.updated_at),
        reserved_check_in_datetime: updatedTransactionRow.reserved_check_in_datetime ? String(updatedTransactionRow.reserved_check_in_datetime) : null,
        reserved_check_out_datetime: updatedTransactionRow.reserved_check_out_datetime ? String(updatedTransactionRow.reserved_check_out_datetime) : null,
        is_admin_created: updatedTransactionRow.is_admin_created !== null ? Number(updatedTransactionRow.is_admin_created) : null,
        is_accepted: updatedTransactionRow.is_accepted !== null ? Number(updatedTransactionRow.is_accepted) : null,
        room_name: roomName,
        rate_name: rateName,
      } as Transaction
    };

  } catch (dbError: any) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rbError: any) {
        console.error('[acceptReservationByStaff] Error during rollback:', rbError.message, rbError.stack);
      }
    }
    console.error('[acceptReservationByStaff DB Error]', dbError);
    return { success: false, message: `Database error: ${dbError.message || String(dbError)}` };
  } finally {
    if (client) {
      client.release();
    }
  }
}
