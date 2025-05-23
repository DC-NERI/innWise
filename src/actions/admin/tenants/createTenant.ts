
"use server";

import pg from 'pg';
pg.types.setTypeParser(1114, (stringValue) => stringValue);
pg.types.setTypeParser(1184, (stringValue) => stringValue);
pg.types.setTypeParser(20, (stringValue) => parseInt(stringValue, 10));
pg.types.setTypeParser(1700, (stringValue) => parseFloat(stringValue));

import { Pool } from 'pg';
import type { Tenant } from '@/lib/types';
import { tenantCreateSchema, TenantCreateData } from '@/lib/schemas';
import { HOTEL_ENTITY_STATUS } from '@/lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/tenants/createTenant action', err);
});

export async function createTenant(data: TenantCreateData): Promise<{ success: boolean; message?: string; tenant?: Tenant }> {
  const validatedFields = tenantCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessage = "Invalid data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
    return { success: false, message: errorMessage };
  }
  const { tenant_name, tenant_address, tenant_email, tenant_contact_info, max_branch_count, max_user_count } = validatedFields.data;
  const client = await pool.connect();
  const createTenantQuery = \`
    INSERT INTO tenants (tenant_name, tenant_address, tenant_email, tenant_contact_info, max_branch_count, max_user_count, created_at, updated_at, status)
    VALUES ($1, $2, $3, $4, $5, $6, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), $7)
    RETURNING id, tenant_name, tenant_address, tenant_email, tenant_contact_info, max_branch_count, max_user_count, created_at, updated_at, status
  \`;
  try {
    const res = await client.query(createTenantQuery,
      [tenant_name, tenant_address, tenant_email, tenant_contact_info, max_branch_count, max_user_count, HOTEL_ENTITY_STATUS.ACTIVE.toString()]
    );
    if (res.rows.length > 0) {
      const newTenant = res.rows[0];
      return {
        success: true,
        message: "Tenant created successfully.",
        tenant: {
          ...newTenant,
          status: String(newTenant.status),
          max_branch_count: newTenant.max_branch_count === null ? null : Number(newTenant.max_branch_count),
          max_user_count: newTenant.max_user_count === null ? null : Number(newTenant.max_user_count),
        } as Tenant
      };
    }
    return { success: false, message: "Tenant creation failed." };
  } catch (error) {
    let errorMessage = "Database error occurred during tenant creation.";
     if (error instanceof Error && (error as any).code === '23505' && (error as any).constraint === 'tenants_tenant_email_key') {
        errorMessage = "This email address is already in use by another tenant.";
    } else if (error instanceof Error) {
        errorMessage = \`Database error: \${error.message}\`;
    }
    console.error('[createTenant DB Error]', error);
    return { success: false, message: errorMessage };
  } finally {
    client.release();
  }
}
