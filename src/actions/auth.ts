
"use server";

import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import type { UserRole } from "@/lib/types";
import { loginSchema } from "@/lib/schemas";

export type LoginResult = {
  success: boolean;
  message: string;
  role?: UserRole;
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
        'SELECT id, username, password_hash, role FROM users WHERE username = $1',
        [username]
      );

      if (userResult.rows.length === 0) {
        return { message: "Invalid username or password.", success: false };
      }

      const user = userResult.rows[0];

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

      await client.query(
        'UPDATE users SET last_log_in = CURRENT_TIMESTAMP WHERE id = $1',
        [user.id]
      );
      
      console.log(`User ${user.username} (Role: ${userRole}) logged in at ${new Date().toISOString()}.`);
      return { message: "Login successful!", success: true, role: userRole };

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
