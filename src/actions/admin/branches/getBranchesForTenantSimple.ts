
"use server";

import pg from 'pg';
// Configure pg to return numeric types as numbers instead of strings
pg.types.setTypeParser(20, (val) => parseInt(val, 10)); // int8
pg.types.setTypeParser(21, (val) => parseInt(val, 10)); // int2
pg.types.setTypeParser(23, (val) => parseInt(val, 10)); // int4
pg.types.setTypeParser(1700, (val) => parseFloat(val)); // numeric

// Configure pg to return timestamp without timezone as strings
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE

import { Pool } from 'pg';
import type { SimpleBranch } from '@/lib/types';
import { HOTEL_ENTITY_STATUS } from '../../../lib/constants'; // Adjusted path

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/branches/getBranchesForTenantSimple action', err);
});

export async function getBranchesForTenantSimple(tenantId: number): Promise<SimpleBranch[]> {
  if (!tenantId) {
    return [];
  }
  if (typeof HOTEL_ENTITY_STATUS?.ACTIVE === 'undefined') {
    console.error('[getBranchesForTenantSimple] CRITICAL ERROR: HOTEL_ENTITY_STATUS.ACTIVE is undefined.');
    throw new Error('Server configuration error for fetching branches.');
  }
  const client = await pool.connect();
  try {
    const query = `
      SELECT id, branch_name
      FROM tenant_branch
      WHERE tenant_id = $1 AND status = $2
      ORDER BY branch_name;
    `;
    const res = await client.query(query, [tenantId, HOTEL_ENTITY_STATUS.ACTIVE]);
    return res.rows.map(row => ({
        id: Number(row.id),
        branch_name: String(row.branch_name),
    })) as SimpleBranch[];
  } catch (error) {
    console.error('[getBranchesForTenantSimple DB Error]', error);
    throw new Error(`Database error while fetching branches for tenant ${tenantId}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}
