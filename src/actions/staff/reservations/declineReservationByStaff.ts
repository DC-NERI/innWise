
"use server";

import pg from 'pg';
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE
pg.types.setTypeParser(20, (stringValue) => parseInt(stringValue, 10));
pg.types.setTypeParser(1700, (stringValue) => parseFloat(stringValue));

import { Pool } from 'pg';
import type { Transaction } from '@/lib/types';
import { TRANSACTION_IS_ACCEPTED_STATUS, TRANSACTION_LIFECYCLE_STATUS } from '@/lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in staff/reservations/declineReservationByStaff action', err);
});

export async function declineReservationByStaff(
  transactionId: number,
  tenantId: number,
  branchId: number,
  staffUserId: number
): Promise<{ success: boolean; message?: string; updatedTransaction?: Transaction }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const updateQuery = `
      UPDATE transactions
      SET
        status = $1,
        is_accepted = $2,
        declined_by_user_id = $3,
        updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $4 AND tenant_id = $5 AND branch_id = $6 AND status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE}
      RETURNING *;
    `;

    const res = await client.query(updateQuery, [
      TRANSACTION_LIFECYCLE_STATUS.VOIDED_CANCELLED.toString(), // $1
      TRANSACTION_IS_ACCEPTED_STATUS.NOT_ACCEPTED, // $2
      staffUserId, // $3
      transactionId, // $4
      tenantId, // $5
      branchId, // $6
    ]);

    if (res.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Reservation not found, already processed, or not pending acceptance." };
    }

    await client.query('COMMIT');
    const updatedTransaction = res.rows[0];
    return {
      success: true,
      message: "Reservation declined successfully.",
      updatedTransaction: {
        ...updatedTransaction,
        status: Number(updatedTransaction.status),
        is_paid: Number(updatedTransaction.is_paid),
        is_accepted: Number(updatedTransaction.is_accepted),
      } as Transaction
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[declineReservationByStaff DB Error]', error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}
