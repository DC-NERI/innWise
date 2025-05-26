
"use server";

import pg from 'pg';
// Configure pg to return numeric types as numbers instead of strings
pg.types.setTypeParser(20, (val) => parseInt(val, 10)); // int8/bigint
pg.types.setTypeParser(21, (val) => parseInt(val, 10)); // int2/smallint
pg.types.setTypeParser(23, (val) => parseInt(val, 10)); // int4/integer
pg.types.setTypeParser(1700, (val) => parseFloat(val)); // numeric/decimal

// Configure pg to return timestamp types as strings
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE
pg.types.setTypeParser(1082, (stringValue) => stringValue); // DATE

import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { headers } from 'next/headers'; // To get IP and User-Agent
import type { UserRole } from "@/lib/types";
import { loginSchema } from "@/lib/schemas";
import { HOTEL_ENTITY_STATUS } from '@/lib/constants';
import { logActivity } from '../activityLogger'; // For general activity logging
import { logLoginAttempt } from './logLoginAttempt'; // For specific login_logs table

export type LoginResult = {
  success: boolean;
  message: string;
  role?: UserRole;
  tenantId?: number;
  tenantName?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  tenantBranchId?: number;
  branchName?: string;
  userId?: number;
};

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in auth/loginUser action', err);
});

const LOGIN_USER_QUERY = `
  SELECT u.id, u.username, u.password_hash, u.role, u.tenant_id, u.first_name, u.last_name, u.tenant_branch_id, tb.branch_name
  FROM users u
  LEFT JOIN tenant_branch tb ON u.tenant_branch_id = tb.id AND u.tenant_id = tb.tenant_id
  WHERE u.username = $1 AND u.status = $2
`;

