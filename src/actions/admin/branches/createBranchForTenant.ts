
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
import { branchCreateSchema, BranchCreateData } from '@/lib/schemas';
import { HOTEL_ENTITY_STATUS } from '../../../lib/constants';
import { logActivity } from '../../activityLogger';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/branches/createBranchForTenant action', err);
});

const CREATE_BRANCH_SQL = `
  INSERT INTO tenant_branch (tenant_id, branch_name, branch_code, branch_address, contact_number, email_address, status, created_at, updated_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'))
  RETURNING id, tenant_id, branch_name, branch_code, branch_address, contact_number, email_address, status, created_at, updated_at;
`;

export async function createBranchForTenant(
  data: BranchCreateData,
  sysAdUserId: number | null
): Promise<{ success: boolean; message?: string; branch?: Branch }> {
  console.log("[createBranchForTenant] Action started with sysAdUserId:", sysAdUserId, "Data:", data);

  if (!sysAdUserId || sysAdUserId <= 0) {
    console.error("[createBranchForTenant] Invalid sysAdUserId:", sysAdUserId);
    return { success: false, message: "Invalid System Administrator ID. Cannot create branch." };
  }

  const validatedFields = branchCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessage = "Invalid data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
    console.error("[createBranchForTenant] Validation failed:", errorMessage);
    return { success: false, message: errorMessage };
  }

  const { tenant_id, branch_name, branch_code, branch_address, contact_number, email_address } = validatedFields.data;

  let client;
  try {
    client = await pool.connect();
    console.log("[createBranchForTenant] Database client connected.");
    console.log('[createBranchForTenant] Attempting to BEGIN transaction...');
    await client.query('BEGIN');
    console.log('[createBranchForTenant] Transaction BEGUN.');

    const tenantRes = await client.query('SELECT tenant_name, max_branch_count FROM tenants WHERE id = $1 AND status = $2', [tenant_id, HOTEL_ENTITY_STATUS.ACTIVE]);
    if (tenantRes.rows.length === 0) {
      await client.query('ROLLBACK');
      console.warn('[createBranchForTenant] Rollback: Tenant not found or not active.');
      return { success: false, message: "Active tenant not found." };
    }
    const { tenant_name, max_branch_count } = tenantRes.rows[0];
    console.log(`[createBranchForTenant] Tenant '${tenant_name}' found. Max branches: ${max_branch_count}`);

    if (max_branch_count !== null && max_branch_count > 0) {
      const currentBranchCountRes = await client.query(
        'SELECT COUNT(*) FROM tenant_branch WHERE tenant_id = $1 AND status = $2',
        [tenant_id, HOTEL_ENTITY_STATUS.ACTIVE]
      );
      const currentBranchCount = parseInt(currentBranchCountRes.rows[0].count, 10);
      console.log(`[createBranchForTenant] Current active branch count for tenant: ${currentBranchCount}`);
      if (currentBranchCount >= max_branch_count) {
        await client.query('ROLLBACK');
        console.warn(`[createBranchForTenant] Rollback: Branch limit (${max_branch_count}) reached for tenant '${tenant_name}'.`);
        return { success: false, message: `Branch limit (${max_branch_count}) reached for tenant '${tenant_name}'. To add a new active branch, archive an existing one or increase the limit.` };
      }
    }

    console.log('[createBranchForTenant] Inserting new branch...');
    const res = await client.query(CREATE_BRANCH_SQL, [
      tenant_id,
      branch_name,
      branch_code,
      branch_address,
      contact_number,
      email_address,
      HOTEL_ENTITY_STATUS.ACTIVE
    ]);
    console.log(`[createBranchForTenant] INSERT query executed. Row count: ${res.rowCount}`);

    let newBranch: Branch | undefined = undefined;

    if (res.rows.length > 0) {
      newBranch = {
        ...res.rows[0],
        tenant_name: tenant_name, // Add tenant_name to the returned branch object
        status: String(res.rows[0].status)
      } as Branch;
      console.log(`[createBranchForTenant] Branch inserted with ID: ${newBranch.id}. Attempting to COMMIT transaction...`);
      
      await client.query('COMMIT');
      console.log('[createBranchForTenant] Transaction COMMITTED successfully.');

      // Log activity *after* the main transaction is committed
      try {
        console.log('[createBranchForTenant] Attempting to log activity for branch ID:', newBranch.id);
        await logActivity({
          tenant_id: newBranch.tenant_id,
          branch_id: newBranch.id,
          actor_user_id: sysAdUserId,
          action_type: 'SYSAD_CREATED_BRANCH',
          description: `SysAd (ID: ${sysAdUserId}) created new branch '${newBranch.branch_name}' for tenant '${tenant_name}'.`,
          target_entity_type: 'Branch',
          target_entity_id: newBranch.id.toString(),
          details: { branch_name: newBranch.branch_name, branch_code: newBranch.branch_code, tenant_id: newBranch.tenant_id }
        }); // Not passing client here, logActivity will get its own
        console.log('[createBranchForTenant] Activity logged successfully.');
      } catch (logError: any) {
        console.error("[createBranchForTenant] Failed to log activity (outside main transaction), but branch creation was successful. Error:", logError.message, logError.stack);
      }
      
      console.log('[createBranchForTenant] Branch creation process successful.');
      return {
        success: true,
        message: "Branch created successfully.",
        branch: newBranch
      };
    } else {
      await client.query('ROLLBACK');
      console.warn('[createBranchForTenant] Rollback: Branch insertion failed (no rows returned).');
      return { success: false, message: "Branch creation failed (no rows returned)." };
    }
  } catch (error: any) {
    console.error('[createBranchForTenant DB Full Error]', error);
    if (client) {
      try {
        await client.query('ROLLBACK');
        console.warn('[createBranchForTenant] Transaction ROLLED BACK due to error:', error.message);
      } catch (rollbackError: any) {
        console.error('[createBranchForTenant] Error during rollback:', rollbackError.message, rollbackError.stack);
      }
    }
    let errorMessage = "Database error occurred during branch creation.";
    if (error.code === '23505' && error.constraint === 'tenant_branch_branch_code_key') {
        errorMessage = "This branch code is already in use. Please choose a different one.";
    } else if (error.message) {
        errorMessage = `Database error: ${error.message}`;
    }
    return { success: false, message: errorMessage };
  } finally {
    if (client) {
      client.release();
      console.log('[createBranchForTenant] Client released.');
    }
  }
}
