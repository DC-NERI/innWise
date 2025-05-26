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
import { logActivity } from '../activityLogger'; // Assuming this is at src/actions/activityLogger.ts
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
  console.error('[loginUser Pool Error] Unexpected error on idle client:', err);
});

const loginUserQuery = `
  SELECT u.id, u.username, u.password_hash, u.role, u.tenant_id, u.first_name, u.last_name, u.tenant_branch_id, tb.branch_name, t.tenant_name
  FROM users u
  LEFT JOIN tenants t ON u.tenant_id = t.id
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
    attemptedUsername = parsedData.username ? String(parsedData.username) : "";
    const validatedFields = loginSchema.safeParse(parsedData);

    if (!validatedFields.success) {
      const errorFields = validatedFields.error.flatten().fieldErrors;
      const flatMessages = Object.values(errorFields).flat().join(' ');
      const errorMessage = "Invalid form data: " + flatMessages;
      const logErrorDetails = `Attempted Username: ${attemptedUsername}. Reason: ${errorMessage}`;
      await logLoginAttempt(null, ipAddress, userAgent, 'failed', logErrorDetails);
      // activityLogger already captures this if logLoginAttempt is not used for it
      return { message: errorMessage, success: false };
    }

    const { username, password } = validatedFields.data;
    attemptedUsername = username; // Ensure attemptedUsername is set to the validated username

    client = await pool.connect();
    const userResult = await client.query(
      loginUserQuery,
      [username, HOTEL_ENTITY_STATUS.ACTIVE]
    );

    if (userResult.rows.length === 0) {
      const failureReason = "User not found or inactive.";
      const logErrorDetails = `Attempted Username: ${attemptedUsername}. Reason: ${failureReason}`;
      await logLoginAttempt(null, ipAddress, userAgent, 'failed', logErrorDetails);
      await logActivity({
        actor_user_id: 0, 
        actor_username: attemptedUsername,
        action_type: 'USER_LOGIN_FAILED',
        description: `Login attempt failed for username '${attemptedUsername}': ${failureReason}. IP: ${ipAddress}.`,
        details: { attemptedUsername, reason: failureReason, ipAddress, userAgent: userAgent.substring(0, 255) } // Truncate userAgent if too long for activity log
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
      const logErrorDetails = `Attempted Username: ${attemptedUsername}. Reason: ${failureReason}`;
      await logLoginAttempt(userIdToLog, ipAddress, userAgent, 'failed', logErrorDetails);
      await logActivity({
        actor_user_id: userIdToLog,
        actor_username: user.username,
        tenant_id: tenantIdForActivityLog,
        branch_id: branchIdForActivityLog,
        action_type: 'USER_LOGIN_FAILED',
        description: `Login attempt failed for user '${user.username}': ${failureReason}. IP: ${ipAddress}.`,
        details: { username: user.username, reason: failureReason, ipAddress, userAgent: userAgent.substring(0, 255) }
      });
      return { message: "Invalid username or password.", success: false };
    }

    const userRole = user.role as UserRole;
    const validRoles: UserRole[] = ["admin", "sysad", "staff", "housekeeping"];
    if (!validRoles.includes(userRole)) {
      const failureReason = `Unrecognized role: ${userRole}.`;
      const logErrorDetails = `Attempted Username: ${attemptedUsername}. Reason: ${failureReason}`;
      await logLoginAttempt(userIdToLog, ipAddress, userAgent, 'failed', logErrorDetails);
      await logActivity({
        actor_user_id: userIdToLog, actor_username: user.username, tenant_id: tenantIdForActivityLog, branch_id: branchIdForActivityLog,
        action_type: 'USER_LOGIN_FAILED',
        description: `Login attempt for user '${user.username}' had unrecognized role '${userRole}'. IP: ${ipAddress}.`,
        details: { username: user.username, role: userRole, reason: failureReason, ipAddress, userAgent: userAgent.substring(0, 255) }
      });
      return { message: "Login successful, but user role is not recognized for dashboard access.", success: false };
    }

    let tenantId: number | undefined = undefined;
    let tenantName: string | undefined = undefined;

    if (user.tenant_id && userRole !== 'sysad') {
      tenantId = Number(user.tenant_id);
      // We already joined tenants table, so user.tenant_name should be available if tenant_id is not null
      if (!user.tenant_name) { // This would imply an issue with the join or data integrity
         const tenantRes = await client.query('SELECT tenant_name, status FROM tenants WHERE id = $1', [user.tenant_id]);
         if (tenantRes.rows.length === 0 || tenantRes.rows[0].status !== HOTEL_ENTITY_STATUS.ACTIVE) {
            const reason = tenantRes.rows.length === 0 ? "Tenant not found" : `Tenant inactive (status: ${tenantRes.rows[0].status})`;
            const logErrorDetails = `Attempted Username: ${attemptedUsername}. Reason: Associated tenant ${reason}. Tenant ID: ${user.tenant_id}.`;
            await logLoginAttempt(userIdToLog, ipAddress, userAgent, 'failed', logErrorDetails);
            await logActivity({
                actor_user_id: userIdToLog, actor_username: user.username, tenant_id: tenantIdForActivityLog,
                action_type: 'USER_LOGIN_FAILED',
                description: `Login failed for user '${user.username}': Associated tenant is inactive or not found. IP: ${ipAddress}.`,
                details: { username: user.username, tenantId: user.tenant_id, reason, ipAddress, userAgent: userAgent.substring(0, 255) }
            });
            return { message: "Login failed: Tenant account is inactive or does not exist.", success: false };
          }
          tenantName = tenantRes.rows[0].tenant_name;
      } else {
          tenantName = user.tenant_name;
      }
    }


    if (user.tenant_branch_id && (userRole === 'staff' || userRole === 'housekeeping')) {
      if (!user.tenant_id) {
        const failureReason = "Branch assigned but tenant ID is missing for user.";
        const logErrorDetails = `Attempted Username: ${attemptedUsername}. Reason: ${failureReason}`;
        await logLoginAttempt(userIdToLog, ipAddress, userAgent, 'failed', logErrorDetails);
        await logActivity({ actor_user_id: userIdToLog, actor_username: user.username, tenant_id: tenantIdForActivityLog, branch_id: branchIdForActivityLog, action_type: 'USER_LOGIN_ERROR', description: `Login error for '${user.username}': ${failureReason}. IP: ${ipAddress}.`, details: { username: user.username, ipAddress, userAgent: userAgent.substring(0, 255) } });
        return { message: "Login failed: Branch assignment error.", success: false };
      }
      // We already joined tenant_branch, so user.branch_name should be available
      // A specific status check on branch might still be needed if branch_name is present but status is not active
      const branchStatusRes = await client.query(
        'SELECT status FROM tenant_branch WHERE id = $1 AND tenant_id = $2',
        [user.tenant_branch_id, user.tenant_id]
      );
      if (branchStatusRes.rows.length === 0 || branchStatusRes.rows[0].status !== HOTEL_ENTITY_STATUS.ACTIVE) {
        const reason = branchStatusRes.rows.length === 0 ? "Branch not found" : `Branch inactive (status: ${branchStatusRes.rows[0].status})`;
        const logErrorDetails = `Attempted Username: ${attemptedUsername}. Reason: Assigned branch ${reason}. Branch ID: ${user.tenant_branch_id}.`;
        await logLoginAttempt(userIdToLog, ipAddress, userAgent, 'failed', logErrorDetails);
        await logActivity({
            actor_user_id: userIdToLog, actor_username: user.username, tenant_id: tenantIdForActivityLog, branch_id: branchIdForActivityLog,
            action_type: 'USER_LOGIN_FAILED',
            description: `Login failed for user '${user.username}': Assigned branch is inactive or does not exist. IP: ${ipAddress}.`,
            details: { username: user.username, branchId: user.tenant_branch_id, reason, ipAddress, userAgent: userAgent.substring(0, 255) }
        });
        return { message: "Login failed: Assigned branch is inactive or does not exist.", success: false };
      }
    }

    await client.query(
      `UPDATE users SET last_log_in = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') WHERE id = $1`,
      [user.id]
    );

    await logLoginAttempt(userIdToLog, ipAddress, userAgent, 'success', null); // No error details for success
    await logActivity({
      actor_user_id: userIdToLog,
      actor_username: user.username,
      tenant_id: tenantIdForActivityLog,
      branch_id: branchIdForActivityLog,
      action_type: 'USER_LOGIN_SUCCESS',
      description: `User '${user.username}' logged in successfully as role '${userRole}'. Tenant: ${tenantName || 'N/A'}, Branch: ${user.branch_name || 'N/A'}. IP: ${ipAddress}.`,
      details: { username: user.username, role: userRole, tenantId: user.tenant_id, branchId: user.tenant_branch_id, ipAddress, userAgent: userAgent.substring(0, 255) }
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
    const logErrorDetails = `Attempted Username: ${attemptedUsername}. Reason: Database error during login: ${dbError.message}`;
    await logLoginAttempt(userIdToLog, ipAddress, userAgent, 'failed', logErrorDetails);
    
    await logActivity({
      actor_user_id: userIdToLog || 0, // If userIdToLog is null, log as system-level issue
      actor_username: attemptedUsername || 'Unknown',
      tenant_id: tenantIdForActivityLog,
      branch_id: branchIdForActivityLog,
      action_type: 'USER_LOGIN_ERROR',
      description: `Database error during login attempt for username '${attemptedUsername}': ${dbError.message}. IP: ${ipAddress}.`,
      details: { attemptedUsername, errorMessage: dbError.message, stack: dbError.stack, ipAddress, userAgent: userAgent.substring(0, 255) }
    });
    return { message: `A database error occurred. Please try again later.`, success: false };
  } finally {
    if (client) {
      client.release();
    }
  }
}
