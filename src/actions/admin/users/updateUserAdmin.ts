
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
import { userUpdateSchemaAdmin, UserUpdateDataAdmin } from '@/lib/schemas';
import { HOTEL_ENTITY_STATUS } from '../../../lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/users/updateUserAdmin action', err);
});

export async function updateUserAdmin(userId: number, data: UserUpdateDataAdmin, callingTenantId: number): Promise<{ success: boolean; message?: string; user?: User }> {
  const validatedFields = userUpdateSchemaAdmin.safeParse(data);
  if (!validatedFields.success) {
    const errorMessage = "Invalid data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
    return { success: false, message: errorMessage };
  }

  const { first_name, last_name, password, email, role, tenant_branch_id, status } = validatedFields.data;

  if (role === 'sysad') {
    return { success: false, message: "Admins cannot change users to SysAd role or update SysAd users." };
  }

  const client = await pool.connect();
  try {
    // First, verify the user being updated belongs to the admin's tenant and is not a sysad
    const currentUserRes = await client.query('SELECT role, status as current_status FROM users WHERE id = $1 AND tenant_id = $2', [userId, callingTenantId]);
    if (currentUserRes.rows.length === 0) {
      return { success: false, message: "User not found in your tenant or access denied." };
    }
    if (currentUserRes.rows[0].role === 'sysad') {
      return { success: false, message: "SysAd user profiles cannot be modified by tenant admins." };
    }
    const currentDbStatus = currentUserRes.rows[0].current_status;

    // Check user count limit if restoring an archived user
    if (currentDbStatus === HOTEL_ENTITY_STATUS.ARCHIVED && status === HOTEL_ENTITY_STATUS.ACTIVE) {
      const tenantRes = await client.query('SELECT max_user_count FROM tenants WHERE id = $1', [callingTenantId]);
      if (tenantRes.rows.length > 0) { // Should always find the tenant
        const maxUserCount = tenantRes.rows[0].max_user_count;
        if (maxUserCount !== null && maxUserCount > 0) {
          const currentUserCountRes = await client.query(
            'SELECT COUNT(*) FROM users WHERE tenant_id = $1 AND status = $2',
            [callingTenantId, HOTEL_ENTITY_STATUS.ACTIVE.toString()]
          );
          const currentUserCount = parseInt(currentUserCountRes.rows[0].count, 10);
          if (currentUserCount >= maxUserCount) {
            return { success: false, message: `User limit (${maxUserCount}) reached. To restore this user, archive another active user first.` };
          }
        }
      }
    }


    let password_hash_update_clause = "";
    const queryParams: any[] = [first_name, last_name, email, role, tenant_branch_id, status, userId, callingTenantId];

    if (password && password.trim() !== "") {
      const salt = bcrypt.genSaltSync(10);
      const password_hash = bcrypt.hashSync(password, salt);
      password_hash_update_clause = `password_hash = $${queryParams.length + 1},`;
      queryParams.push(password_hash);
    }

    const query = `
      UPDATE users
      SET first_name = $1, last_name = $2, email = $3, role = $4, tenant_branch_id = $5, ${password_hash_update_clause} status = $6, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $${password ? queryParams.length : queryParams.length -1} AND tenant_id = $${password ? queryParams.length+1 : queryParams.length} AND role != 'sysad'
      RETURNING id, first_name, last_name, username, email, role, tenant_id, tenant_branch_id, status, created_at, updated_at;
    `;
    // Adjust parameter indices for WHERE clause
    const whereIdParamIndex = password_hash_update_clause ? queryParams.length : queryParams.length -1;
    const whereTenantIdParamIndex = password_hash_update_clause ? queryParams.length + 1 : queryParams.length;
    
    const finalQueryParams = [...queryParams.slice(0, 6), userId, callingTenantId];
    if (password && password.trim() !== "") {
        finalQueryParams.splice(6,0, queryParams[queryParams.length-1]); // Insert hashed_password at the correct spot for the main SET clause
    }


    const updateQueryFinal = `
      UPDATE users
      SET first_name = $1, last_name = $2, email = $3, role = $4, tenant_branch_id = $5, ${password_hash_update_clause} status = $6, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $${password_hash_update_clause ? 8 : 7} AND tenant_id = $${password_hash_update_clause ? 9 : 8} AND role != 'sysad'
      RETURNING id, first_name, last_name, username, email, role, tenant_id, tenant_branch_id, status, created_at, updated_at;
    `;
    const finalQueryParamsCorrected = [first_name, last_name, email, role, tenant_branch_id, status];
    if (password && password.trim() !== "") {
        finalQueryParamsCorrected.splice(5,0, bcrypt.hashSync(password, bcrypt.genSaltSync(10))); // password_hash at index 5 if present
    }
    finalQueryParamsCorrected.push(userId, callingTenantId);


    const res = await client.query(updateQueryFinal, finalQueryParamsCorrected);

    if (res.rows.length > 0) {
      const updatedUser = res.rows[0];
      // Fetch tenant and branch name for the returned user object
      let tenant_name = null;
      let branch_name = null;
      if (updatedUser.tenant_id) {
        const tRes = await client.query('SELECT tenant_name FROM tenants WHERE id = $1', [updatedUser.tenant_id]);
        if (tRes.rows.length > 0) tenant_name = tRes.rows[0].tenant_name;
      }
      if (updatedUser.tenant_branch_id) {
        const bRes = await client.query('SELECT branch_name FROM tenant_branch WHERE id = $1 AND tenant_id = $2', [updatedUser.tenant_branch_id, updatedUser.tenant_id]);
        if (bRes.rows.length > 0) branch_name = bRes.rows[0].branch_name;
      }

      return {
        success: true,
        message: "User updated successfully.",
        user: { ...updatedUser, id: String(updatedUser.id), status: String(updatedUser.status), tenant_name, branch_name } as User
      };
    }
    return { success: false, message: "User not found or update failed." };
  } catch (error: any) {
    console.error('[updateUserAdmin DB Error]', error);
    let errorMessage = "Database error occurred during user update.";
    if (error.code === '23505' && error.constraint === 'users_email_key') {
      errorMessage = "This email address is already in use.";
    }
    return { success: false, message: errorMessage };
  } finally {
    client.release();
  }
}
    