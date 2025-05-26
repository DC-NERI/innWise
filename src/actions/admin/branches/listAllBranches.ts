
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
import type { Branch } from '@/lib/types';
import { HOTEL_ENTITY_STATUS } from '../../../lib/constants'; // Adjusted path for constants

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/branches/listAllBranches action', err);
});

export async function listAllBranches(): Promise<Branch[]> {
  const client = await pool.connect();
  try {
    const query = `
      SELECT 
        tb.id, tb.tenant_id, t.tenant_name, 
        tb.branch_name, tb.branch_code, tb.branch_address, 
        tb.contact_number, tb.email_address, tb.status, 
        tb.created_at, tb.updated_at
      FROM tenant_branch tb
      JOIN tenants t ON tb.tenant_id = t.id
      ORDER BY t.tenant_name, tb.branch_name;
    `;
    // No status filter here, as SysAd might want to see all, including archived tenants' branches
    // Filtering by status ('active'/'archive') can be done client-side or via an optional status param if needed

    const res = await client.query(query);
    return res.rows.map(row => ({
      ...row,
      status: String(row.status), // Ensure status is string as per type
    })) as Branch[];
  } catch (error) {
    console.error('[listAllBranches DB Error]', error);
    throw new Error(`Database error while fetching all branches: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}
