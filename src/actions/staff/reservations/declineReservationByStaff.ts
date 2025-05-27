
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
  
  const VOIDED_CANCELLED_STATUS_VAL = TRANSACTION_LIFECYCLE_STATUS.VOIDED_CANCELLED; // 6
  const NOT_ACCEPTED_STATUS_VAL = TRANSACTION_IS_ACCEPTED_STATUS.NOT_ACCEPTED; // 1
  const PENDING_BRANCH_ACCEPTANCE_STATUS_VAL = TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE; // 4
  const PENDING_IS_ACCEPTED_STATUS_VAL = TRANSACTION_IS_ACCEPTED_STATUS.PENDING; // 3

  if (
    typeof VOIDED_CANCELLED_STATUS_VAL === 'undefined' ||
    typeof NOT_ACCEPTED_STATUS_VAL === 'undefined' ||
    typeof PENDING_BRANCH_ACCEPTANCE_STATUS_VAL === 'undefined' ||
    typeof PENDING_IS_ACCEPTED_STATUS_VAL === 'undefined'
  ) {
    const errorMessage = "Server configuration error: Critical status constants are missing or undefined in declineReservationByStaff.";
    console.error('[declineReservationByStaff] CRITICAL ERROR:', errorMessage);
    return { success: false, message: errorMessage };
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    // Fetch client_name for logging before update
    const txDetailsRes = await client.query(
        'SELECT client_name FROM transactions WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND status::INTEGER = $4 AND is_accepted = $5',
        [transactionId, tenantId, branchId, PENDING_BRANCH_ACCEPTANCE_STATUS_VAL, PENDING_IS_ACCEPTED_STATUS_VAL]
    );

    if (txDetailsRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Reservation not found, already processed, or not in a state pending branch acceptance." };
    }
    const clientName = txDetailsRes.rows[0].client_name;


    const updateQuery = `
      UPDATE transactions
      SET
        status = $1,
        is_accepted = $2,
        declined_by_user_id = $3,
        updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $4 AND tenant_id = $5 AND branch_id = $6 
        AND status::INTEGER = $7 -- Expecting PENDING_BRANCH_ACCEPTANCE (4)
        AND is_accepted = $8 -- Expecting PENDING (3)
      RETURNING *;
    `;

    const res = await client.query(updateQuery, [
      VOIDED_CANCELLED_STATUS_VAL.toString(), // $1
      NOT_ACCEPTED_STATUS_VAL, // $2
      staffUserId, // $3
      transactionId, // $4
      tenantId, // $5
      branchId, // $6
      PENDING_BRANCH_ACCEPTANCE_STATUS_VAL, // $7
      PENDING_IS_ACCEPTED_STATUS_VAL // $8
    ]);

    if (res.rowCount === 0) { // Should not happen if preliminary check passed, but good to have
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to decline reservation. It might have been updated by another process." };
    }

    try {
      await logActivity({
        tenant_id: tenantId,
        branch_id: branchId,
        actor_user_id: staffUserId,
        action_type: 'STAFF_DECLINED_ADMIN_RESERVATION',
        description: `Staff (ID: ${staffUserId}) declined admin-created reservation for '${clientName}' (Transaction ID: ${transactionId}).`,
        target_entity_type: 'Transaction',
        target_entity_id: transactionId.toString(),
        details: { client_name: clientName, new_status: VOIDED_CANCELLED_STATUS_VAL, new_is_accepted: NOT_ACCEPTED_STATUS_VAL }
      }, client);
    } catch (logError: any) {
       console.error('[declineReservationByStaff] Failed to log activity (inside main transaction), but continuing. Error:', logError.message, logError.stack);
    }

    await client.query('COMMIT');
    const updatedTransactionRow = res.rows[0];
    return {
      success: true,
      message: "Reservation declined successfully.",
      updatedTransaction: {
        ...updatedTransactionRow,
        status: Number(updatedTransactionRow.status),
        is_paid: Number(updatedTransactionRow.is_paid),
        is_accepted: Number(updatedTransactionRow.is_accepted),
        is_admin_created: Number(updatedTransactionRow.is_admin_created),
      } as Transaction
    };

  } catch (dbError: any) {
    if (client) {
        try { await client.query('ROLLBACK'); } catch (rbError) { console.error('[declineReservationByStaff] Error during rollback:', rbError); }
    }
    console.error('[declineReservationByStaff DB Error]', dbError);
    return { success: false, message: `Database error: ${dbError.message || String(dbError)}` };
  } finally {
    if (client) {
        client.release();
    }
  }
}
