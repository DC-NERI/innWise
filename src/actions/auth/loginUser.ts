
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
import type { UserRole } from "@/lib/types";
import { loginSchema } from "@/lib/schemas";
import { HOTEL_ENTITY_STATUS } from '@/lib/constants';
import { logActivity } from '@/actions/activityLogger';

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
  let userIdToLog: number | undefined = undefined;
  let tenantIdForLog: number | undefined = undefined;
  let branchIdForLog: number | undefined = undefined;
  let attemptedUsername: string = "";

  try {
    const parsedData = Object.fromEntries(formData.entries());
    const validatedFields = loginSchema.safeParse(parsedData);

    if (!validatedFields.success) {
      const errorMessage = "Invalid form data. " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
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
        description: `Login attempt failed for username '${attemptedUsername}': User not found or inactive.`,
        details: { attemptedUsername, reason: "User not found or inactive" }
      });
      return { message: "Invalid username, password, or inactive account.", success: false };
    }

    const user = userResult.rows[0];
    userIdToLog = user.id;
    tenantIdForLog = user.tenant_id;
    branchIdForLog = user.tenant_branch_id;

    const passwordMatches = bcrypt.compareSync(password, user.password_hash);

    if (!passwordMatches) {
      await logActivity({
        actor_user_id: user.id,
        actor_username: user.username,
        tenant_id: user.tenant_id,
        branch_id: user.tenant_branch_id,
        action_type: 'USER_LOGIN_FAILED',
        description: `Login attempt failed for user '${user.username}': Incorrect password.`,
        details: { username: user.username, reason: "Incorrect password" }
      });
      return { message: "Invalid username or password.", success: false };
    }

    const userRole = user.role as UserRole;
    const validRoles: UserRole[] = ["admin", "sysad", "staff", "housekeeping"];
    if (!validRoles.includes(userRole)) {
       await logActivity({
        actor_user_id: user.id,
        actor_username: user.username,
        tenant_id: user.tenant_id,
        branch_id: user.tenant_branch_id,
        action_type: 'USER_LOGIN_FAILED',
        description: `Login attempt successful for user '${user.username}', but role '${userRole}' is not recognized for dashboard access.`,
        details: { username: user.username, role: userRole, reason: "Unrecognized role" }
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
        await logActivity({
            actor_user_id: user.id, actor_username: user.username, tenant_id: user.tenant_id,
            action_type: 'USER_LOGIN_FAILED',
            description: `Login failed for user '${user.username}': Associated tenant is inactive or not found.`,
            details: { username: user.username, tenantId: user.tenant_id, reason }
        });
        return { message: "Login failed: Tenant account is inactive or does not exist.", success: false };
      }
      tenantName = tenantRes.rows[0].tenant_name;
    }


    if (user.tenant_branch_id && (userRole === 'staff' || userRole === 'housekeeping')) {
      if (!user.tenant_id) { // Should not happen if branch_id is set, but good check
         await logActivity({ actor_user_id: user.id, actor_username: user.username, tenant_id: user.tenant_id, branch_id: user.tenant_branch_id, action_type: 'USER_LOGIN_ERROR', description: `Login error for '${user.username}': Branch assigned but tenant ID is missing.`, details: { username: user.username } });
        return { message: "Login failed: Branch assignment error.", success: false };
      }
      const branchStatusRes = await client.query(
        'SELECT status FROM tenant_branch WHERE id = $1 AND tenant_id = $2',
        [user.tenant_branch_id, user.tenant_id]
      );
      if (branchStatusRes.rows.length === 0 || branchStatusRes.rows[0].status !== HOTEL_ENTITY_STATUS.ACTIVE) {
        const reason = branchStatusRes.rows.length === 0 ? "Branch not found" : `Branch inactive (status: ${branchStatusRes.rows[0].status})`;
        await logActivity({
            actor_user_id: user.id, actor_username: user.username, tenant_id: user.tenant_id, branch_id: user.tenant_branch_id,
            action_type: 'USER_LOGIN_FAILED',
            description: `Login failed for user '${user.username}': Assigned branch is inactive or does not exist.`,
            details: { username: user.username, branchId: user.tenant_branch_id, reason }
        });
        return { message: "Login failed: Assigned branch is inactive or does not exist.", success: false };
      }
    }

    await client.query(
      `UPDATE users SET last_log_in = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') WHERE id = $1`,
      [user.id]
    );

    await logActivity({
      actor_user_id: user.id,
      actor_username: user.username,
      tenant_id: user.tenant_id,
      branch_id: user.tenant_branch_id,
      action_type: 'USER_LOGIN_SUCCESS',
      description: `User '${user.username}' logged in successfully as role '${userRole}'. Tenant: ${tenantName || 'N/A'}, Branch: ${user.branch_name || 'N/A'}.`,
      details: { username: user.username, role: userRole, tenantId: user.tenant_id, branchId: user.tenant_branch_id }
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
    await logActivity({
      actor_user_id: userIdToLog || 0,
      actor_username: attemptedUsername,
      tenant_id: tenantIdForLog,
      branch_id: branchIdForLog,
      action_type: 'USER_LOGIN_ERROR',
      description: `Database error during login attempt for username '${attemptedUsername}': ${dbError.message}`,
      details: { attemptedUsername, errorMessage: dbError.message, stack: dbError.stack }
    });
    return { message: `A database error occurred. Please try again later.`, success: false };
  } finally {
    if (client) {
      client.release();
    }
  }
}

    