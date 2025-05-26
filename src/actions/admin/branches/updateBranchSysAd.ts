
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
import { branchUpdateSchemaSysAd, BranchUpdateDataSysAd } from '@/lib/schemas';
import { logActivity } from '@/actions/activityLogger';
import { HOTEL_ENTITY_STATUS } from '@/lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/branches/updateBranchSysAd action', err);
});

export async function updateBranchSysAd(
  branchId: number,
  data: BranchUpdateDataSysAd,
  sysAdUserId: number
): Promise<{ success: boolean; message?: string; branch?: Branch }> {
  const validatedFields = branchUpdateSchemaSysAd.safeParse(data);
  if (!validatedFields.success) {
    const errorMessages = Object.values(validatedFields.error.flatten().fieldErrors).flat().join(' ');
    return { success: false, message: `Invalid data: ${errorMessages}` };
  }

  if (!sysAdUserId || sysAdUserId <= 0) {
    return { success: false, message: "Invalid System Administrator ID for logging." };
  }

  const { tenant_id, branch_name, branch_address, contact_number, email_address, status } = validatedFields.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch current branch details for logging and limit checks if restoring
    const currentBranchRes = await client.query('SELECT tenant_id, branch_name, branch_code, status as current_status FROM tenant_branch WHERE id = $1', [branchId]);
    if (currentBranchRes.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return { success: false, message: "Branch not found." };
    }
    const currentBranch = currentBranchRes.rows[0];
    const originalTenantId = currentBranch.tenant_id;
    // Branch code is not editable by SysAd in this flow, it's part of branchUpdateSchema only.
    // const branchCode = currentBranch.branch_code;

    // If restoring a branch to active, check tenant's branch limit
    if (Number(currentBranch.current_status) === Number(HOTEL_ENTITY_STATUS.ARCHIVED) && Number(status) === Number(HOTEL_ENTITY_STATUS.ACTIVE)) {
        const tenantRes = await client.query('SELECT max_branch_count, tenant_name FROM tenants WHERE id = $1', [tenant_id]);
        if (tenantRes.rows.length > 0) {
            const { max_branch_count, tenant_name: currentTenantName } = tenantRes.rows[0]; // Renamed tenant_name to avoid conflict
            if (max_branch_count !== null && max_branch_count > 0) {
                const currentBranchCountRes = await client.query(
                    'SELECT COUNT(*) FROM tenant_branch WHERE tenant_id = $1 AND status = $2',
                    [tenant_id, HOTEL_ENTITY_STATUS.ACTIVE]
                );
                const currentBranchCount = parseInt(currentBranchCountRes.rows[0].count, 10);
                if (currentBranchCount >= max_branch_count) {
                    await client.query('ROLLBACK');
                    client.release();
                    return { success: false, message: `Cannot restore branch. Branch limit (${max_branch_count}) reached for tenant '${currentTenantName}'.` };
                }
            }
        }
    }


    const updateQuery = `
      UPDATE tenant_branch
      SET tenant_id = $1, branch_name = $2, branch_address = $3, contact_number = $4, email_address = $5, status = $6, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $7
      RETURNING id, tenant_id, branch_name, branch_code, branch_address, contact_number, email_address, status, created_at, updated_at;
    `;
    const res = await client.query(updateQuery, [
      tenant_id,
      branch_name,
      branch_address,
      contact_number,
      email_address,
      status,
      branchId
    ]);

    if (res.rows.length > 0) {
      const updatedBranch = res.rows[0];

      let logDescription = `SysAd (ID: ${sysAdUserId}) updated branch '${updatedBranch.branch_name}' (ID: ${branchId}).`;
      if (currentBranch.current_status !== status) {
        logDescription += ` Status changed from '${currentBranch.current_status}' to '${status}'.`;
      }
      if (originalTenantId !== tenant_id) {
        logDescription += ` Tenant reassigned from ID ${originalTenantId} to ID ${tenant_id}.`;
      }

      await logActivity({
        tenant_id: updatedBranch.tenant_id, // Log with the new tenant_id
        branch_id: branchId,
        actor_user_id: sysAdUserId,
        action_type: 'SYSAD_UPDATED_BRANCH',
        description: logDescription,
        target_entity_type: 'Branch',
        target_entity_id: branchId.toString(),
        details: { updated_fields: Object.keys(data).filter(k => k !== 'branch_code'), branch_name: updatedBranch.branch_name, new_tenant_id: updatedBranch.tenant_id }
      }, client);

      await client.query('COMMIT');

      // Fetch tenant name for the returned branch object
      const tenantNameRes = await client.query('SELECT tenant_name FROM tenants WHERE id = $1', [updatedBranch.tenant_id]);
      const tenantName = tenantNameRes.rows.length > 0 ? tenantNameRes.rows[0].tenant_name : null;
      client.release();

      return {
        success: true,
        message: "Branch details updated successfully.",
        branch: {
          ...updatedBranch,
          status: String(updatedBranch.status),
          tenant_name: tenantName
        } as Branch,
      };
    }
    await client.query('ROLLBACK');
    client.release();
    return { success: false, message: "Branch update failed." };
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('[updateBranchSysAd] Error during rollback:', rollbackError);
      } finally {
        client.release();
      }
    }
    console.error('[updateBranchSysAd DB Error]', error);
    const dbError = error as Error;
    return { success: false, message: `Database error during branch update: ${dbError.message}` };
  }
}
