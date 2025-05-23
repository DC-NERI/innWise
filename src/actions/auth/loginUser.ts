
"use server";

import pg from 'pg';
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE
pg.types.setTypeParser(20, (stringValue) => parseInt(stringValue, 10));
pg.types.setTypeParser(1700, (stringValue) => parseFloat(stringValue));

import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import type { UserRole } from "@/lib/types";
import { loginSchema } from "@/lib/schemas";
import { HOTEL_ENTITY_STATUS } from '@/lib/constants';

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

export async function loginUser(formData: FormData): Promise<LoginResult> {
  try {
    const parsedData = Object.fromEntries(formData.entries());
    const validatedFields = loginSchema.safeParse(parsedData);

    if (!validatedFields.success) {
      const errorMessage = "Invalid form data. " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
      return {
        message: errorMessage,
        success: false,
      };
    }

    const { username, password } = validatedFields.data;

    const client = await pool.connect();
    try {
      const loginUserQuery = `
        SELECT u.id, u.username, u.password_hash, u.role, u.tenant_id, u.first_name, u.last_name, u.tenant_branch_id, tb.branch_name
         FROM users u
         LEFT JOIN tenant_branch tb ON u.tenant_branch_id = tb.id AND u.tenant_id = tb.tenant_id
         WHERE u.username = $1 AND u.status = $2
      `;
      const userResult = await client.query(
        loginUserQuery,
        [username, HOTEL_ENTITY_STATUS.ACTIVE.toString()]
      );

      if (userResult.rows.length === 0) {
        return { message: "Invalid username, password, or inactive account.", success: false };
      }

      const user = userResult.rows[0];

      const passwordMatches = bcrypt.compareSync(password, user.password_hash);

      if (!passwordMatches) {
        return { message: "Invalid username or password.", success: false };
      }

      const userRole = user.role as UserRole;
      const validRoles: UserRole[] = ["admin", "sysad", "staff", "housekeeping"];
      if (!validRoles.includes(userRole)) {
        return { message: "Login successful, but user role is not recognized for dashboard access.", success: false };
      }

      // Check tenant status if user is not sysad and has a tenant_id
      if (user.tenant_id && userRole !== 'sysad') {
        const tenantStatusRes = await client.query('SELECT status FROM tenants WHERE id = $1', [user.tenant_id]);
        if (tenantStatusRes.rows.length === 0 || tenantStatusRes.rows[0].status !== HOTEL_ENTITY_STATUS.ACTIVE) {
          return { message: "Login failed: Tenant account is inactive or does not exist.", success: false };
        }
      }

      // Check branch status if user is staff or housekeeping and has a branch_id
      if (user.tenant_branch_id && (userRole === 'staff' || userRole === 'housekeeping')) {
        const branchStatusRes = await client.query('SELECT status FROM tenant_branch WHERE id = $1 AND tenant_id = $2', [user.tenant_branch_id, user.tenant_id]);
         if (branchStatusRes.rows.length === 0 || branchStatusRes.rows[0].status !== HOTEL_ENTITY_STATUS.ACTIVE) {
          return { message: "Login failed: Assigned branch is inactive or does not exist.", success: false };
        }
      }


      let tenantId: number | undefined = undefined;
      let tenantName: string | undefined = undefined;

      if (user.tenant_id && userRole !== 'sysad') {
        tenantId = Number(user.tenant_id);
        const tenantResult = await client.query(
          'SELECT tenant_name FROM tenants WHERE id = $1 AND status = $2',
          [user.tenant_id, HOTEL_ENTITY_STATUS.ACTIVE.toString()]
        );
        if (tenantResult.rows.length > 0) {
          tenantName = tenantResult.rows[0].tenant_name;
        } else {
           return { message: "Login failed: Associated tenant is inactive or not found.", success: false };
        }
      }
      const updateLastLoginQuery = `UPDATE users SET last_log_in = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') WHERE id = $1`;
      await client.query(
        updateLastLoginQuery,
        [user.id]
      );

      const loginResultData: LoginResult = {
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
      return loginResultData;

    } catch (dbError) {
      console.error("[loginUser DB Error]", dbError);
      return { message: `A database error occurred. Please try again later. ${dbError instanceof Error ? dbError.message : String(dbError)}`, success: false };
    } finally {
      client.release();
    }

  } catch (error) {
    let errorMessage = "An unexpected error occurred during login.";
    if (error instanceof Error) {
        errorMessage = error.message;
    }
    return { message: errorMessage, success: false };
  }
}
