
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
import type { User } from '@/lib/types';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/users/listAllUsers action', err);
});

export async function listAllUsers(): Promise<User[]> {
  const client = await pool.connect();
  try {
    const query = `
      SELECT 
        u.id, u.tenant_id, u.first_name, u.last_name, u.username, u.email, u.role, u.status, 
        u.created_at, u.updated_at, u.last_log_in, u.tenant_branch_id,
        t.tenant_name,
        tb.branch_name
      FROM users u
      LEFT JOIN tenants t ON u.tenant_id = t.id
      LEFT JOIN tenant_branch tb ON u.tenant_branch_id = tb.id AND u.tenant_id = tb.tenant_id
      ORDER BY 
        CASE u.role
          WHEN 'sysad' THEN 1
          WHEN 'admin' THEN 2
          WHEN 'staff' THEN 3
          WHEN 'housekeeping' THEN 4
          ELSE 5
        END,
        t.tenant_name, 
        u.last_name, u.first_name;
    `;
    const res = await client.query(query);
    return res.rows.map(row => ({
      ...row,
      id: String(row.id), 
      status: String(row.status),
      tenant_id: row.tenant_id ? Number(row.tenant_id) : null,
      tenant_branch_id: row.tenant_branch_id ? Number(row.tenant_branch_id) : null,
      last_log_in: row.last_log_in ? String(row.last_log_in) : null,
    })) as User[];
  } catch (error) {
    console.error('[listAllUsers DB Error]', error);
    throw new Error(`Database error while fetching all users: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}
