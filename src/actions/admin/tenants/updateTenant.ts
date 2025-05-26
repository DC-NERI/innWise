
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
import { logActivity } from '@/actions/activityLogger';
import { HOTEL_ENTITY_STATUS, HOTEL_ENTITY_STATUS_TEXT } from '@/lib/constants'; // Corrected import

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
      max_branch_count = $5, max_user_count = $6, status = $7, 
      updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
  WHERE id = $8
  RETURNING id, tenant_name, tenant_address, tenant_email, tenant_contact_info, max_branch_count, max_user_count, created_at, updated_at, status;
`;

export async function updateTenant(
  tenantId: number,
  data: TenantUpdateData,
  sysAdUserId: number | null // Added sysAdUserId for logging
): Promise<{ success: boolean; message?: string; tenant?: Tenant }> {
  if (!sysAdUserId || sysAdUserId <= 0) {
    console.error("[updateTenant] Invalid sysAdUserId:", sysAdUserId);
    return { success: false, message: "Invalid System Administrator ID for logging." };
  }
   // Explicitly check if constants are loaded
  if (!HOTEL_ENTITY_STATUS || !HOTEL_ENTITY_STATUS_TEXT) {
    console.error("[updateTenant] CRITICAL: HOTEL_ENTITY_STATUS or HOTEL_ENTITY_STATUS_TEXT constants are undefined.");
    return { success: false, message: "Server configuration error: Status constants not loaded." };
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

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    console.log(`[updateTenant] Beginning transaction for tenant ID: ${tenantId}`);

    const currentTenantRes = await client.query('SELECT tenant_name, status as current_status FROM tenants WHERE id = $1', [tenantId]);
    if (currentTenantRes.rows.length === 0) {
      await client.query('ROLLBACK');
      console.warn(`[updateTenant] Tenant not found, rolling back. Tenant ID: ${tenantId}`);
      return { success: false, message: "Tenant not found." };
    }
    const currentTenantDetails = currentTenantRes.rows[0];
    console.log(`[updateTenant] Current tenant details fetched: Name: ${currentTenantDetails.tenant_name}, Status: ${currentTenantDetails.current_status}`);


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
    console.log(`[updateTenant] Update query executed. Row count: ${res.rowCount}`);

    if (res.rows.length > 0) {
      const updatedTenant = res.rows[0];
      let logDescription = `SysAd (ID: ${sysAdUserId}) updated tenant '${updatedTenant.tenant_name}' (ID: ${tenantId}).`;
      
      // Ensure HOTEL_ENTITY_STATUS_TEXT is defined before using it
      const currentStatusText = HOTEL_ENTITY_STATUS_TEXT[currentTenantDetails.current_status as keyof typeof HOTEL_ENTITY_STATUS_TEXT] || currentTenantDetails.current_status;
      const newStatusText = HOTEL_ENTITY_STATUS_TEXT[status as keyof typeof HOTEL_ENTITY_STATUS_TEXT] || status;

      if (String(currentTenantDetails.current_status) !== String(status)) {
        logDescription += ` Status changed from '${currentStatusText}' to '${newStatusText}'.`;
      }
      console.log(`[updateTenant] Preparing to log activity: ${logDescription}`);

      await logActivity({
        actor_user_id: sysAdUserId,
        action_type: 'SYSAD_UPDATED_TENANT',
        description: logDescription,
        target_entity_type: 'Tenant',
        target_entity_id: tenantId.toString(),
        details: { updated_fields: Object.keys(data).filter(k => data[k as keyof TenantUpdateData] !== currentTenantRes.rows[0][k]), tenant_name: updatedTenant.tenant_name, new_status: status }
      }, client);
      console.log(`[updateTenant] Activity logged. Committing transaction for tenant ID: ${tenantId}`);
      
      await client.query('COMMIT');
      console.log(`[updateTenant] Transaction committed successfully for tenant ID: ${tenantId}`);
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
    console.warn(`[updateTenant] Tenant update failed (no rows returned), rolling back. Tenant ID: ${tenantId}`);
    return { success: false, message: "Tenant update failed or tenant not found." };
  } catch (error) {
    if (client) {
        try { 
          console.warn(`[updateTenant] Error occurred. Attempting to ROLLBACK for tenant ID: ${tenantId}`, error);
          await client.query('ROLLBACK'); 
        } catch (rbError) { 
          console.error(`[updateTenant] Error during rollback for tenant ID: ${tenantId}`, rbError); 
        }
    }
    let errorMessage = "Database error occurred during tenant update.";
    if (error instanceof Error) {
        if ((error as any).code === '23505' && (error as any).constraint === 'tenants_tenant_email_key') {
            errorMessage = "This email address is already in use by another tenant.";
        } else {
            errorMessage = `Database error: ${error.message}`;
        }
    }
    console.error('[updateTenant DB Full Error]', error);
    return { success: false, message: errorMessage };
  } finally {
    if (client) {
      client.release();
      console.log(`[updateTenant] Client released for tenant ID: ${tenantId}`);
    }
  }
}
    
