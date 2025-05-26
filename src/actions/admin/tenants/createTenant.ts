
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
import { tenantCreateSchema, TenantCreateData } from '@/lib/schemas';
import { HOTEL_ENTITY_STATUS } from '@/lib/constants';
import { logActivity } from '@/actions/activityLogger';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/tenants/createTenant action', err);
});

const CREATE_TENANT_QUERY = `
  INSERT INTO tenants (tenant_name, tenant_address, tenant_email, tenant_contact_info, max_branch_count, max_user_count, status, created_at, updated_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'))
  RETURNING id, tenant_name, tenant_address, tenant_email, tenant_contact_info, max_branch_count, max_user_count, created_at, updated_at, status
`;

export async function createTenant(data: TenantCreateData, sysAdUserId: number | null): Promise<{ success: boolean; message?: string; tenant?: Tenant }> {
  if (!sysAdUserId || sysAdUserId <= 0) {
    console.error("[createTenant] Invalid sysAdUserId:", sysAdUserId);
    return { success: false, message: "Invalid System Administrator ID. Cannot create tenant." };
  }

  const validatedFields = tenantCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessages = Object.values(validatedFields.error.flatten().fieldErrors).flat().join(' ');
    return { success: false, message: `Invalid data: ${errorMessages}` };
  }
  const { tenant_name, tenant_address, tenant_email, tenant_contact_info, max_branch_count, max_user_count } = validatedFields.data;
  const client = await pool.connect();
  try {
    console.log('[createTenant] Beginning transaction...');
    await client.query('BEGIN');
    const res = await client.query(CREATE_TENANT_QUERY,
      [tenant_name, tenant_address, tenant_email, tenant_contact_info, max_branch_count, max_user_count, HOTEL_ENTITY_STATUS.ACTIVE.toString()]
    );
    if (res.rows.length > 0) {
      const newTenant = res.rows[0];
      console.log(`[createTenant] Tenant inserted with ID: ${newTenant.id}. Logging activity...`);

      try {
        await logActivity({
          actor_user_id: sysAdUserId,
          action_type: 'SYSAD_CREATED_TENANT',
          description: `SysAd (ID: ${sysAdUserId}) created new tenant '${newTenant.tenant_name}'.`,
          target_entity_type: 'Tenant',
          target_entity_id: newTenant.id.toString(),
          details: { tenant_name: newTenant.tenant_name, email: newTenant.tenant_email }
        }, client);
        console.log('[createTenant] Activity logged.');
      } catch (logError) {
        console.error("[createTenant] Failed to log activity, but proceeding with tenant creation:", logError);
        // Decide if logging failure should roll back the tenant creation.
        // For now, we log the error but don't roll back.
      }
      
      console.log('[createTenant] Committing transaction...');
      await client.query('COMMIT');
      console.log('[createTenant] Transaction committed successfully.');
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
    await client.query('ROLLBACK');
    console.warn('[createTenant] Rollback: Tenant insertion failed (no rows returned).');
    return { success: false, message: "Tenant creation failed (no rows returned)." };
  } catch (error: any) {
    console.error('[createTenant DB Full Error]', error);
    try {
      await client.query('ROLLBACK');
      console.warn('[createTenant] Rollback due to error:', error.message);
    } catch (rollbackError) {
      console.error('[createTenant] Error during rollback:', rollbackError);
    }
    let errorMessage = "Database error occurred during tenant creation.";
     if (error.code === '23505' && error.constraint === 'tenants_tenant_email_key') {
        errorMessage = "This email address is already in use by another tenant.";
    } else if (error.message) {
        errorMessage = `Database error: ${error.message}`;
    }
    return { success: false, message: errorMessage };
  } finally {
    client.release();
    console.log('[createTenant] Client released.');
  }
}
