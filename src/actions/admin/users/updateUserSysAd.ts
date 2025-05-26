
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
import bcrypt from 'bcryptjs';
import type { User } from '@/lib/types';
import { userUpdateSchemaSysAd, UserUpdateDataSysAd } from '@/lib/schemas';
import { HOTEL_ENTITY_STATUS } from '../../../lib/constants'; // Adjusted path
import { logActivity } from '../../activityLogger'; // Adjusted path

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/users/updateUserSysAd action', err);
});

export async function updateUserSysAd(
  userId: number, 
  data: UserUpdateDataSysAd,
  sysAdUserId: number // ID of the SysAd performing the action
  ): Promise<{ success: boolean; message?: string; user?: User }> {
  const validatedFields = userUpdateSchemaSysAd.safeParse(data);
  if (!validatedFields.success) {
    const errorMessage = "Invalid data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
    return { success: false, message: errorMessage };
  }

  const { first_name, last_name, password, email, role, tenant_id, tenant_branch_id, status } = validatedFields.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const currentUserRes = await client.query('SELECT status as current_status, tenant_id as current_tenant_id, username FROM users WHERE id = $1', [userId]);
    if (currentUserRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, message: "User not found." };
    }
    const currentDbStatus = currentUserRes.rows[0].current_status;
    const currentTenantId = currentUserRes.rows[0].current_tenant_id;
    const targetUsername = currentUserRes.rows[0].username;

    // Check user count limit if restoring an archived user or moving to a tenant
    if (String(currentDbStatus) === HOTEL_ENTITY_STATUS.ARCHIVED && String(status) === HOTEL_ENTITY_STATUS.ACTIVE && tenant_id) {
      const tenantRes = await client.query('SELECT max_user_count, tenant_name FROM tenants WHERE id = $1', [tenant_id]);
      if (tenantRes.rows.length > 0) {
        const { max_user_count, tenant_name } = tenantRes.rows[0];
        if (max_user_count !== null && max_user_count > 0) {
          const currentUserCountRes = await client.query(
            'SELECT COUNT(*) FROM users WHERE tenant_id = $1 AND status = $2',
            [tenant_id, HOTEL_ENTITY_STATUS.ACTIVE]
          );
          const currentUserCount = parseInt(currentUserCountRes.rows[0].count, 10);
          if (currentUserCount >= max_user_count) {
            await client.query('ROLLBACK');
            return { success: false, message: `User limit (${max_user_count}) reached for tenant '${tenant_name}'. To restore or move this user, archive another active user for that tenant first.` };
          }
        }
      }
    }


    let password_hash_update_clause = "";
    let queryParams: any[] = [first_name, last_name, email, role, tenant_id, tenant_branch_id, status, userId];
    let paramIndex = queryParams.length; // Next available parameter index

    if (password && password.trim() !== "") {
      const salt = bcrypt.genSaltSync(10);
      const password_hash = bcrypt.hashSync(password, salt);
      password_hash_update_clause = `password_hash = $${paramIndex + 1},`;
      queryParams.push(password_hash);
    }

    const updateQuery = `
      UPDATE users
      SET first_name = $1, last_name = $2, email = $3, role = $4, tenant_id = $5, tenant_branch_id = $6, ${password_hash_update_clause} status = $7, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $8
      RETURNING id, first_name, last_name, username, email, role, tenant_id, tenant_branch_id, status, created_at, updated_at, last_log_in;
    `;
    
    const res = await client.query(updateQuery, queryParams);

    if (res.rows.length > 0) {
      const updatedUser = res.rows[0];
      let logDescription = `SysAd (ID: ${sysAdUserId}) updated user '${targetUsername}' (ID: ${userId}).`;
       if (String(currentDbStatus) !== String(status)) {
           logDescription += ` Status changed from '${currentDbStatus}' to '${status}'.`;
       }
       if (currentTenantId !== tenant_id) {
           logDescription += ` Tenant changed from ID ${currentTenantId || 'N/A'} to ID ${tenant_id || 'N/A'}.`;
       }
       if (password && password.trim() !== "") {
           logDescription += ` Password updated.`;
       }

      await logActivity({
          tenant_id: updatedUser.tenant_id,
          branch_id: updatedUser.tenant_branch_id,
          actor_user_id: sysAdUserId,
          action_type: 'SYSAD_UPDATED_USER',
          description: logDescription,
          target_entity_type: 'User',
          target_entity_id: userId.toString(),
          details: { updated_fields: Object.keys(data), username: updatedUser.username }
      }, client);
      
      await client.query('COMMIT');

      // Fetch tenant and branch name for the returned user object
      let tenant_name_display = null;
      let branch_name_display = null;
      if (updatedUser.tenant_id) {
        const tRes = await client.query('SELECT tenant_name FROM tenants WHERE id = $1', [updatedUser.tenant_id]);
        if (tRes.rows.length > 0) tenant_name_display = tRes.rows[0].tenant_name;
      }
      if (updatedUser.tenant_branch_id && updatedUser.tenant_id) {
        const bRes = await client.query('SELECT branch_name FROM tenant_branch WHERE id = $1 AND tenant_id = $2', [updatedUser.tenant_branch_id, updatedUser.tenant_id]);
        if (bRes.rows.length > 0) branch_name_display = bRes.rows[0].branch_name;
      }
      
      return {
        success: true,
        message: "User updated successfully.",
        user: { 
            ...updatedUser, 
            id: String(updatedUser.id), 
            status: String(updatedUser.status), 
            tenant_name: tenant_name_display,
            branch_name: branch_name_display,
            last_log_in: updatedUser.last_log_in ? String(updatedUser.last_log_in) : null,
        } as User
      };
    }
    await client.query('ROLLBACK');
    return { success: false, message: "User update failed." };
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[updateUserSysAd DB Error]', error);
    let errorMessage = "Database error occurred during user update.";
    if (error.code === '23505' && error.constraint === 'users_email_key') {
      errorMessage = "This email address is already in use.";
    }
    return { success: false, message: errorMessage };
  } finally {
    client.release();
  }
}
