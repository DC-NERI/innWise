
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
import { userCreateSchemaAdmin, UserCreateDataAdmin } from '@/lib/schemas';
import { HOTEL_ENTITY_STATUS } from '../../../lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/users/createUserAdmin action', err);
});

export async function createUserAdmin(data: UserCreateDataAdmin, callingTenantId: number, callingAdminUserId: number): Promise<{ success: boolean; message?: string; user?: User }> {
  if (!callingAdminUserId || callingAdminUserId <= 0) {
    return { success: false, message: "Invalid administrator identifier." };
  }
  const validatedFields = userCreateSchemaAdmin.safeParse(data);
  if (!validatedFields.success) {
    const errorMessage = "Invalid data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
    return { success: false, message: errorMessage };
  }

  const { first_name, last_name, username, password, email, role, tenant_branch_id } = validatedFields.data;

  // Admins can only create 'admin' or 'staff' or 'housekeeping' roles within their own tenant.
  if (role === 'sysad') {
    return { success: false, message: "Admins cannot create SysAd users." };
  }

  const client = await pool.connect();
  try {
    // Check user count limit for the calling tenant
    const tenantRes = await client.query('SELECT max_user_count FROM tenants WHERE id = $1', [callingTenantId]);
    if (tenantRes.rows.length === 0) {
      return { success: false, message: "Tenant not found." };
    }
    const maxUserCount = tenantRes.rows[0].max_user_count;

    if (maxUserCount !== null && maxUserCount > 0) {
      const currentUserCountRes = await client.query(
        'SELECT COUNT(*) FROM users WHERE tenant_id = $1 AND status = $2',
        [callingTenantId, HOTEL_ENTITY_STATUS.ACTIVE.toString()]
      );
      const currentUserCount = parseInt(currentUserCountRes.rows[0].count, 10);
      if (currentUserCount >= maxUserCount) {
        return { success: false, message: `User limit (${maxUserCount}) reached for this tenant. To add a new active user, archive an existing one first.` };
      }
    }

    const salt = bcrypt.genSaltSync(10);
    const password_hash = bcrypt.hashSync(password, salt);

    const query = `
      INSERT INTO users (first_name, last_name, username, password_hash, email, role, tenant_id, tenant_branch_id, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'))
      RETURNING id, first_name, last_name, username, email, role, tenant_id, tenant_branch_id, status, created_at, updated_at;
    `;
    const res = await client.query(query, [
      first_name, last_name, username, password_hash, email, role,
      callingTenantId, // User belongs to the admin's tenant
      tenant_branch_id,
      HOTEL_ENTITY_STATUS.ACTIVE.toString()
    ]);

    if (res.rows.length > 0) {
      const newUser = res.rows[0];
      // Fetch tenant and branch name for the returned user object
      let tenant_name = null;
      let branch_name = null;
      if (newUser.tenant_id) {
        const tRes = await client.query('SELECT tenant_name FROM tenants WHERE id = $1', [newUser.tenant_id]);
        if (tRes.rows.length > 0) tenant_name = tRes.rows[0].tenant_name;
      }
      if (newUser.tenant_branch_id) {
        const bRes = await client.query('SELECT branch_name FROM tenant_branch WHERE id = $1 AND tenant_id = $2', [newUser.tenant_branch_id, newUser.tenant_id]);
        if (bRes.rows.length > 0) branch_name = bRes.rows[0].branch_name;
      }

      return {
        success: true,
        message: "User created successfully.",
        user: { ...newUser, id: String(newUser.id), status: String(newUser.status), tenant_name, branch_name } as User
      };
    }
    return { success: false, message: "User creation failed." };
  } catch (error: any) {
    console.error('[createUserAdmin DB Error]', error);
    let errorMessage = "Database error occurred during user creation.";
    if (error.code === '23505' && error.constraint === 'users_username_key') {
      errorMessage = "This username is already taken. Please choose another one.";
    } else if (error.code === '23505' && error.constraint === 'users_email_key') {
      errorMessage = "This email address is already in use.";
    }
    return { success: false, message: errorMessage };
  } finally {
    client.release();
  }
}
    