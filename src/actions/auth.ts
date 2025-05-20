
"use server";

import pg from 'pg';
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE

import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import type { UserRole } from "@/lib/types";
import { loginSchema } from "@/lib/schemas";

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
  console.error('Unexpected error on idle client', err);
});

export async function loginUser(formData: FormData): Promise<LoginResult> {
  try {
    const parsedData = Object.fromEntries(formData.entries());
    const validatedFields = loginSchema.safeParse(parsedData);

    if (!validatedFields.success) {
      const errorMessages = validatedFields.error.issues.map(issue => `${issue.path.join('.') || 'field'}: ${issue.message}`).join(', ');
      return {
        message: `Invalid form data. ${errorMessages}`,
        success: false,
      };
    }

    const { username, password } = validatedFields.data;
    
    const client = await pool.connect();
    try {
      const userResult = await client.query(
        `SELECT u.id, u.username, u.password_hash, u.role, u.tenant_id, u.first_name, u.last_name, u.tenant_branch_id, tb.branch_name 
         FROM users u
         LEFT JOIN tenant_branch tb ON u.tenant_branch_id = tb.id AND u.tenant_id = tb.tenant_id
         WHERE u.username = $1 AND u.status = '1'`, 
        [username]
      );

      if (userResult.rows.length === 0) {
        return { message: "Invalid username, password, or inactive account.", success: false };
      }

      const user = userResult.rows[0];
      console.log("[auth.ts] User found in DB:", {id: user.id, username: user.username, role: user.role});


      const passwordMatches = bcrypt.compareSync(password, user.password_hash); 

      if (!passwordMatches) {
        return { message: "Invalid username or password.", success: false };
      }
      
      const userRole = user.role as UserRole;
      const validRoles: UserRole[] = ["admin", "sysad", "staff"];
      if (!validRoles.includes(userRole)) {
        console.warn(`User ${username} has an unrecognized role: ${user.role}`);
        return { message: "Login successful, but user role is not recognized for dashboard access.", success: false };
      }

      if (user.tenant_id && userRole !== 'sysad') {
        const tenantStatusRes = await client.query('SELECT status FROM tenants WHERE id = $1', [user.tenant_id]);
        if (tenantStatusRes.rows.length === 0 || tenantStatusRes.rows[0].status !== '1') {
          return { message: "Login failed: Tenant account is inactive or does not exist.", success: false };
        }
      }

      if (user.tenant_branch_id && userRole === 'staff') {
        const branchStatusRes = await client.query('SELECT status FROM tenant_branch WHERE id = $1', [user.tenant_branch_id]);
         if (branchStatusRes.rows.length === 0 || branchStatusRes.rows[0].status !== '1') {
          return { message: "Login failed: Assigned branch is inactive or does not exist.", success: false };
        }
      }


      let tenantId: number | undefined = undefined;
      let tenantName: string | undefined = undefined;

      if (user.tenant_id && userRole !== 'sysad') {
        tenantId = user.tenant_id;
        const tenantResult = await client.query(
          'SELECT tenant_name FROM tenants WHERE id = $1 AND status = \'1\'',
          [user.tenant_id]
        );
        if (tenantResult.rows.length > 0) {
          tenantName = tenantResult.rows[0].tenant_name;
        } else {
          console.warn(`Tenant ID ${user.tenant_id} found for user ${username}, but no matching active tenant in tenants table.`);
           return { message: "Login failed: Associated tenant is inactive or not found.", success: false };
        }
      }

      await client.query(
        'UPDATE users SET last_log_in = (CURRENT_TIMESTAMP AT TIME ZONE \'Asia/Manila\') WHERE id = $1',
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
        tenantBranchId: user.tenant_branch_id,
        branchName: user.branch_name,
        userId: user.id, 
      };
      console.log("[auth.ts] Login result being returned:", loginResultData);
      return loginResultData;

    } catch (dbError) {
      console.error("Database error during login:", dbError);
      return { message: "A database error occurred. Please try again later.", success: false };
    } finally {
      client.release();
    }

  } catch (error) {
    console.error("Login error:", error);
    let errorMessage = "An unexpected error occurred during login.";
    if (error instanceof Error) {
        errorMessage = error.message;
    }
    return { message: errorMessage, success: false };
  }
}

    
