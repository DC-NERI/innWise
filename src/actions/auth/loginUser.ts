
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
import { headers } from 'next/headers';
import type { UserRole } from "@/lib/types";
import { loginSchema } from "@/lib/schemas";
import { HOTEL_ENTITY_STATUS } from '@/lib/constants';
import { logActivity } from '../activityLogger';
import { logLoginAttempt } from './logLoginAttempt';

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
  console.error('[loginUser Pool Error] Unexpected error on idle client in auth/loginUser action', err);
});

const loginUserQuery = `
  SELECT u.id, u.username, u.password_hash, u.role, u.tenant_id, u.first_name, u.last_name, u.tenant_branch_id, tb.branch_name
  FROM users u
  LEFT JOIN tenant_branch tb ON u.tenant_branch_id = tb.id AND u.tenant_id = tb.tenant_id
  WHERE u.username = $1 AND u.status = $2
`;

export async function loginUser(formData: FormData): Promise<LoginResult> {
  let client;
  let userIdToLog: number | null = null;
  let tenantIdForActivityLog: number | undefined = undefined;
  let branchIdForActivityLog: number | undefined = undefined;
  let attemptedUsername: string = "";

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
      // Cannot reliably call logLoginAttempt here without a known user or attempted username from valid form data
      return { message: errorMessage, success: false };
    }

    const { username, password } = validatedFields.data;
    attemptedUsername = username;

    client = await pool.connect();
    const userResult = await client.query(
      loginUserQuery,
      [username, HOTEL_ENTITY_STATUS.ACTIVE]
    );

    if (userResult.rows.length === 0) {
      const failureReason = "User not found or inactive.";
      await logLoginAttempt(null, ipAddress, userAgent, 'failed', attemptedUsername, failureReason);
      await logActivity({
        actor_user_id: 0, 
        actor_username: attemptedUsername,
        action_type: 'USER_LOGIN_FAILED',
        description: `Login attempt failed for username '${attemptedUsername}': ${failureReason}. IP: ${ipAddress}, UA: ${userAgent}`,
        details: { attemptedUsername, reason: failureReason, ipAddress, userAgent }
      });
      return { message: "Invalid username, password, or inactive account.", success: false };
    }

    const user = userResult.rows[0];
    userIdToLog = Number(user.id);
    tenantIdForActivityLog = user.tenant_id ? Number(user.tenant_id) : undefined;
    branchIdForActivityLog = user.tenant_branch_id ? Number(user.tenant_branch_id) : undefined;

    const passwordMatches = bcrypt.compareSync(password, user.password_hash);

    if (!passwordMatches) {
      const failureReason = "Incorrect password.";
      await logLoginAttempt(userIdToLog, ipAddress, userAgent, 'failed', attemptedUsername, failureReason);
      await logActivity({
        actor_user_id: userIdToLog,
        actor_username: user.username,
        tenant_id: tenantIdForActivityLog,
        branch_id: branchIdForActivityLog,
        action_type: 'USER_LOGIN_FAILED',
        description: `Login attempt failed for user '${user.username}': ${failureReason}. IP: ${ipAddress}, UA: ${userAgent}`,
        details: { username: user.username, reason: failureReason, ipAddress, userAgent }
      });
      return { message: "Invalid username or password.", success: false };
    }

    const userRole = user.role as UserRole;
    const validRoles: UserRole[] = ["admin", "sysad", "staff", "housekeeping"];
    if (!validRoles.includes(userRole)) {
      const failureReason = `Unrecognized role: ${userRole}.`;
      await logLoginAttempt(userIdToLog, ipAddress, userAgent, 'failed', attemptedUsername, failureReason);
      await logActivity({
        actor_user_id: userIdToLog, actor_username: user.username, tenant_id: tenantIdForActivityLog, branch_id: branchIdForActivityLog,
        action_type: 'USER_LOGIN_FAILED',
        description: `Login attempt for user '${user.username}' had unrecognized role '${userRole}'. IP: ${ipAddress}, UA: ${userAgent}`,
        details: { username: user.username, role: userRole, reason: failureReason, ipAddress, userAgent }
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
        await logLoginAttempt(userIdToLog, ipAddress, userAgent, 'failed', attemptedUsername, `Associated tenant is inactive or not found. Tenant ID: ${user.tenant_id}.`);
        await logActivity({
            actor_user_id: userIdToLog, actor_username: user.username, tenant_id: tenantIdForActivityLog,
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
        const failureReason = "Branch assigned but tenant ID is missing.";
        await logLoginAttempt(userIdToLog, ipAddress, userAgent, 'failed', attemptedUsername, failureReason);
        await logActivity({ actor_user_id: userIdToLog, actor_username: user.username, tenant_id: tenantIdForActivityLog, branch_id: branchIdForActivityLog, action_type: 'USER_LOGIN_ERROR', description: `Login error for '${user.username}': ${failureReason}. IP: ${ipAddress}, UA: ${userAgent}`, details: { username: user.username, ipAddress, userAgent } });
        return { message: "Login failed: Branch assignment error.", success: false };
      }
      const branchStatusRes = await client.query(
        'SELECT status FROM tenant_branch WHERE id = $1 AND tenant_id = $2',
        [user.tenant_branch_id, user.tenant_id]
      );
      if (branchStatusRes.rows.length === 0 || branchStatusRes.rows[0].status !== HOTEL_ENTITY_STATUS.ACTIVE) {
        const reason = branchStatusRes.rows.length === 0 ? "Branch not found" : `Branch inactive (status: ${branchStatusRes.rows[0].status})`;
        await logLoginAttempt(userIdToLog, ipAddress, userAgent, 'failed', attemptedUsername, `Assigned branch is inactive or does not exist. Branch ID: ${user.tenant_branch_id}.`);
        await logActivity({
            actor_user_id: userIdToLog, actor_username: user.username, tenant_id: tenantIdForActivityLog, branch_id: branchIdForActivityLog,
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

    await logLoginAttempt(userIdToLog, ipAddress, userAgent, 'success', attemptedUsername, null);
    await logActivity({
      actor_user_id: userIdToLog,
      actor_username: user.username,
      tenant_id: tenantIdForActivityLog,
      branch_id: branchIdForActivityLog,
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
      userId: userIdToLog,
    };

  } catch (dbError: any) {
    console.error("[loginUser DB Main Error]", dbError);
    // Attempt to log to login_logs if possible, but primary log here is to login_logs if user ID is known
     if (userIdToLog) {
        await logLoginAttempt(userIdToLog, ipAddress, userAgent, 'failed', attemptedUsername, `Database error during login: ${dbError.message}`);
    } else if (attemptedUsername) {
        await logLoginAttempt(null, ipAddress, userAgent, 'failed', attemptedUsername, `Database error during login: ${dbError.message}`);
    }
    await logActivity({
      actor_user_id: userIdToLog || 0,
      actor_username: attemptedUsername,
      tenant_id: tenantIdForActivityLog,
      branch_id: branchIdForActivityLog,
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
