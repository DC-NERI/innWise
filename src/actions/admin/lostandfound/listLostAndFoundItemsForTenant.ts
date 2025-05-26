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
import type { LostAndFoundLog } from '@/lib/types';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/lostandfound/listLostAndFoundItemsForTenant action', err);
});

export async function listLostAndFoundItemsForTenant(tenantId: number): Promise<LostAndFoundLog[]> {
  if (!tenantId || typeof tenantId !== 'number' || tenantId <= 0) {
    console.error("[listLostAndFoundItemsForTenant] Invalid tenantId provided:", tenantId);
    return [];
  }
  const client = await pool.connect();
  try {
    const query = `
      SELECT
        laf.id, laf.tenant_id, laf.branch_id, tb.branch_name,
        laf.item AS item_name, laf.description, laf.found_location,
        laf.reported_by_user_id, u.username as reported_by_username,
        laf.status, laf.found_at, laf.updated_at, laf.claimed_at, laf.claimed_by_details, laf.disposed_details
      FROM lost_and_found_logs laf
      LEFT JOIN users u ON laf.reported_by_user_id = u.id
      LEFT JOIN tenant_branch tb ON laf.branch_id = tb.id AND laf.tenant_id = tb.tenant_id
      WHERE laf.tenant_id = $1
      ORDER BY laf.found_at DESC, laf.id DESC;
    `;
    const res = await client.query(query, [tenantId]);
    return res.rows.map(row => ({
      ...row,
      status: row.status !== null ? Number(row.status) : null, // Ensure status is number
      reported_by_user_id: row.reported_by_user_id ? Number(row.reported_by_user_id) : null,
      branch_id: row.branch_id ? Number(row.branch_id) : null,
    })) as LostAndFoundLog[];
  } catch (error) {
    console.error('[listLostAndFoundItemsForTenant DB Error]', error);
    // Instead of throwing, return empty array or an error object if preferred by frontend
    return [];
    // throw new Error(`Database error fetching lost & found items for tenant ${tenantId}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}
