
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
import { TRANSACTION_IS_ACCEPTED_STATUS, TRANSACTION_LIFECYCLE_STATUS } from '../../../lib/constants';
import { logActivity } from '../../activityLogger';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('[declineReservationByStaff Pool Error] Unexpected error on idle client:', err);
});

export async function declineReservationByStaff(
  transactionId: number,
  tenantId: number,
  branchId: number,
  staffUserId: number
): Promise<{ success: boolean; message?: string; updatedTransaction?: Transaction }> {
  console.log('[declineReservationByStaff] Action started. TxID:', transactionId, 'TenantID:', tenantId, 'BranchID:', branchId, 'StaffID:', staffUserId);

  const VOIDED_CANCELLED_DB_STATUS = TRANSACTION_LIFECYCLE_STATUS.VOIDED_CANCELLED; // This is 6
  const NOT_ACCEPTED_DB_IS_ACCEPTED_STATUS = TRANSACTION_IS_ACCEPTED_STATUS.NOT_ACCEPTED; // This is 1
  const PENDING_BRANCH_ACCEPTANCE_DB_STATUS = TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE; // This is 4
  const PENDING_DB_IS_ACCEPTED_STATUS = TRANSACTION_IS_ACCEPTED_STATUS.PENDING; // This is 3

  if (
    typeof VOIDED_CANCELLED_DB_STATUS === 'undefined' ||
    typeof NOT_ACCEPTED_DB_IS_ACCEPTED_STATUS === 'undefined' ||
    typeof PENDING_BRANCH_ACCEPTANCE_DB_STATUS === 'undefined' ||
    typeof PENDING_DB_IS_ACCEPTED_STATUS === 'undefined'
  ) {
    const errorMessage = "Server configuration error: Critical status constants are missing or undefined in declineReservationByStaff.";
    console.error('[declineReservationByStaff] CRITICAL ERROR on constants:', errorMessage);
    return { success: false, message: errorMessage };
  }
   if (!staffUserId || staffUserId <= 0) {
    console.error("[declineReservationByStaff] Invalid staffUserId:", staffUserId);
    return { success: false, message: "Invalid staff user ID." };
  }

  let client: pg.PoolClient | undefined;
  try {
    client = await pool.connect();
    console.log('[declineReservationByStaff] Database client connected.');

    // Pre-Update Check
    console.log(`[declineReservationByStaff] Pre-checking transaction ${transactionId} state...`);
    const PRE_CHECK_SQL = 'SELECT client_name, status, is_accepted FROM transactions WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 FOR UPDATE';
    const preCheckRes = await client.query(PRE_CHECK_SQL, [transactionId, tenantId, branchId]);

    if (preCheckRes.rows.length === 0) {
      console.warn(`[declineReservationByStaff] Pre-check: Transaction ${transactionId} not found for tenant ${tenantId}, branch ${branchId}.`);
      if (client) await client.query('ROLLBACK');
      return { success: false, message: "Reservation not found for this branch." };
    }
    const { client_name: clientName, status: currentDbStatusStr, is_accepted: currentDbIsAcceptedNum } = preCheckRes.rows[0];
    const currentDbStatus = Number(currentDbStatusStr);
    const currentDbIsAccepted = Number(currentDbIsAcceptedNum);

    console.log(`[declineReservationByStaff] Pre-check: Current DB status for Tx ${transactionId}: ${currentDbStatus}, is_accepted: ${currentDbIsAccepted}`);

    if (currentDbStatus !== PENDING_BRANCH_ACCEPTANCE_DB_STATUS || currentDbIsAccepted !== PENDING_DB_IS_ACCEPTED_STATUS) {
      console.warn(`[declineReservationByStaff] Transaction ${transactionId} is not in the correct state to be declined by branch. Expected status ${PENDING_BRANCH_ACCEPTANCE_DB_STATUS} and is_accepted ${PENDING_DB_IS_ACCEPTED_STATUS}.`);
      if (client) await client.query('ROLLBACK');
      return { success: false, message: "Reservation is not in a state pending branch acceptance or has already been processed." };
    }

    console.log('[declineReservationByStaff] Attempting to BEGIN transaction...');
    await client.query('BEGIN');
    console.log('[declineReservationByStaff] Transaction BEGUN.');

    const UPDATE_SQL = `
      UPDATE transactions
      SET
        status = $1, -- Target: VOIDED_CANCELLED ('6')
        is_accepted = $2, -- Target: NOT_ACCEPTED (1)
        declined_by_user_id = $3,
        updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $4 AND tenant_id = $5 AND branch_id = $6
        AND status::INTEGER = $7 -- Current: PENDING_BRANCH_ACCEPTANCE ('4')
        AND is_accepted = $8 -- Current: PENDING (3)
      RETURNING *;
    `;
    const queryParams = [
      VOIDED_CANCELLED_DB_STATUS.toString(), // $1
      NOT_ACCEPTED_DB_IS_ACCEPTED_STATUS,    // $2
      staffUserId,                           // $3
      transactionId,                         // $4
      tenantId,                              // $5
      branchId,                              // $6
      PENDING_BRANCH_ACCEPTANCE_DB_STATUS,   // $7
      PENDING_DB_IS_ACCEPTED_STATUS          // $8
    ];

    console.log('[declineReservationByStaff] Executing UPDATE query with params:', JSON.stringify(queryParams));
    const res = await client.query(UPDATE_SQL, queryParams);
    console.log('[declineReservationByStaff] UPDATE query executed. Row count:', res.rowCount);

    if (res.rowCount === 0) {
      await client.query('ROLLBACK');
      console.warn('[declineReservationByStaff] Rollback: UPDATE affected 0 rows. Transaction state might have changed or IDs mismatch.');
      return { success: false, message: "Failed to decline reservation. It might have been processed by another user or its state changed." };
    }

    const updatedTransactionRow = res.rows[0];
    console.log('[declineReservationByStaff] Transaction updated in DB:', JSON.stringify(updatedTransactionRow));

    try {
      console.log('[declineReservationByStaff] Attempting to log activity...');
      await logActivity({
        tenant_id: tenantId,
        branch_id: branchId,
        actor_user_id: staffUserId,
        action_type: 'STAFF_DECLINED_ADMIN_RESERVATION',
        description: `Staff (ID: ${staffUserId}) declined admin-created reservation for '${clientName}' (Transaction ID: ${transactionId}).`,
        target_entity_type: 'Transaction',
        target_entity_id: transactionId.toString(),
        details: { client_name: clientName, new_status: VOIDED_CANCELLED_DB_STATUS, new_is_accepted: NOT_ACCEPTED_DB_IS_ACCEPTED_STATUS }
      }, client);
      console.log('[declineReservationByStaff] Activity logged successfully.');
    } catch (logError: any) {
       console.error('[declineReservationByStaff] Failed to log activity (inside main transaction), but continuing. Error:', logError.message, logError.stack);
    }

    await client.query('COMMIT');
    console.log('[declineReservationByStaff] Transaction COMMITTED successfully.');

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
      };
    console.log('[declineReservationByStaff] Returning updated transaction:', JSON.stringify(finalUpdatedTransaction, null, 2));

    return {
      success: true,
      message: "Reservation declined successfully.",
      updatedTransaction: finalUpdatedTransaction
    };

  } catch (dbError: any) {
    if (client) {
        try {
            console.warn('[declineReservationByStaff] Error occurred during main operation. Attempting to ROLLBACK transaction...');
            await client.query('ROLLBACK');
            console.warn('[declineReservationByStaff] Transaction ROLLED BACK due to error:', dbError.message);
        } catch (rbError) {
            console.error('[declineReservationByStaff] Error during rollback:', rbError);
        }
    }
    console.error('[declineReservationByStaff DB Full Error]', dbError);
    return { success: false, message: `Database error: ${dbError.message || String(dbError)}` };
  } finally {
    if (client) {
        client.release();
        console.log('[declineReservationByStaff] Client released.');
    }
  }
}
