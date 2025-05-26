
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
import type { Tenant } from '@/lib/types';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/tenants/listTenants action', err);
});

export async function listTenants(): Promise<Tenant[]> {
  const client = await pool.connect();
  try {
    const query = `
      SELECT id, tenant_name, tenant_address, tenant_email, tenant_contact_info, max_branch_count, max_user_count, created_at, updated_at, status
      FROM tenants
      ORDER BY tenant_name;
    `;
    const res = await client.query(query);
    return res.rows.map(row => ({
      ...row,
      status: String(row.status), // Ensure status is string as per type
      max_branch_count: row.max_branch_count === null ? null : Number(row.max_branch_count),
      max_user_count: row.max_user_count === null ? null : Number(row.max_user_count),
    })) as Tenant[];
  } catch (error) {
    console.error('[listTenants DB Error]', error);
    throw new Error(`Database error while fetching tenants: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}
