
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
import bcrypt from 'bcryptjs';
import type { User } from '@/lib/types';
import { userCreateSchema, UserCreateData } from '@/lib/schemas';
import { HOTEL_ENTITY_STATUS } from '../../../lib/constants';
import { logActivity } from '../../activityLogger';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/users/createUserSysAd action', err);
});

export async function createUserSysAd(
  data: UserCreateData,
  sysAdUserId: number
): Promise<{ success: boolean; message?: string; user?: User }> {
  console.log(`[createUserSysAd] Action started. SysAd ID: ${sysAdUserId}, Data:`, JSON.stringify(data));

  if (!sysAdUserId || sysAdUserId <= 0) {
    console.error("[createUserSysAd] Invalid sysAdUserId:", sysAdUserId);
    return { success: false, message: "Invalid System Administrator ID. Cannot create user." };
  }

  const validatedFields = userCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessages = Object.values(validatedFields.error.flatten().fieldErrors).flat().join(' ');
    console.error("[createUserSysAd] Validation failed:", errorMessages);
    return { success: false, message: `Invalid data: ${errorMessages}` };
  }

  const { first_name, last_name, username, password, email, role, tenant_id, tenant_branch_id } = validatedFields.data;

  let client;
  try {
    client = await pool.connect();
    console.log("[createUserSysAd] Database client connected.");

    console.log('[createUserSysAd] Attempting to BEGIN transaction...');
    await client.query('BEGIN');
    console.log('[createUserSysAd] Transaction BEGUN.');

    if (tenant_id) {
      console.log(`[createUserSysAd] Checking user limit for tenant ID: ${tenant_id}`);
      const tenantRes = await client.query('SELECT max_user_count, tenant_name FROM tenants WHERE id = $1', [tenant_id]);
      if (tenantRes.rows.length === 0) {
        await client.query('ROLLBACK');
        console.warn(`[createUserSysAd] Rollback: Tenant ID ${tenant_id} not found.`);
        return { success: false, message: "Selected tenant not found." };
      }
      const { max_user_count, tenant_name } = tenantRes.rows[0];
      console.log(`[createUserSysAd] Tenant '${tenant_name}' max_user_count: ${max_user_count}`);
      if (max_user_count !== null && max_user_count > 0) {
        const currentUserCountRes = await client.query(
          'SELECT COUNT(*) FROM users WHERE tenant_id = $1 AND status = $2',
          [tenant_id, HOTEL_ENTITY_STATUS.ACTIVE.toString()]
        );
        const currentUserCount = parseInt(currentUserCountRes.rows[0].count, 10);
        console.log(`[createUserSysAd] Tenant '${tenant_name}' current active user count: ${currentUserCount}`);
        if (currentUserCount >= max_user_count) {
          await client.query('ROLLBACK');
          console.warn(`[createUserSysAd] Rollback: User limit (${max_user_count}) reached for tenant '${tenant_name}'.`);
          return { success: false, message: `User limit (${max_user_count}) reached for tenant '${tenant_name}'. To add a new active user, archive an existing one or increase the limit.` };
        }
      }
    }

    console.log(`[createUserSysAd] Hashing password for user: ${username}`);
    const salt = bcrypt.genSaltSync(10);
    const password_hash = bcrypt.hashSync(password, salt);
    console.log(`[createUserSysAd] Password hashed.`);

    const insertUserQuery = `
      INSERT INTO users (first_name, last_name, username, password_hash, email, role, tenant_id, tenant_branch_id, status, created_at, updated_at, last_log_in)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), NULL)
      RETURNING id, first_name, last_name, username, email, role, tenant_id, tenant_branch_id, status, created_at, updated_at, last_log_in;
    `;
    console.log(`[createUserSysAd] Executing INSERT query for user: ${username}`);
    const res = await client.query(insertUserQuery, [
      first_name, last_name, username, password_hash, email, role,
      tenant_id, tenant_branch_id, HOTEL_ENTITY_STATUS.ACTIVE.toString()
    ]);
    console.log(`[createUserSysAd] INSERT query executed. Row count: ${res.rowCount}`);

    if (res.rows.length > 0) {
      const newUser = res.rows[0];
      console.log(`[createUserSysAd] User inserted with ID: ${newUser.id}. Attempting to COMMIT transaction...`);
      
      await client.query('COMMIT');
      console.log('[createUserSysAd] Transaction COMMITTED successfully.');

      // Log activity *after* the main transaction is committed
      try {
        console.log(`[createUserSysAd] Attempting to log activity for user ID: ${newUser.id}`);
        await logActivity({
          tenant_id: newUser.tenant_id,
          branch_id: newUser.tenant_branch_id,
          actor_user_id: sysAdUserId,
          action_type: 'SYSAD_CREATED_USER',
          description: `SysAd (ID: ${sysAdUserId}) created new user '${newUser.username}' (ID: ${newUser.id}) with role '${newUser.role}'.`,
          target_entity_type: 'User',
          target_entity_id: newUser.id.toString(),
          details: { username: newUser.username, role: newUser.role, tenant_id: newUser.tenant_id, branch_id: newUser.tenant_branch_id }
        }); // Not passing client here, logActivity will get its own
        console.log('[createUserSysAd] Activity logged successfully.');
      } catch (logError: any) {
        console.error("[createUserSysAd] Failed to log activity (outside main transaction), but user creation was successful. Error:", logError.message, logError.stack);
      }
      
      console.log('[createUserSysAd] User creation process successful. Fetching tenant/branch names for response.');
      let tenant_name_display = null;
      let branch_name_display = null;
      if (newUser.tenant_id) {
        const tRes = await pool.query('SELECT tenant_name FROM tenants WHERE id = $1', [newUser.tenant_id]); // Use pool for read after commit
        if (tRes.rows.length > 0) tenant_name_display = tRes.rows[0].tenant_name;
      }
      if (newUser.tenant_branch_id && newUser.tenant_id) {
        const bRes = await pool.query('SELECT branch_name FROM tenant_branch WHERE id = $1 AND tenant_id = $2', [newUser.tenant_branch_id, newUser.tenant_id]); // Use pool
        if (bRes.rows.length > 0) branch_name_display = bRes.rows[0].branch_name;
      }

      return {
        success: true,
        message: "User created successfully.",
        user: {
          ...newUser,
          id: newUser.id, // ID should already be a number due to type parsers
          status: String(newUser.status),
          tenant_name: tenant_name_display,
          branch_name: branch_name_display,
          last_log_in: newUser.last_log_in ? String(newUser.last_log_in) : null,
        } as User
      };
    } else {
      console.warn('[createUserSysAd] User insertion failed (no rows returned). Attempting to ROLLBACK transaction...');
      await client.query('ROLLBACK');
      console.warn('[createUserSysAd] Transaction ROLLED BACK due to no rows returned from insert.');
      return { success: false, message: "User creation failed (no rows returned)." };
    }
  } catch (error: any) {
    console.error('[createUserSysAd DB Full Error]', error);
    if (client) {
      try {
        console.warn('[createUserSysAd] Error occurred. Attempting to ROLLBACK transaction...');
        await client.query('ROLLBACK');
        console.warn('[createUserSysAd] Transaction ROLLED BACK due to error:', error.message);
      } catch (rollbackError: any) {
        console.error('[createUserSysAd] Error during rollback:', rollbackError.message, rollbackError.stack);
      }
    }
    let errorMessage = "Database error occurred during user creation.";
    if (error.code === '23505' && error.constraint === 'users_username_key') {
      errorMessage = "This username is already taken. Please choose another one.";
    } else if (error.code === '23505' && error.constraint === 'users_email_key') {
      errorMessage = "This email address is already in use.";
    } else if (error.message) {
      errorMessage = `Database error: ${error.message}`;
    }
    return { success: false, message: errorMessage };
  } finally {
    if (client) {
      client.release();
      console.log('[createUserSysAd] Client released.');
    }
  }
}
