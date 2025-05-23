
"use server";

import pg from 'pg';
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE
pg.types.setTypeParser(20, (stringValue) => parseInt(stringValue, 10));
pg.types.setTypeParser(1700, (stringValue) => parseFloat(stringValue));

import { Pool } from 'pg';
import type { Transaction } from '@/lib/types';
import { TRANSACTION_LIFECYCLE_STATUS } from '@/lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in staff/transactions/getActiveTransactionForRoom action', err);
});

export async function getActiveTransactionForRoom(transactionId: number, tenantId: number, branchId: number): Promise<Transaction | null> {
  const client = await pool.connect();
  try {
    const query = `
      SELECT
        t.*,
        hr.room_name,
        hrt.name as rate_name,
        hrt.price as rate_price,
        hrt.hours as rate_hours,
        hrt.excess_hour_price as rate_excess_hour_price
      FROM transactions t
      LEFT JOIN hotel_room hr ON t.hotel_room_id = hr.id
      LEFT JOIN hotel_rates hrt ON t.hotel_rate_id = hrt.id
      WHERE t.id = $1
        AND t.tenant_id = $2
        AND t.branch_id = $3
        AND (
          t.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.UNPAID}
          OR t.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.ADVANCE_PAID}
          OR t.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.ADVANCE_RESERVATION}
          OR t.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE}
        )
      LIMIT 1;
    `;
    const res = await client.query(query, [transactionId, tenantId, branchId]);
    if (res.rows.length > 0) {
      const row = res.rows[0];
      return {
        ...row,
        status: Number(row.status),
        is_paid: Number(row.is_paid),
        is_accepted: row.is_accepted !== null ? Number(row.is_accepted) : null,
        is_admin_created: row.is_admin_created !== null ? Number(row.is_admin_created) : null,
        rate_price: row.rate_price !== null ? parseFloat(row.rate_price) : null,
        rate_hours: row.rate_hours !== null ? parseInt(row.rate_hours, 10) : null,
        rate_excess_hour_price: row.rate_excess_hour_price !== null ? parseFloat(row.rate_excess_hour_price) : null,
      } as Transaction;
    }
    return null;
  } catch (error) {
    console.error('[getActiveTransactionForRoom DB Error]', error);
    throw new Error(`Database error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}
