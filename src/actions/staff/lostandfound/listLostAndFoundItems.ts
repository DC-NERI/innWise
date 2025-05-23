
"use server";

import pg from 'pg';
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE
pg.types.setTypeParser(20, (stringValue) => parseInt(stringValue, 10));
pg.types.setTypeParser(1700, (stringValue) => parseFloat(stringValue));

import { Pool } from 'pg';
import type { LostAndFoundLog } from '@/lib/types';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in staff/lostandfound/listLostAndFoundItems action', err);
});

export async function listLostAndFoundItems(tenantId: number, branchId: number): Promise<LostAndFoundLog[]> {
  const client = await pool.connect();
  try {
    const query = `
      SELECT
        laf.id, laf.tenant_id, laf.branch_id,
        laf.item AS item_name, laf.description, laf.found_location,
        laf.reported_by_user_id, u.username as reported_by_username,
        laf.status, laf.found_at, laf.updated_at, laf.claimed_at, laf.claimed_by_details, laf.disposed_details
      FROM lost_and_found_logs laf
      LEFT JOIN users u ON laf.reported_by_user_id = u.id
      WHERE laf.tenant_id = $1 AND laf.branch_id = $2
      ORDER BY laf.found_at DESC, laf.id DESC
    `;
    const res = await client.query(query, [tenantId, branchId]);
    return res.rows.map(row => ({
      ...row,
      status: Number(row.status),
    }));
  } catch (error) {
    console.error('[listLostAndFoundItems DB Error]', error);
    throw new Error(`Database error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}
