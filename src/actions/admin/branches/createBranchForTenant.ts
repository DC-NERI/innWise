
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
  sysAdUserId: number
): Promise<{ success: boolean; message?: string; branch?: Branch }> {
  const validatedFields = branchCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessage = "Invalid data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
    return { success: false, message: errorMessage };
  }
  if (!sysAdUserId || sysAdUserId <= 0) {
    console.error("[createBranchForTenant] Invalid sysAdUserId:", sysAdUserId);
    return { success: false, message: "Invalid System Administrator ID for logging." };
  }

  const { tenant_id, branch_name, branch_code, branch_address, contact_number, email_address } = validatedFields.data;

  const client = await pool.connect();
  try {
    console.log('[createBranchForTenant] Beginning transaction...');
    await client.query('BEGIN');

    // Check tenant details and branch count limit
    const tenantRes = await client.query('SELECT tenant_name, max_branch_count FROM tenants WHERE id = $1', [tenant_id]);
    if (tenantRes.rows.length === 0) {
      await client.query('ROLLBACK');
      console.warn('[createBranchForTenant] Rollback: Tenant not found.');
      return { success: false, message: "Tenant not found." };
    }
    const { tenant_name, max_branch_count } = tenantRes.rows[0];

    if (max_branch_count !== null && max_branch_count > 0) {
      const currentBranchCountRes = await client.query(
        'SELECT COUNT(*) FROM tenant_branch WHERE tenant_id = $1 AND status = $2',
        [tenant_id, HOTEL_ENTITY_STATUS.ACTIVE]
      );
      const currentBranchCount = parseInt(currentBranchCountRes.rows[0].count, 10);
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

    if (res.rows.length > 0) {
      const newBranch = res.rows[0];
      console.log(`[createBranchForTenant] Branch inserted with ID: ${newBranch.id}. Logging activity...`);

      await logActivity({
        tenant_id: newBranch.tenant_id,
        branch_id: newBranch.id,
        actor_user_id: sysAdUserId,
        action_type: 'SYSAD_CREATED_BRANCH',
        description: `SysAd (ID: ${sysAdUserId}) created new branch '${newBranch.branch_name}' for tenant '${tenant_name}'.`,
        target_entity_type: 'Branch',
        target_entity_id: newBranch.id.toString(),
        details: { branch_name: newBranch.branch_name, branch_code: newBranch.branch_code, tenant_id: newBranch.tenant_id }
      }, client);

      console.log('[createBranchForTenant] Committing transaction...');
      await client.query('COMMIT');
      console.log('[createBranchForTenant] Transaction committed successfully.');
      return {
        success: true,
        message: "Branch created successfully.",
        branch: {
          ...newBranch,
          tenant_name: tenant_name,
          status: String(newBranch.status)
        } as Branch
      };
    } else {
      await client.query('ROLLBACK');
      console.warn('[createBranchForTenant] Rollback: Branch insertion failed (no rows returned).');
      return { success: false, message: "Branch creation failed (no rows returned)." };
    }
  } catch (error: any) {
    console.error('[createBranchForTenant DB Full Error]', error);
    try {
      await client.query('ROLLBACK');
      console.warn('[createBranchForTenant] Rollback due to error:', error.message);
    } catch (rollbackError) {
      console.error('[createBranchForTenant] Error during rollback:', rollbackError);
    }
    let errorMessage = "Database error occurred during branch creation.";
    if (error.code === '23505' && error.constraint === 'tenant_branch_branch_code_key') {
        errorMessage = "This branch code is already in use. Please choose a different one.";
    } else if (error.message) {
        errorMessage = `Database error: ${error.message}`;
    }
    return { success: false, message: errorMessage };
  } finally {
    client.release();
  }
}
