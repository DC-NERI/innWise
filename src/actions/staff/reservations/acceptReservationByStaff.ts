
"use server";

import pg from 'pg';
// Configure pg to return numeric types as numbers
pg.types.setTypeParser(pg.types.builtins.INT2, (val: string) => parseInt(val, 10));
pg.types.setTypeParser(pg.types.builtins.INT4, (val: string) => parseInt(val, 10));
pg.types.setTypeParser(pg.types.builtins.INT8, (val: string) => parseInt(val, 10)); // bigint
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (val: string) => parseFloat(val));
// Configure pg to return timestamp without timezone as strings
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (stringValue: string) => stringValue);
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (stringValue: string) => stringValue);


import { Pool } from 'pg';
import type { Transaction } from '@/lib/types';
import { transactionUnassignedUpdateSchema, type TransactionUnassignedUpdateData } from '@/lib/schemas';
import {
  TRANSACTION_LIFECYCLE_STATUS,
  TRANSACTION_IS_ACCEPTED_STATUS,
  TRANSACTION_PAYMENT_STATUS,
  HOTEL_ENTITY_STATUS
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
  branchId: number, // This must be the target_branch_id of the reservation
  staffUserId: number
): Promise<{ success: boolean; message?: string; updatedTransaction?: Transaction }> {
  console.log(`[acceptReservationByStaff] Action started. TxID: ${transactionId}, TenantID: ${tenantId}, BranchID: ${branchId}, StaffID: ${staffUserId}`);
  console.log('[acceptReservationByStaff] Received data for update:', JSON.stringify(data, null, 2));

  // Parameter Validation
  if (!transactionId || transactionId <= 0) return { success: false, message: "Invalid Transaction ID." };
  if (!tenantId || tenantId <= 0) return { success: false, message: "Invalid Tenant ID." };
  if (!branchId || branchId <= 0) return { success: false, message: "Invalid Branch ID for acceptance." };
  if (!staffUserId || staffUserId <= 0) return { success: false, message: "Invalid Staff User ID." };

  // Constants Check and Local Assignment
  const PENDING_BRANCH_ACCEPTANCE_STATUS_INT = TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE; // 4
  const PENDING_IS_ACCEPTED_STATUS_INT = TRANSACTION_IS_ACCEPTED_STATUS.PENDING; // 3
  const TARGET_LIFECYCLE_STATUS_INT = TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM; // 3
  const TARGET_IS_ACCEPTED_STATUS_INT = TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED; // 2

  if (
    PENDING_BRANCH_ACCEPTANCE_STATUS_INT === undefined ||
    PENDING_IS_ACCEPTED_STATUS_INT === undefined ||
    TARGET_LIFECYCLE_STATUS_INT === undefined ||
    TARGET_IS_ACCEPTED_STATUS_INT === undefined ||
    TRANSACTION_PAYMENT_STATUS.UNPAID === undefined
  ) {
    const errorMessage = "Server configuration error: Critical status constants are missing or undefined in acceptReservationByStaff.";
    console.error('[acceptReservationByStaff] CRITICAL ERROR on constants:', errorMessage);
    return { success: false, message: errorMessage };
  }
  console.log(`[acceptReservationByStaff] Using constants: PENDING_BRANCH_ACCEPTANCE=${PENDING_BRANCH_ACCEPTANCE_STATUS_INT}, PENDING_IS_ACCEPTED=${PENDING_IS_ACCEPTED_STATUS_INT}, TARGET_LIFECYCLE_STATUS=${TARGET_LIFECYCLE_STATUS_INT}, TARGET_IS_ACCEPTED=${TARGET_IS_ACCEPTED_STATUS_INT}`);

  const validatedFields = transactionUnassignedUpdateSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessages = JSON.stringify(validatedFields.error.flatten().fieldErrors);
    console.warn("[acceptReservationByStaff] Validation failed:", errorMessages);
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

  const finalIsPaidDbValue = is_paid ?? TRANSACTION_PAYMENT_STATUS.UNPAID;
  const finalTenderAmount = (finalIsPaidDbValue === TRANSACTION_PAYMENT_STATUS.UNPAID || finalIsPaidDbValue === null) ? null : tender_amount_at_checkin;

  let client: pg.PoolClient | undefined;
  let updatedTransactionRow: any = null;

  try {
    client = await pool.connect();
    console.log('[acceptReservationByStaff] Database client connected.');
    await client.query('BEGIN');
    console.log(`[acceptReservationByStaff] BEGIN transaction for TxID: ${transactionId}`);

    // Pre-Update Check
    const PRE_CHECK_SQL = 'SELECT status, is_accepted FROM transactions WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 FOR UPDATE';
    console.log(`[acceptReservationByStaff] Executing PRE_CHECK_SQL for TxID ${transactionId}, TenantID ${tenantId}, BranchID ${branchId}`);
    const preCheckRes = await client.query(PRE_CHECK_SQL, [transactionId, tenantId, branchId]);

    if (preCheckRes.rows.length === 0) {
      await client.query('ROLLBACK');
      console.warn(`[acceptReservationByStaff] ROLLBACK (PRE_CHECK): Transaction ${transactionId} not found for tenant ${tenantId}, branch ${branchId}.`);
      return { success: false, message: "Reservation not found for this branch, or already processed." };
    }

    const currentDbStatus = Number(preCheckRes.rows[0].status);
    const currentDbIsAccepted = Number(preCheckRes.rows[0].is_accepted);
    console.log(`[acceptReservationByStaff] Pre-check for TxID ${transactionId}: Current DB status: ${currentDbStatus}, is_accepted: ${currentDbIsAccepted}`);

    if (currentDbStatus !== PENDING_BRANCH_ACCEPTANCE_STATUS_INT || currentDbIsAccepted !== PENDING_IS_ACCEPTED_STATUS_INT) {
      await client.query('ROLLBACK');
      console.warn(`[acceptReservationByStaff] ROLLBACK (PRE_CHECK): TxID ${transactionId} not in PENDING_BRANCH_ACCEPTANCE ('${PENDING_BRANCH_ACCEPTANCE_STATUS_INT}') and PENDING_IS_ACCEPTED ('${PENDING_IS_ACCEPTED_STATUS_INT}') state. Actual: status=${currentDbStatus}, is_accepted=${currentDbIsAccepted}.`);
      return { success: false, message: "Reservation is not in a state pending branch acceptance or has already been processed." };
    }

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
        AND is_accepted = $16
      RETURNING *;
    `;

    const queryParams = [
      client_name, // $1
      selected_rate_id, // $2
      client_payment_method ?? null, // $3
      notes ?? null, // $4
      TARGET_LIFECYCLE_STATUS_INT.toString(), // $5 Target status '3' (RESERVATION_NO_ROOM)
      TARGET_IS_ACCEPTED_STATUS_INT,         // $6 Target is_accepted 2 (ACCEPTED)
      staffUserId, // $7
      is_advance_reservation ? reserved_check_in_datetime : null, // $8
      is_advance_reservation ? reserved_check_out_datetime : null, // $9
      finalIsPaidDbValue, // $10
      finalTenderAmount, // $11
      transactionId, // $12
      tenantId, // $13
      branchId, // $14
      PENDING_BRANCH_ACCEPTANCE_STATUS_INT, // $15 Current status '4'
      PENDING_IS_ACCEPTED_STATUS_INT  // $16 Current is_accepted 3
    ];

    console.log('[acceptReservationByStaff] Executing UPDATE query with params:', JSON.stringify(queryParams.map(p => p === undefined ? null : p), null, 2));
    const res = await client.query(UPDATE_TRANSACTION_SQL, queryParams);
    console.log('[acceptReservationByStaff] UPDATE query executed. Row count:', res.rowCount);

    if (res.rowCount === 0) {
      await client.query('ROLLBACK');
      console.warn(`[acceptReservationByStaff] ROLLBACK (UPDATE): UPDATE affected 0 rows for TxID ${transactionId}. Transaction state might have changed between pre-check and update, or IDs mismatch. Expected current status '${PENDING_BRANCH_ACCEPTANCE_STATUS_INT}', is_accepted '${PENDING_IS_ACCEPTED_STATUS_INT}'.`);
      return { success: false, message: "Failed to update reservation. It might have been processed by another user or its state changed very recently." };
    }
    
    updatedTransactionRow = res.rows[0]; // Store for later use after commit
    console.log('[acceptReservationByStaff] Transaction updated in DB (pre-commit):', JSON.stringify(updatedTransactionRow, null, 2));

    await client.query('COMMIT');
    console.log(`[acceptReservationByStaff] Transaction COMMITTED successfully for TxID: ${transactionId}. New status: ${updatedTransactionRow.status}, is_accepted: ${updatedTransactionRow.is_accepted}`);

    // Ancillary operations AFTER commit
    let rateName: string | null = null;
    let ratePrice: number | null = null;
    let rateHours: number | null = null;
    let rateExcessHourPrice: number | null = null;

    if (updatedTransactionRow.hotel_rate_id) {
      // Use a new connection from the pool for this read operation
      const rateClient = await pool.connect();
      try {
        const rateRes = await rateClient.query(
          'SELECT name, price, hours, excess_hour_price FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND status = $4',
          [updatedTransactionRow.hotel_rate_id, tenantId, branchId, HOTEL_ENTITY_STATUS.ACTIVE.toString()]
        );
        if (rateRes.rows.length > 0) {
          rateName = rateRes.rows[0].name;
          ratePrice = parseFloat(rateRes.rows[0].price);
          rateHours = parseInt(rateRes.rows[0].hours, 10);
          rateExcessHourPrice = rateRes.rows[0].excess_hour_price ? parseFloat(rateRes.rows[0].excess_hour_price) : null;
        }
        console.log(`[acceptReservationByStaff] Fetched rate details post-commit for TxID ${transactionId}: Name: ${rateName}`);
      } catch (rateError) {
        console.error(`[acceptReservationByStaff] Error fetching rate details post-commit for TxID ${transactionId}:`, rateError);
        // Continue without rate details if this fails, but log it.
      } finally {
        rateClient.release();
      }
    }
    
    // Log activity AFTER successful commit of the main operation
    try {
      const logDescription = `Staff (ID: ${staffUserId}) accepted admin-created reservation for '${updatedTransactionRow.client_name}' (Transaction ID: ${transactionId}). Status set to ${TARGET_LIFECYCLE_STATUS_INT}, Is Accepted: ${TARGET_IS_ACCEPTED_STATUS_INT}.`;
      console.log(`[acceptReservationByStaff] Attempting to log activity post-commit for TxID: ${transactionId}. Description: ${logDescription}`);
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
          new_status: TARGET_LIFECYCLE_STATUS_INT,
          new_is_accepted: TARGET_IS_ACCEPTED_STATUS_INT,
          rate_id: selected_rate_id,
          is_paid: finalIsPaidDbValue
        }
      }); // logActivity uses its own connection
      console.log(`[acceptReservationByStaff] Activity logged successfully post-commit for TxID: ${transactionId}.`);
    } catch (logError: any) {
        console.error(`[acceptReservationByStaff] Failed to log activity post-commit for TxID: ${transactionId}. Error:`, logError.message, logError.stack);
        // Do not let logging failure affect the success of the main operation
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
    console.log(`[acceptReservationByStaff] Returning updated transaction for TxID ${transactionId}:`, JSON.stringify(finalUpdatedTransaction, null, 2));

    return {
      success: true,
      message: `Reservation for '${finalUpdatedTransaction.client_name}' accepted. Now ready for room assignment.`,
      updatedTransaction: finalUpdatedTransaction,
    };

  } catch (dbError: any) {
    console.error(`[acceptReservationByStaff DB Full Error for TxID: ${transactionId}]`, dbError);
    if (client) {
        try {
            await client.query('ROLLBACK');
            console.warn(`[acceptReservationByStaff] Transaction ROLLED BACK for TxID: ${transactionId} due to error: ${dbError.message}`);
        } catch (rbError: any) {
            console.error(`[acceptReservationByStaff] Error during rollback for TxID: ${transactionId}:`, rbError);
        }
    }
    return { success: false, message: `Database error during reservation acceptance: ${dbError.message}` };
  } finally {
    if (client) {
      client.release();
      console.log(`[acceptReservationByStaff] Client released for TxID: ${transactionId}`);
    }
  }
}

    