export async function loginUser(formData: FormData): Promise<LoginResult> {
  let client;
  let userIdToLogActivity: number | undefined = undefined;
  let tenantIdForLogActivity: number | undefined = undefined;
  let branchIdForLogActivity: number | undefined = undefined;
  let attemptedUsername: string = "";

  // Get request details for logging
  const headerList = headers();
  const ipAddress = (headerList.get('x-forwarded-for') ?? headerList.get('x-real-ip') ?? headerList.get('cf-connecting-ip') ?? 'unknown').split(',')[0].trim();
  const userAgent = headerList.get('user-agent') ?? 'unknown';

  try {
    const parsedData = Object.fromEntries(formData.entries());
    const validatedFields = loginSchema.safeParse(parsedData);

    if (!validatedFields.success) {
      const errorFields = validatedFields.error.flatten().fieldErrors;
      const flatMessages = Object.values(errorFields).flat().join(' ');
      const errorMessage = "Invalid form data. " + flatMessages;
      // Cannot log to login_logs here as we don't know the user_id yet or if username is valid
      return { message: errorMessage, success: false };
    }

    const { username, password } = validatedFields.data;
    attemptedUsername = username;

    client = await pool.connect();
    const userResult = await client.query(
      LOGIN_USER_QUERY,
      [username, HOTEL_ENTITY_STATUS.ACTIVE]
    );

    if (userResult.rows.length === 0) {
      await logActivity({
        actor_user_id: 0, // System or unknown user
        actor_username: attemptedUsername,
        action_type: 'USER_LOGIN_FAILED',
        description: `Login attempt failed for username '${attemptedUsername}': User not found or inactive. IP: ${ipAddress}, UA: ${userAgent}`,
        details: { attemptedUsername, reason: "User not found or inactive", ipAddress, userAgent }
      });
      // Cannot log to login_logs here due to user_id NOT NULL constraint
      return { message: "Invalid username, password, or inactive account.", success: false };
    }

    const user = userResult.rows[0];
    userIdToLogActivity = Number(user.id); // Store for activity log
    tenantIdForLogActivity = user.tenant_id ? Number(user.tenant_id) : undefined;
    branchIdForLogActivity = user.tenant_branch_id ? Number(user.tenant_branch_id) : undefined;

    const passwordMatches = bcrypt.compareSync(password, user.password_hash);

    if (!passwordMatches) {
      await logLoginAttempt(Number(user.id), ipAddress, userAgent, 'failed');
      await logActivity({
        actor_user_id: Number(user.id),
        actor_username: user.username,
        tenant_id: tenantIdForLogActivity,
        branch_id: branchIdForLogActivity,
        action_type: 'USER_LOGIN_FAILED',
        description: `Login attempt failed for user '${user.username}': Incorrect password. IP: ${ipAddress}, UA: ${userAgent}`,
        details: { username: user.username, reason: "Incorrect password", ipAddress, userAgent }
      });
      return { message: "Invalid username or password.", success: false };
    }

    const userRole = user.role as UserRole;
    const validRoles: UserRole[] = ["admin", "sysad", "staff", "housekeeping"];
    if (!validRoles.includes(userRole)) {
       await logLoginAttempt(Number(user.id), ipAddress, userAgent, 'failed'); // Log as failed attempt if role is invalid for dashboard
       await logActivity({
        actor_user_id: Number(user.id),
        actor_username: user.username,
        tenant_id: tenantIdForLogActivity,
        branch_id: branchIdForLogActivity,
        action_type: 'USER_LOGIN_FAILED',
        description: `Login attempt successful for user '${user.username}', but role '${userRole}' is not recognized for dashboard access. IP: ${ipAddress}, UA: ${userAgent}`,
        details: { username: user.username, role: userRole, reason: "Unrecognized role", ipAddress, userAgent }
      });
      return { message: "Login successful, but user role is not recognized for dashboard access.", success: false };
    }

    let tenantId: number | undefined = undefined;
    let tenantName: string | undefined = undefined;

    if (user.tenant_id && userRole !== 'sysad') {
      tenantId = Number(user.tenant_id);
      const tenantRes = await client.query('SELECT tenant_name, status FROM tenants WHERE id = $1', [user.tenant_id]);
      if (tenantRes.rows.length === 0 || tenantRes.rows[0].status !== HOTEL_ENTITY_STATUS.ACTIVE) {
        const reason = tenantRes.rows.length === 0 ? "Tenant not found" : `Tenant inactive (status: ${tenantRes.rows[0].status})`;
        await logLoginAttempt(Number(user.id), ipAddress, userAgent, 'failed');
        await logActivity({
            actor_user_id: Number(user.id), actor_username: user.username, tenant_id: tenantIdForLogActivity,
            action_type: 'USER_LOGIN_FAILED',
            description: `Login failed for user '${user.username}': Associated tenant is inactive or not found. IP: ${ipAddress}, UA: ${userAgent}`,
            details: { username: user.username, tenantId: user.tenant_id, reason, ipAddress, userAgent }
        });
        return { message: "Login failed: Tenant account is inactive or does not exist.", success: false };
      }
      tenantName = tenantRes.rows[0].tenant_name;
    }


    if (user.tenant_branch_id && (userRole === 'staff' || userRole === 'housekeeping')) {
      if (!user.tenant_id) {
         await logLoginAttempt(Number(user.id), ipAddress, userAgent, 'failed');
         await logActivity({ actor_user_id: Number(user.id), actor_username: user.username, tenant_id: tenantIdForLogActivity, branch_id: branchIdForLogActivity, action_type: 'USER_LOGIN_ERROR', description: `Login error for '${user.username}': Branch assigned but tenant ID is missing. IP: ${ipAddress}, UA: ${userAgent}`, details: { username: user.username, ipAddress, userAgent } });
        return { message: "Login failed: Branch assignment error.", success: false };
      }
      const branchStatusRes = await client.query(
        'SELECT status FROM tenant_branch WHERE id = $1 AND tenant_id = $2', // Added tenant_id filter
        [user.tenant_branch_id, user.tenant_id]
      );
      if (branchStatusRes.rows.length === 0 || branchStatusRes.rows[0].status !== HOTEL_ENTITY_STATUS.ACTIVE) {
        const reason = branchStatusRes.rows.length === 0 ? "Branch not found" : `Branch inactive (status: ${branchStatusRes.rows[0].status})`;
        await logLoginAttempt(Number(user.id), ipAddress, userAgent, 'failed');
        await logActivity({
            actor_user_id: Number(user.id), actor_username: user.username, tenant_id: tenantIdForLogActivity, branch_id: branchIdForLogActivity,
            action_type: 'USER_LOGIN_FAILED',
            description: `Login failed for user '${user.username}': Assigned branch is inactive or does not exist. IP: ${ipAddress}, UA: ${userAgent}`,
            details: { username: user.username, branchId: user.tenant_branch_id, reason, ipAddress, userAgent }
        });
        return { message: "Login failed: Assigned branch is inactive or does not exist.", success: false };
      }
    }

    await client.query(
      `UPDATE users SET last_log_in = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') WHERE id = $1`,
      [user.id]
    );

    await logLoginAttempt(Number(user.id), ipAddress, userAgent, 'success');
    await logActivity({
      actor_user_id: Number(user.id),
      actor_username: user.username,
      tenant_id: tenantIdForLogActivity,
      branch_id: branchIdForLogActivity,
      action_type: 'USER_LOGIN_SUCCESS',
      description: `User '${user.username}' logged in successfully as role '${userRole}'. Tenant: ${tenantName || 'N/A'}, Branch: ${user.branch_name || 'N/A'}. IP: ${ipAddress}, UA: ${userAgent}`,
      details: { username: user.username, role: userRole, tenantId: user.tenant_id, branchId: user.tenant_branch_id, ipAddress, userAgent }
    });

    return {
      message: "Login successful!",
      success: true,
      role: userRole,
      tenantId: tenantId,
      tenantName: tenantName,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      tenantBranchId: user.tenant_branch_id ? Number(user.tenant_branch_id) : undefined,
      branchName: user.branch_name,
      userId: Number(user.id),
    };

  } catch (dbError: any) {
    console.error("[loginUser DB Error]", dbError);
    // Attempt to log to activity_logs if possible, but primary log here is to login_logs if user ID is known
     if (userIdToLogActivity) { // If we identified a user before the DB error
        await logLoginAttempt(userIdToLogActivity, ipAddress, userAgent, 'failed');
    }
    await logActivity({
      actor_user_id: userIdToLogActivity || 0, // Use identified user ID or 0 if not found before error
      actor_username: attemptedUsername,
      tenant_id: tenantIdForLogActivity,
      branch_id: branchIdForLogActivity,
      action_type: 'USER_LOGIN_ERROR',
      description: `Database error during login attempt for username '${attemptedUsername}': ${dbError.message}. IP: ${ipAddress}, UA: ${userAgent}`,
      details: { attemptedUsername, errorMessage: dbError.message, stack: dbError.stack, ipAddress, userAgent }
    });
    return { message: `A database error occurred. Please try again later.`, success: false };
  } finally {
    if (client) {
      client.release();
    }
  }
}
