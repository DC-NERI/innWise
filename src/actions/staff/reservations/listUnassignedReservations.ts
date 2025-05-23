
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
  console.error('Unexpected error on idle client in staff/reservations/listUnassignedReservations action', err);
});

export async function listUnassignedReservations(tenantId: number, branchId: number): Promise<Transaction[]> {
  const client = await pool.connect();
  try {
    const query = `
      SELECT
        t.*,
        hrt.name as rate_name,
        hrt.price as rate_price,
        hrt.hours as rate_hours
      FROM transactions t
      LEFT JOIN hotel_rates hrt ON t.hotel_rate_id = hrt.id
      WHERE t.tenant_id = $1
        AND t.branch_id = $2
        AND t.hotel_room_id IS NULL
        AND (
          t.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.ADVANCE_PAID}
          OR t.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.ADVANCE_RESERVATION}
        )
      ORDER BY t.reserved_check_in_datetime ASC, t.created_at ASC;
    `;
    const res = await client.query(query, [tenantId, branchId]);
    return res.rows.map(row => ({
      ...row,
      status: Number(row.status),
      is_paid: Number(row.is_paid),
      is_accepted: row.is_accepted !== null ? Number(row.is_accepted) : null,
      is_admin_created: row.is_admin_created !== null ? Number(row.is_admin_created) : null,
      rate_price: row.rate_price !== null ? parseFloat(row.rate_price) : null,
      rate_hours: row.rate_hours !== null ? parseInt(row.rate_hours, 10) : null,
    }));
  } catch (error) {
    console.error('Failed to fetch unassigned reservations:', error);
    throw new Error(`Database error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}
    