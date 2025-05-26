
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
import { logActivity } from '../../activityLogger';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/tenants/createTenant action', err);
});

const CREATE_TENANT_QUERY = `
  INSERT INTO tenants (tenant_name, tenant_address, tenant_email, tenant_contact_info, max_branch_count, max_user_count, created_at, updated_at, status)
  VALUES ($1, $2, $3, $4, $5, $6, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), $7)
  RETURNING id, tenant_name, tenant_address, tenant_email, tenant_contact_info, max_branch_count, max_user_count, created_at, updated_at, status;
`;

export async function createTenant(
  data: TenantCreateData,
  sysAdUserId: number | null
): Promise<{ success: boolean; message?: string; tenant?: Tenant }> {
  console.log("[createTenant] Action started with sysAdUserId:", sysAdUserId);

  if (!sysAdUserId || sysAdUserId <= 0) {
    console.error("[createTenant] Invalid sysAdUserId:", sysAdUserId);
    return { success: false, message: "Invalid System Administrator ID. Cannot create tenant." };
  }

  const validatedFields = tenantCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessages = Object.values(validatedFields.error.flatten().fieldErrors).flat().join(' ');
    console.error("[createTenant] Validation failed:", errorMessages);
    return { success: false, message: `Invalid data: ${errorMessages}` };
  }
  const { tenant_name, tenant_address, tenant_email, tenant_contact_info, max_branch_count, max_user_count } = validatedFields.data;

  const client = await pool.connect();
  console.log("[createTenant] Database client connected.");

  try {
    console.log('[createTenant] Attempting to BEGIN transaction...');
    await client.query('BEGIN');
    console.log('[createTenant] Transaction BEGUN.');

    console.log('[createTenant] Executing INSERT query for tenant:', tenant_name);
    const res = await client.query(CREATE_TENANT_QUERY, [
      tenant_name,
      tenant_address,
      tenant_email,
      tenant_contact_info,
      max_branch_count,
      max_user_count,
      HOTEL_ENTITY_STATUS.ACTIVE,
    ]);
    console.log(`[createTenant] INSERT query executed. Row count: ${res.rowCount}`);

    if (res.rows.length > 0) {
      const newTenant = res.rows[0];
      console.log(`[createTenant] Tenant inserted with ID: ${newTenant.id}. Attempting to COMMIT transaction...`);
      
      await client.query('COMMIT');
      console.log('[createTenant] Transaction COMMITTED successfully.');

      // Log activity *after* the main transaction is committed
      try {
        console.log('[createTenant] Attempting to log activity for tenant ID:', newTenant.id);
        await logActivity({
          actor_user_id: sysAdUserId,
          action_type: 'SYSAD_CREATED_TENANT',
          description: `SysAd (ID: ${sysAdUserId}) created new tenant '${newTenant.tenant_name}'.`,
          target_entity_type: 'Tenant',
          target_entity_id: newTenant.id.toString(),
          details: { tenant_name: newTenant.tenant_name, email: newTenant.tenant_email }
        }); // Not passing client here, logActivity will get its own
        console.log('[createTenant] Activity logged successfully.');
      } catch (logError: any) {
        console.error("[createTenant] Failed to log activity (outside main transaction), but tenant creation was successful. Error:", logError.message, logError.stack);
        // Do not roll back or return failure for the tenant creation itself if logging fails here
      }
      
      console.log('[createTenant] Tenant creation process successful.');
      return {
        success: true,
        message: "Tenant created successfully.",
        tenant: {
          ...newTenant,
          status: String(newTenant.status),
          max_branch_count: newTenant.max_branch_count === null ? null : Number(newTenant.max_branch_count),
          max_user_count: newTenant.max_user_count === null ? null : Number(newTenant.max_user_count),
        } as Tenant,
      };
    } else {
      console.warn('[createTenant] Tenant insertion failed (no rows returned). Attempting to ROLLBACK transaction...');
      await client.query('ROLLBACK');
      console.warn('[createTenant] Transaction ROLLED BACK due to no rows returned from insert.');
      return { success: false, message: "Tenant creation failed (no rows returned)." };
    }
  } catch (error: any) {
    console.error('[createTenant DB Full Error]', error);
    try {
      console.warn('[createTenant] Error occurred. Attempting to ROLLBACK transaction...');
      await client.query('ROLLBACK');
      console.warn('[createTenant] Transaction ROLLED BACK due to error:', error.message);
    } catch (rollbackError: any) {
      console.error('[createTenant] Error during rollback:', rollbackError.message, rollbackError.stack);
    }
    let errorMessage = "Database error occurred during tenant creation.";
    if (error.code === '23505' && error.constraint === 'tenants_tenant_email_key') {
      errorMessage = "This email address is already in use by another tenant.";
    } else if (error.message) {
      errorMessage = `Database error: ${error.message}`;
    }
    return { success: false, message: errorMessage };
  } finally {
    if (client) {
      client.release();
      console.log('[createTenant] Client released.');
    }
  }
}
    