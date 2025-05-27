
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
import type { Transaction } from '@/lib/types';
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
  console.log('[acceptReservationByStaff] Action called with:', { transactionId, data, tenantId, branchId, staffUserId });

  if (!staffUserId || staffUserId <= 0) {
    console.error('[acceptReservationByStaff] Invalid staffUserId:', staffUserId);
    return { success: false, message: "Invalid staff user ID for accepting reservation." };
  }
  if (!transactionId || transactionId <=0) {
    console.error('[acceptReservationByStaff] Invalid transactionId:', transactionId);
    return { success: false, message: "Invalid transaction ID for accepting reservation." };
  }

  // Check if crucial constants are loaded
  const PENDING_BRANCH_ACCEPTANCE_STATUS_CONST = TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE;
  const RESERVATION_NO_ROOM_STATUS_CONST = TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM;
  const ACCEPTED_STATUS_CONST = TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED;
  const PAYMENT_UNPAID_CONST = TRANSACTION_PAYMENT_STATUS.UNPAID;
  const PAYMENT_ADVANCE_PAID_CONST = TRANSACTION_PAYMENT_STATUS.ADVANCE_PAID;
  const PAYMENT_PAID_CONST = TRANSACTION_PAYMENT_STATUS.PAID;

  console.log('[acceptReservationByStaff] Constants for query:', {
    PENDING_BRANCH_ACCEPTANCE_STATUS_CONST,
    RESERVATION_NO_ROOM_STATUS_CONST,
    ACCEPTED_STATUS_CONST,
    PAYMENT_UNPAID_CONST,
    PAYMENT_ADVANCE_PAID_CONST,
    PAYMENT_PAID_CONST
  });

  if (
    typeof PENDING_BRANCH_ACCEPTANCE_STATUS_CONST === 'undefined' ||
    typeof RESERVATION_NO_ROOM_STATUS_CONST === 'undefined' ||
    typeof ACCEPTED_STATUS_CONST === 'undefined' ||
    typeof PAYMENT_UNPAID_CONST === 'undefined' ||
    typeof PAYMENT_ADVANCE_PAID_CONST === 'undefined' ||
    typeof PAYMENT_PAID_CONST === 'undefined'
  ) {
    const errorMessage = "Server configuration error: Critical status constants are missing or undefined in acceptReservationByStaff.";
    console.error(errorMessage);
    return { success: false, message: errorMessage };
  }

  const validatedFields = transactionUnassignedUpdateSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessages = Object.values(validatedFields.error.flatten().fieldErrors).flat().join(' ');
    const errorMessage = "Invalid data: " + errorMessages;
    console.error('[acceptReservationByStaff] Validation failed:', errorMessage, validatedFields.error.flatten().fieldErrors);
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
    is_paid, // This is the form field value (0, 1, or 2 from TRANSACTION_PAYMENT_STATUS)
    tender_amount_at_checkin,
  } = validatedFields.data;

  let client;
  try {
    client = await pool.connect();
    console.log('[acceptReservationByStaff] Database client connected.');
    await client.query('BEGIN');
    console.log('[acceptReservationByStaff] Transaction BEGIN.');

    // Upon staff acceptance, the status becomes 'Reservation - No Room' ('3'), ready for room assignment.
    // is_accepted becomes 'Accepted' (2).
    const finalNewTransactionLifecycleStatus = RESERVATION_NO_ROOM_STATUS_CONST;
    const finalIsAcceptedStatus = ACCEPTED_STATUS_CONST;

    // Determine final is_paid and tender_amount based on form input
    // is_paid comes from the form (0, 1, or 2 as per TRANSACTION_PAYMENT_STATUS)
    const finalIsPaidDbValue = (is_paid === PAYMENT_ADVANCE_PAID_CONST || is_paid === PAYMENT_PAID_CONST) 
      ? is_paid 
      : PAYMENT_UNPAID_CONST;
    const finalTenderAmount = (finalIsPaidDbValue !== PAYMENT_UNPAID_CONST) ? tender_amount_at_checkin : null;

    const updateQuery = `
      UPDATE transactions
      SET
        client_name = $1,
        hotel_rate_id = $2,
        client_payment_method = $3,
        notes = $4,
        status = $5, -- Should be RESERVATION_NO_ROOM ('3')
        is_accepted = $6, -- Should be ACCEPTED (2)
        accepted_by_user_id = $7,
        reserved_check_in_datetime = $8,
        reserved_check_out_datetime = $9,
        is_paid = $10, 
        tender_amount = $11, 
        updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $12 AND tenant_id = $13 AND branch_id = $14 AND status::INTEGER = $15 -- Target PENDING_BRANCH_ACCEPTANCE ('4')
      RETURNING *;
    `;

    const queryParams = [
      client_name,
      selected_rate_id,
      client_payment_method ?? null,
      notes ?? null,
      finalNewTransactionLifecycleStatus.toString(), 
      finalIsAcceptedStatus,                 
      staffUserId,
      is_advance_reservation ? reserved_check_in_datetime : null,
      is_advance_reservation ? reserved_check_out_datetime : null,
      finalIsPaidDbValue, 
      finalTenderAmount,
      transactionId,
      tenantId,
      branchId,
      PENDING_BRANCH_ACCEPTANCE_STATUS_CONST 
    ];

    console.log('[acceptReservationByStaff] Executing UPDATE query with params:', queryParams);
    const res = await client.query(updateQuery, queryParams);
    console.log('[acceptReservationByStaff] UPDATE query executed. Row count:', res.rowCount);

    if (res.rows.length === 0) {
      await client.query('ROLLBACK');
      console.warn('[acceptReservationByStaff] Rollback: Reservation not found, already processed, or not pending acceptance when attempting update.');
      return { success: false, message: "Reservation not found, already processed, or not pending acceptance." };
    }

    const updatedTransactionRow = res.rows[0];
    console.log('[acceptReservationByStaff] Updated transaction row:', updatedTransactionRow);

    // Constructing log description carefully
    const logDescription = `Staff (ID: ${staffUserId}) accepted admin-created reservation for '${updatedTransactionRow.client_name}' (Transaction ID: ${transactionId}). Status set to ${finalNewTransactionLifecycleStatus}, Is Accepted: ${finalIsAcceptedStatus}.`;
    
    try {
        console.log('[acceptReservationByStaff] Attempting to log activity...');
        await logActivity({
            tenant_id: Number(tenantId),
            branch_id: Number(branchId),
            actor_user_id: staffUserId,
            action_type: 'STAFF_ACCEPTED_ADMIN_RESERVATION',
            description: logDescription,
            target_entity_type: 'Transaction',
            target_entity_id: transactionId.toString(),
            details: {
                client_name: updatedTransactionRow.client_name,
                new_status: finalNewTransactionLifecycleStatus,
                new_is_accepted: finalIsAcceptedStatus,
                rate_id: selected_rate_id,
                is_paid: finalIsPaidDbValue
            }
        }, client);
        console.log('[acceptReservationByStaff] Activity logged successfully.');
    } catch (logError) {
        console.error('[acceptReservationByStaff] Failed to log activity, but reservation acceptance was successful. Error:', logError);
    }

    await client.query('COMMIT');
    console.log('[acceptReservationByStaff] Transaction COMMITTED successfully.');

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

    client.release(); // Release client after all queries are done for this request
    console.log('[acceptReservationByStaff] Client released.');

    return {
      success: true,
      message: "Reservation accepted and updated. It should now appear in the unassigned list for room allocation.",
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
        console.warn('[acceptReservationByStaff] Transaction ROLLED BACK due to error:', dbError.message);
      } catch (rbError: any) {
        console.error('[acceptReservationByStaff] Error during rollback:', rbError.message, rbError.stack);
      }
    }
    console.error('[acceptReservationByStaff DB Full Error]', dbError);
    return { success: false, message: `Database error while accepting reservation: ${dbError.message || String(dbError)}` };
  } finally {
    if (client && !client.release) { // Check if client was already released, or if it was never connected (e.g. pool error)
        console.log('[acceptReservationByStaff] Ensuring client is released in outer finally.');
        client.release();
    } else if (client?.release) {
        console.log('[acceptReservationByStaff] Client likely already released or was not connected for full try block.');
    }
  }
}
