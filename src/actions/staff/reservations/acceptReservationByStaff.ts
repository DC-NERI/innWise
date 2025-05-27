
"use server";

import pg from 'pg';
// Configure pg to return numeric types as numbers
pg.types.setTypeParser(pg.types.builtins.INT2, (val: string) => parseInt(val, 10));
pg.types.setTypeParser(pg.types.builtins.INT4, (val: string) => parseInt(val, 10));
pg.types.setTypeParser(pg.types.builtins.INT8, (val: string) => parseInt(val, 10));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (val: string) => parseFloat(val));
// Configure pg to return timestamp without timezone as strings
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (stringValue: string) => stringValue);
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (stringValue: string) => stringValue);

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
  console.log('[acceptReservationByStaff] Action started. TxID:', transactionId, 'TenantID:', tenantId, 'BranchID:', branchId, 'StaffID:', staffUserId);
  console.log('[acceptReservationByStaff] Received data:', JSON.stringify(data, null, 2));

  // Define target statuses based on constants
  const PENDING_BRANCH_ACCEPTANCE_DB_STATUS = TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE; // This is '4'
  const RESERVATION_NO_ROOM_DB_STATUS = TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM; // This is '3'
  const ACCEPTED_DB_IS_ACCEPTED_STATUS = TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED; // This is 2
  const PENDING_DB_IS_ACCEPTED_STATUS = TRANSACTION_IS_ACCEPTED_STATUS.PENDING; // This is 3

  if (
    typeof PENDING_BRANCH_ACCEPTANCE_DB_STATUS === 'undefined' ||
    typeof RESERVATION_NO_ROOM_DB_STATUS === 'undefined' ||
    typeof ACCEPTED_DB_IS_ACCEPTED_STATUS === 'undefined' ||
    typeof PENDING_DB_IS_ACCEPTED_STATUS === 'undefined' ||
    typeof TRANSACTION_PAYMENT_STATUS?.UNPAID === 'undefined'
  ) {
    const errorMessage = "Server configuration error: Critical status constants are missing or undefined in acceptReservationByStaff.";
    console.error('[acceptReservationByStaff] CRITICAL ERROR on constants:', errorMessage);
    return { success: false, message: errorMessage };
  }
   if (!staffUserId || staffUserId <= 0) {
    console.error("[acceptReservationByStaff] Invalid staffUserId:", staffUserId);
    return { success: false, message: "Invalid staff user ID." };
  }


  const validatedFields = transactionUnassignedUpdateSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessages = JSON.stringify(validatedFields.error.flatten().fieldErrors);
    console.error("[acceptReservationByStaff] Validation failed:", errorMessages);
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
    is_paid, // This is a number (0, 1, or 2) from the schema
    tender_amount_at_checkin,
  } = validatedFields.data;

  let client: pg.PoolClient | undefined;
  try {
    client = await pool.connect();
    console.log('[acceptReservationByStaff] Database client connected.');

    // Pre-Update Check to ensure the transaction is in the correct state
    const PRE_CHECK_SQL = 'SELECT status, is_accepted FROM transactions WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 FOR UPDATE';
    console.log(`[acceptReservationByStaff] Executing PRE_CHECK_SQL for TxID ${transactionId}`);
    const preCheckRes = await client.query(PRE_CHECK_SQL, [transactionId, tenantId, branchId]);

    if (preCheckRes.rows.length === 0) {
      console.warn(`[acceptReservationByStaff] Pre-check: Transaction ${transactionId} not found for tenant ${tenantId}, branch ${branchId}.`);
      if (client) await client.query('ROLLBACK'); // Rollback if we started a transaction implicitly with FOR UPDATE
      return { success: false, message: "Reservation not found for this branch." };
    }

    const currentDbStatus = Number(preCheckRes.rows[0].status);
    const currentDbIsAccepted = Number(preCheckRes.rows[0].is_accepted);
    console.log(`[acceptReservationByStaff] Pre-check: Current DB status for Tx ${transactionId}: ${currentDbStatus}, is_accepted: ${currentDbIsAccepted}`);

    if (currentDbStatus !== PENDING_BRANCH_ACCEPTANCE_DB_STATUS || currentDbIsAccepted !== PENDING_DB_IS_ACCEPTED_STATUS) {
      console.warn(`[acceptReservationByStaff] Transaction ${transactionId} is not in the correct state to be accepted by branch. Expected status ${PENDING_BRANCH_ACCEPTANCE_DB_STATUS} (is ${currentDbStatus}) and is_accepted ${PENDING_DB_IS_ACCEPTED_STATUS} (is ${currentDbIsAccepted}).`);
      if (client) await client.query('ROLLBACK');
      return { success: false, message: "Reservation is not in a state pending branch acceptance or has already been processed." };
    }
    // Pre-check passed, proceed with transaction
    console.log('[acceptReservationByStaff] Attempting to BEGIN transaction...');
    await client.query('BEGIN');
    console.log('[acceptReservationByStaff] Transaction BEGUN.');


    const finalNewTransactionLifecycleStatusString = RESERVATION_NO_ROOM_DB_STATUS.toString();
    const finalIsAcceptedStatusNumber = ACCEPTED_DB_IS_ACCEPTED_STATUS;

    const finalIsPaidDbValue = is_paid ?? TRANSACTION_PAYMENT_STATUS.UNPAID;
    const finalTenderAmount = (finalIsPaidDbValue === TRANSACTION_PAYMENT_STATUS.UNPAID || finalIsPaidDbValue === null) ? null : tender_amount_at_checkin;

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
        AND status::INTEGER = $15 -- Current: PENDING_BRANCH_ACCEPTANCE ('4')
        AND is_accepted = $16 -- Current: PENDING (3)
      RETURNING *;
    `;

    const queryParams = [
      client_name, // $1
      selected_rate_id, // $2
      client_payment_method ?? null, // $3
      notes ?? null, // $4
      finalNewTransactionLifecycleStatusString, // $5 (status '3')
      finalIsAcceptedStatusNumber, // $6 (is_accepted 2)
      staffUserId, // $7 accepted_by_user_id
      is_advance_reservation ? reserved_check_in_datetime : null, // $8
      is_advance_reservation ? reserved_check_out_datetime : null, // $9
      finalIsPaidDbValue, // $10 is_paid (number 0, 1, or 2)
      finalTenderAmount, // $11 tender_amount (number or null)
      transactionId, // $12
      tenantId, // $13
      branchId, // $14
      PENDING_BRANCH_ACCEPTANCE_DB_STATUS, // $15 (current status '4')
      PENDING_DB_IS_ACCEPTED_STATUS // $16 (current is_accepted 3)
    ];

    console.log('[acceptReservationByStaff] Executing UPDATE query with params:', JSON.stringify(queryParams));
    const res = await client.query(UPDATE_TRANSACTION_SQL, queryParams);
    console.log('[acceptReservationByStaff] UPDATE query executed. Row count:', res.rowCount);

    if (res.rowCount === 0) {
      await client.query('ROLLBACK');
      console.warn('[acceptReservationByStaff] Rollback: UPDATE affected 0 rows. Transaction state might have changed or IDs mismatch.');
      return { success: false, message: "Failed to update reservation. It might have been processed by another user or its state changed." };
    }

    const updatedTransactionRow = res.rows[0];
    console.log('[acceptReservationByStaff] Transaction updated in DB:', JSON.stringify(updatedTransactionRow));

    try {
      console.log('[acceptReservationByStaff] Attempting to log activity...');
      await logActivity({
        tenant_id: tenantId,
        branch_id: branchId,
        actor_user_id: staffUserId,
        action_type: 'STAFF_ACCEPTED_ADMIN_RESERVATION',
        description: `Staff (ID: ${staffUserId}) accepted admin-created reservation for '${updatedTransactionRow.client_name}' (Transaction ID: ${transactionId}). Status set to ${finalNewTransactionLifecycleStatusString}, Is Accepted: ${finalIsAcceptedStatusNumber}.`,
        target_entity_type: 'Transaction',
        target_entity_id: transactionId.toString(),
        details: {
          client_name: updatedTransactionRow.client_name,
          new_status: finalNewTransactionLifecycleStatusString,
          new_is_accepted: finalIsAcceptedStatusNumber,
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

    let rateName = null;
    let ratePrice = null;
    let rateHours = null;
    let rateExcessHourPrice = null;

    if (updatedTransactionRow.hotel_rate_id) {
      const rateRes = await client.query('SELECT name, price, hours, excess_hour_price FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [updatedTransactionRow.hotel_rate_id, tenantId, branchId]);
      if (rateRes.rows.length > 0) {
        rateName = rateRes.rows[0].name;
        ratePrice = rateRes.rows[0].price;
        rateHours = rateRes.rows[0].hours;
        rateExcessHourPrice = rateRes.rows[0].excess_hour_price;
      }
    }

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
      is_paid: Number(updatedTransactionRow.is_paid),
      created_by_user_id: Number(updatedTransactionRow.created_by_user_id),
      check_out_by_user_id: updatedTransactionRow.check_out_by_user_id ? Number(updatedTransactionRow.check_out_by_user_id) : null,
      accepted_by_user_id: updatedTransactionRow.accepted_by_user_id ? Number(updatedTransactionRow.accepted_by_user_id) : null,
      declined_by_user_id: updatedTransactionRow.declined_by_user_id ? Number(updatedTransactionRow.declined_by_user_id) : null,
      status: Number(updatedTransactionRow.status),
      created_at: updatedTransactionRow.created_at,
      updated_at: updatedTransactionRow.updated_at,
      reserved_check_in_datetime: updatedTransactionRow.reserved_check_in_datetime,
      reserved_check_out_datetime: updatedTransactionRow.reserved_check_out_datetime,
      is_admin_created: Number(updatedTransactionRow.is_admin_created),
      is_accepted: Number(updatedTransactionRow.is_accepted),
      rate_name: rateName,
      rate_price: ratePrice,
      rate_hours: rateHours,
      rate_excess_hour_price: rateExcessHourPrice,
    };
    console.log('[acceptReservationByStaff] Returning updated transaction:', JSON.stringify(finalUpdatedTransaction, null, 2));

    return {
      success: true,
      message: `Reservation for '${finalUpdatedTransaction.client_name}' accepted by branch.`,
      updatedTransaction: finalUpdatedTransaction,
    };

  } catch (dbError: any) {
    if (client) {
      try {
        console.warn('[acceptReservationByStaff] Error occurred during main operation. Attempting to ROLLBACK transaction...');
        await client.query('ROLLBACK');
        console.warn('[acceptReservationByStaff] Transaction ROLLED BACK due to error:', dbError.message);
      } catch (rbError: any) {
        console.error('[acceptReservationByStaff] Error during rollback:', rbError.message, rbError.stack);
      }
    }
    console.error('[acceptReservationByStaff DB Full Error]', dbError);
    const errorMessage = dbError.message || String(dbError);
    return { success: false, message: `Database error during reservation acceptance: ${errorMessage}` };
  } finally {
    if (client) {
      client.release();
      console.log('[acceptReservationByStaff] Client released.');
    }
  }
}
