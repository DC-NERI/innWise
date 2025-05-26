
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
import { userCreateSchema, UserCreateData } from '@/lib/schemas';
import { HOTEL_ENTITY_STATUS } from '../../../lib/constants'; // Adjusted path for constants
import { logActivity } from '../../activityLogger'; // Adjusted path

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/users/createUserSysAd action', err);
});

export async function createUserSysAd(data: UserCreateData, sysAdUserId: number): Promise<{ success: boolean; message?: string; user?: User }> {
  const validatedFields = userCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessage = "Invalid data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
    return { success: false, message: errorMessage };
  }

  const { first_name, last_name, username, password, email, role, tenant_id, tenant_branch_id } = validatedFields.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (tenant_id) {
      const tenantRes = await client.query('SELECT max_user_count, tenant_name FROM tenants WHERE id = $1', [tenant_id]);
      if (tenantRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, message: "Selected tenant not found." };
      }
      const { max_user_count, tenant_name } = tenantRes.rows[0];
      if (max_user_count !== null && max_user_count > 0) {
        const currentUserCountRes = await client.query(
          'SELECT COUNT(*) FROM users WHERE tenant_id = $1 AND status = $2',
          [tenant_id, HOTEL_ENTITY_STATUS.ACTIVE]
        );
        const currentUserCount = parseInt(currentUserCountRes.rows[0].count, 10);
        if (currentUserCount >= max_user_count) {
          await client.query('ROLLBACK');
          return { success: false, message: `User limit (${max_user_count}) reached for tenant '${tenant_name}'. To add a new active user, archive an existing one or increase the limit.` };
        }
      }
    }


    const salt = bcrypt.genSaltSync(10);
    const password_hash = bcrypt.hashSync(password, salt);

    const query = `
      INSERT INTO users (first_name, last_name, username, password_hash, email, role, tenant_id, tenant_branch_id, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'))
      RETURNING id, first_name, last_name, username, email, role, tenant_id, tenant_branch_id, status, created_at, updated_at, last_log_in;
    `;
    const res = await client.query(query, [
      first_name, last_name, username, password_hash, email, role,
      tenant_id, tenant_branch_id, HOTEL_ENTITY_STATUS.ACTIVE
    ]);

    if (res.rows.length > 0) {
      const newUser = res.rows[0];

      await logActivity({
        tenant_id: newUser.tenant_id,
        branch_id: newUser.tenant_branch_id,
        actor_user_id: sysAdUserId,
        action_type: 'SYSAD_CREATED_USER',
        description: `SysAd (ID: ${sysAdUserId}) created new user '${newUser.username}' (ID: ${newUser.id}) with role '${newUser.role}'.`,
        target_entity_type: 'User',
        target_entity_id: newUser.id.toString(),
        details: { username: newUser.username, role: newUser.role, tenant_id: newUser.tenant_id, branch_id: newUser.tenant_branch_id }
      }, client);
      
      await client.query('COMMIT');
      
      // Fetch tenant and branch name for the returned user object
      let tenant_name = null;
      let branch_name = null;
      if (newUser.tenant_id) {
        const tRes = await client.query('SELECT tenant_name FROM tenants WHERE id = $1', [newUser.tenant_id]);
        if (tRes.rows.length > 0) tenant_name = tRes.rows[0].tenant_name;
      }
      if (newUser.tenant_branch_id && newUser.tenant_id) {
        const bRes = await client.query('SELECT branch_name FROM tenant_branch WHERE id = $1 AND tenant_id = $2', [newUser.tenant_branch_id, newUser.tenant_id]);
        if (bRes.rows.length > 0) branch_name = bRes.rows[0].branch_name;
      }

      return {
        success: true,
        message: "User created successfully.",
        user: {
          ...newUser,
          id: String(newUser.id),
          status: String(newUser.status),
          tenant_name,
          branch_name,
          last_log_in: newUser.last_log_in ? String(newUser.last_log_in) : null,
        } as User
      };
    }
    await client.query('ROLLBACK');
    return { success: false, message: "User creation failed." };
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[createUserSysAd DB Error]', error);
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
