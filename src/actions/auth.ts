"use server";

import { Pool } from 'pg';
import type { UserRole } from "@/lib/types";
import { loginSchema } from "@/lib/schemas";

export type LoginResult = {
  success: boolean;
  message: string;
  role?: UserRole;
};

// Initialize PostgreSQL connection pool
// Ensure your POSTGRES_URL environment variable is set.
// For Next.js, environment variables are automatically loaded from .env.local
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false, // Required for Neon, adjust if your DB doesn't need SSL or has a different config
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  // process.exit(-1); // Optional: exit if a serious error occurs with the pool
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
      // Query the users table
      // IMPORTANT SECURITY NOTE: This directly compares the input password with the 'password_hash' column.
      // In a real application, you MUST hash the input password using a strong algorithm (e.g., bcrypt)
      // and compare it against a securely hashed password stored in the database.
      // Storing plain text passwords or using weak hashing is a severe security risk.
      const userResult = await client.query(
        'SELECT id, username, password_hash, role FROM users WHERE username = $1',
        [username]
      );

      if (userResult.rows.length === 0) {
        return { message: "Invalid username or password.", success: false };
      }

      const user = userResult.rows[0];

      // Direct password comparison (INSECURE for production)
      const passwordMatches = user.password_hash === password; 

      if (!passwordMatches) {
        // For security, use the same generic message for invalid username or password
        return { message: "Invalid username or password.", success: false };
      }
      
      // Validate user role
      const userRole = user.role as UserRole;
      const validRoles: UserRole[] = ["admin", "sysad", "staff"];
      if (!validRoles.includes(userRole)) {
        console.warn(`User ${username} has an unrecognized role: ${user.role}`);
        return { message: "Login successful, but user role is not recognized for dashboard access.", success: false };
      }

      // Update last_log_in timestamp
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
