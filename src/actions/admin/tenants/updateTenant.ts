
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
import { tenantUpdateSchema, TenantUpdateData } from '@/lib/schemas';
import { logActivity } from '@/actions/activityLogger'; // Use aliased path
import { HOTEL_ENTITY_STATUS } from '@/lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/tenants/updateTenant action', err);
});

const UPDATE_TENANT_QUERY = `
  UPDATE tenants
  SET tenant_name = $1, tenant_address = $2, tenant_email = $3, tenant_contact_info = $4, 
      max_branch_count = $5, max_user_count = $6, status = $7, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
  WHERE id = $8
  RETURNING id, tenant_name, tenant_address, tenant_email, tenant_contact_info, max_branch_count, max_user_count, created_at, updated_at, status;
`;

export async function updateTenant(
  tenantId: number,
  data: TenantUpdateData,
  sysAdUserId: number
): Promise<{ success: boolean; message?: string; tenant?: Tenant }> {
  if (!sysAdUserId || sysAdUserId <= 0) {
    return { success: false, message: "Invalid System Administrator ID for logging." };
  }

  const validatedFields = tenantUpdateSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessages = Object.values(validatedFields.error.flatten().fieldErrors).flat().join(' ');
    return { success: false, message: `Invalid data: ${errorMessages}` };
  }

  const {
    tenant_name,
    tenant_address,
    tenant_email,
    tenant_contact_info,
    max_branch_count,
    max_user_count,
    status,
  } = validatedFields.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch current tenant details for logging purposes if needed (e.g., to log specific changes)
    const currentTenantRes = await client.query('SELECT tenant_name, status as current_status FROM tenants WHERE id = $1', [tenantId]);
    if (currentTenantRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Tenant not found." };
    }
    const currentTenantDetails = currentTenantRes.rows[0];

    // Check user and branch limits if restoring a tenant
    if (String(currentTenantDetails.current_status) === HOTEL_ENTITY_STATUS.ARCHIVED && status === HOTEL_ENTITY_STATUS.ACTIVE) {
      // No inherent limits on restoring a tenant itself, but a tenant's own limits (max_branch_count, max_user_count)
      // will apply to its branches/users. This check is mostly for consistency.
    }


    const res = await client.query(UPDATE_TENANT_QUERY, [
      tenant_name,
      tenant_address,
      tenant_email,
      tenant_contact_info,
      max_branch_count,
      max_user_count,
      status,
      tenantId,
    ]);

    if (res.rows.length > 0) {
      const updatedTenant = res.rows[0];
      let logDescription = `SysAd (ID: ${sysAdUserId}) updated tenant '${updatedTenant.tenant_name}' (ID: ${tenantId}).`;
      if (currentTenantDetails.current_status !== status) {
        logDescription += ` Status changed from '${currentTenantDetails.current_status}' to '${status}'.`;
      }

      await logActivity({
        actor_user_id: sysAdUserId,
        action_type: 'SYSAD_UPDATED_TENANT',
        description: logDescription,
        target_entity_type: 'Tenant',
        target_entity_id: tenantId.toString(),
        details: { updated_fields: Object.keys(data), tenant_name: updatedTenant.tenant_name }
      }, client);
      
      await client.query('COMMIT');
      return {
        success: true,
        message: "Tenant updated successfully.",
        tenant: {
          ...updatedTenant,
          status: String(updatedTenant.status),
          max_branch_count: updatedTenant.max_branch_count === null ? null : Number(updatedTenant.max_branch_count),
          max_user_count: updatedTenant.max_user_count === null ? null : Number(updatedTenant.max_user_count),
        } as Tenant,
      };
    }

    await client.query('ROLLBACK');
    return { success: false, message: "Tenant update failed or tenant not found." };
  } catch (error) {
    await client.query('ROLLBACK');
    let errorMessage = "Database error occurred during tenant update.";
    if (error instanceof Error && (error as any).code === '23505' && (error as any).constraint === 'tenants_tenant_email_key') {
        errorMessage = "This email address is already in use by another tenant.";
    } else if (error instanceof Error) {
        errorMessage = `Database error: ${error.message}`;
    }
    console.error('[updateTenant DB Error]', error);
    return { success: false, message: errorMessage };
  } finally {
    client.release();
  }
}
