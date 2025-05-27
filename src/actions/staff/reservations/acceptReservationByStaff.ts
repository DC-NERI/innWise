
"use server";

import pg from 'pg';
// Configure pg to return numeric types as numbers
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

const UPDATE_TRANSACTION_SQL = `
  UPDATE transactions
  SET
    client_name = $1,
    hotel_rate_id = $2,
    client_payment_method = $3,
    notes = $4,
    status = $5, 
    is_accepted = $6, 
    accepted_by_user_id = $7,
    reserved_check_in_datetime = $8,
    reserved_check_out_datetime = $9,
    is_paid = $10,
    tender_amount = $11,
    updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
  WHERE id = $12 
    AND tenant_id = $13 
    AND branch_id = $14 
    AND status::INTEGER = $15 
    AND is_accepted::INTEGER = $16
  RETURNING *;
`;

export async function acceptReservationByStaff(
  transactionId: number,
  data: TransactionUnassignedUpdateData,
  tenantId: number,
  branchId: number, // This should be the target_branch_id of the notification being managed
  staffUserId: number
): Promise<{ success: boolean; message?: string; updatedTransaction?: Transaction }> {
  console.log('[acceptReservationByStaff] Action called with:', { transactionId, data, tenantId, branchId, staffUserId });

  // Critical constant checks
  const PENDING_BRANCH_ACCEPTANCE_STATUS_VAL = TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE; // 4
  const RESERVATION_NO_ROOM_STATUS_VAL = TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM; // 3 (target status)
  const ACCEPTED_STATUS_VAL = TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED; // 2 (target is_accepted)
  const PENDING_IS_ACCEPTED_STATUS_VAL = TRANSACTION_IS_ACCEPTED_STATUS.PENDING; // 3 (current is_accepted)

  if (
    typeof PENDING_BRANCH_ACCEPTANCE_STATUS_VAL === 'undefined' ||
    typeof RESERVATION_NO_ROOM_STATUS_VAL === 'undefined' ||
    typeof ACCEPTED_STATUS_VAL === 'undefined' ||
    typeof PENDING_IS_ACCEPTED_STATUS_VAL === 'undefined' ||
    typeof TRANSACTION_PAYMENT_STATUS?.UNPAID === 'undefined' ||
    typeof TRANSACTION_PAYMENT_STATUS?.PAID === 'undefined' ||
    typeof TRANSACTION_PAYMENT_STATUS?.ADVANCE_PAID === 'undefined'
  ) {
    const errorMessage = "Server configuration error: Critical status constants are missing or undefined in acceptReservationByStaff.";
    console.error(errorMessage, { PENDING_BRANCH_ACCEPTANCE_STATUS_VAL, RESERVATION_NO_ROOM_STATUS_VAL, ACCEPTED_STATUS_VAL, PENDING_IS_ACCEPTED_STATUS_VAL });
    return { success: false, message: errorMessage };
  }

  const validatedFields = transactionUnassignedUpdateSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessages = Object.values(validatedFields.error.flatten().fieldErrors).flat().join(' ');
    console.error("[acceptReservationByStaff] Validation failed:", errorMessages, validatedFields.error.flatten());
    return { success: false, message: "Invalid data: " + errorMessages };
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
    console.log('[acceptReservationByStaff] Database client connected.');
    await client.query('BEGIN');
    console.log('[acceptReservationByStaff] Transaction BEGIN.');

    const finalNewTransactionLifecycleStatus = RESERVATION_NO_ROOM_STATUS_VAL; // Always '3' upon acceptance
    const finalIsAcceptedStatus = ACCEPTED_STATUS_VAL; // '2'
    const finalIsPaidDbValue = is_paid ?? TRANSACTION_PAYMENT_STATUS.UNPAID;
    const finalTenderAmount = (finalIsPaidDbValue === TRANSACTION_PAYMENT_STATUS.UNPAID || finalIsPaidDbValue === null) ? null : tender_amount_at_checkin;

    const queryParams = [
      client_name, // $1
      selected_rate_id, // $2
      client_payment_method ?? null, // $3
      notes ?? null, // $4
      finalNewTransactionLifecycleStatus.toString(), // $5 (status '3')
      finalIsAcceptedStatus, // $6 (is_accepted 2)
      staffUserId, // $7 accepted_by_user_id
      is_advance_reservation ? reserved_check_in_datetime : null, // $8
      is_advance_reservation ? reserved_check_out_datetime : null, // $9
      finalIsPaidDbValue, // $10 is_paid (integer 0, 1, or 2)
      finalTenderAmount, // $11 tender_amount
      transactionId, // $12
      tenantId, // $13
      branchId, // $14
      PENDING_BRANCH_ACCEPTANCE_STATUS_VAL, // $15 (current status '4')
      PENDING_IS_ACCEPTED_STATUS_VAL // $16 (current is_accepted '3')
    ];
    console.log('[acceptReservationByStaff] Executing UPDATE query with params:', queryParams);
    console.log('[acceptReservationByStaff] SQL:', UPDATE_TRANSACTION_SQL);


    const res = await client.query(UPDATE_TRANSACTION_SQL, queryParams);
    console.log('[acceptReservationByStaff] UPDATE query executed. Row count:', res.rowCount);

    if (res.rowCount === 0) {
      await client.query('ROLLBACK');
      console.warn('[acceptReservationByStaff] ROLLBACK - No rows updated. Transaction not found or status/is_accepted mismatch. TxID:', transactionId, 'Expected original status:', PENDING_BRANCH_ACCEPTANCE_STATUS_VAL, 'Expected original is_accepted:', PENDING_IS_ACCEPTED_STATUS_VAL);
      return { success: false, message: "Reservation not found, already processed, or not in a state pending branch acceptance." };
    }

    const updatedTransactionRow = res.rows[0];
    console.log('[acceptReservationByStaff] Transaction updated in DB. New status:', updatedTransactionRow.status, 'New is_accepted:', updatedTransactionRow.is_accepted);

    try {
      const logDescription = `Staff (ID: ${staffUserId}) accepted admin-created reservation for '${updatedTransactionRow.client_name}' (Transaction ID: ${transactionId}). Status set to ${finalNewTransactionLifecycleStatus}, Is Accepted: ${finalIsAcceptedStatus}.`;
      console.log('[acceptReservationByStaff] Attempting to log activity:', logDescription);
      await logActivity({
        tenant_id: tenantId,
        branch_id: branchId,
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
    } catch (logError: any) {
      console.error('[acceptReservationByStaff] Failed to log activity (inside main transaction), but continuing. Error:', logError.message, logError.stack);
    }

    await client.query('COMMIT');
    console.log('[acceptReservationByStaff] Transaction COMMITTED successfully.');

    // Fetch related names for the full Transaction object to return
    let rateName = null;
    if (updatedTransactionRow.hotel_rate_id) {
      const rateRes = await client.query('SELECT name FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [updatedTransactionRow.hotel_rate_id, tenantId, branchId]);
      if (rateRes.rows.length > 0) rateName = rateRes.rows[0].name;
    }
    let roomName = null; // Not relevant here as room is not assigned yet

    const finalUpdatedTransaction: Transaction = {
      id: Number(updatedTransactionRow.id),
      tenant_id: Number(updatedTransactionRow.tenant_id),
      branch_id: Number(updatedTransactionRow.branch_id),
      hotel_room_id: updatedTransactionRow.hotel_room_id ? Number(updatedTransactionRow.hotel_room_id) : null,
      hotel_rate_id: updatedTransactionRow.hotel_rate_id ? Number(updatedTransactionRow.hotel_rate_id) : null,
      client_name: String(updatedTransactionRow.client_name),
      client_payment_method: updatedTransactionRow.client_payment_method,
      notes: updatedTransactionRow.notes,
      check_in_time: updatedTransactionRow.check_in_time,
      check_out_time: updatedTransactionRow.check_out_time,
      hours_used: updatedTransactionRow.hours_used ? Number(updatedTransactionRow.hours_used) : null,
      total_amount: updatedTransactionRow.total_amount ? parseFloat(updatedTransactionRow.total_amount) : null,
      tender_amount: updatedTransactionRow.tender_amount !== null ? parseFloat(updatedTransactionRow.tender_amount) : null,
      is_paid: updatedTransactionRow.is_paid !== null ? Number(updatedTransactionRow.is_paid) : TRANSACTION_PAYMENT_STATUS.UNPAID,
      created_by_user_id: Number(updatedTransactionRow.created_by_user_id),
      check_out_by_user_id: updatedTransactionRow.check_out_by_user_id ? Number(updatedTransactionRow.check_out_by_user_id) : null,
      accepted_by_user_id: updatedTransactionRow.accepted_by_user_id ? Number(updatedTransactionRow.accepted_by_user_id) : null,
      declined_by_user_id: updatedTransactionRow.declined_by_user_id ? Number(updatedTransactionRow.declined_by_user_id) : null,
      status: Number(updatedTransactionRow.status),
      created_at: updatedTransactionRow.created_at,
      updated_at: updatedTransactionRow.updated_at,
      reserved_check_in_datetime: updatedTransactionRow.reserved_check_in_datetime,
      reserved_check_out_datetime: updatedTransactionRow.reserved_check_out_datetime,
      is_admin_created: updatedTransactionRow.is_admin_created !== null ? Number(updatedTransactionRow.is_admin_created) : null,
      is_accepted: updatedTransactionRow.is_accepted !== null ? Number(updatedTransactionRow.is_accepted) : null,
      rate_name: rateName,
      room_name: roomName,
    };

    return {
      success: true,
      message: `Reservation for '${finalUpdatedTransaction.client_name}' accepted by branch.`,
      updatedTransaction: finalUpdatedTransaction,
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
    return { success: false, message: `Database error during reservation acceptance: ${dbError.message}` };
  } finally {
    if (client) {
      client.release();
      console.log('[acceptReservationByStaff] Client released.');
    }
  }
}

    