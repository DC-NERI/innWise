
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
import type { Tenant } from '@/lib/types';
import { HOTEL_ENTITY_STATUS } from '@/lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/tenants/getTenantDetails action', err);
});

export async function getTenantDetails(tenantId: number): Promise<Tenant | null> {
  if (!tenantId) {
    return null;
  }
  const client = await pool.connect();
  try {
    const query = `
      SELECT id, tenant_name, tenant_address, tenant_email, tenant_contact_info, max_branch_count, max_user_count, created_at, updated_at, status
      FROM tenants
      WHERE id = $1 AND status = $2;
    `;
    const res = await client.query(query, [tenantId, HOTEL_ENTITY_STATUS.ACTIVE]);
    if (res.rows.length > 0) {
      const tenant = res.rows[0];
      return {
        ...tenant,
        status: String(tenant.status), // Ensure status is string as per type
        max_branch_count: tenant.max_branch_count === null ? null : Number(tenant.max_branch_count),
        max_user_count: tenant.max_user_count === null ? null : Number(tenant.max_user_count),
      } as Tenant;
    }
    return null;
  } catch (error) {
    console.error('[getTenantDetails DB Error]', error);
    throw new Error(`Database error while fetching tenant details: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}
