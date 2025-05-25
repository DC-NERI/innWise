
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
import { HOTEL_ENTITY_STATUS } from '../../../lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/users/getUsersForTenant action', err);
});

export async function getUsersForTenant(tenantId: number): Promise<User[]> {
  if (!tenantId) {
    return [];
  }
  if (typeof HOTEL_ENTITY_STATUS?.ACTIVE === 'undefined') {
    console.error('[getUsersForTenant] CRITICAL ERROR: HOTEL_ENTITY_STATUS.ACTIVE is undefined.');
    throw new Error('Server configuration error for fetching users.');
  }

  const client = await pool.connect();
  try {
    const query = `
      SELECT 
        u.id, u.tenant_id, u.first_name, u.last_name, u.username, u.email, u.role, u.status, u.created_at, u.updated_at, u.last_log_in,
        t.tenant_name,
        tb.branch_name
      FROM users u
      LEFT JOIN tenants t ON u.tenant_id = t.id
      LEFT JOIN tenant_branch tb ON u.tenant_branch_id = tb.id AND u.tenant_id = tb.tenant_id
      WHERE u.tenant_id = $1 AND u.role != 'sysad'
      ORDER BY 
        CASE u.role
          WHEN 'admin' THEN 1
          WHEN 'staff' THEN 2
          WHEN 'housekeeping' THEN 3
          ELSE 4
        END,
        u.status DESC, -- Show active users first within each role group
        u.last_name, u.first_name;
    `;
    const res = await client.query(query, [tenantId]);
    return res.rows.map(row => ({
      ...row,
      id: String(row.id), 
      status: String(row.status),
      tenant_id: row.tenant_id ? Number(row.tenant_id) : null,
      tenant_branch_id: row.tenant_branch_id ? Number(row.tenant_branch_id) : null,
      last_log_in: row.last_log_in ? String(row.last_log_in) : null,
    })) as User[];
  } catch (error) {
    console.error('[getUsersForTenant DB Error]', error);
    throw new Error(`Database error while fetching users for tenant: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}
    
