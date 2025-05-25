
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
import { adminResetPasswordSchema, AdminResetPasswordData } from '@/lib/schemas';
import { logActivity } from '../../activityLogger'; // Adjusted path

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/users/resetUserPasswordAdmin action', err);
});

export async function resetUserPasswordAdmin(
  targetUserId: number,
  newPasswordData: AdminResetPasswordData,
  callingAdminUserId: number,
  tenantId: number
): Promise<{ success: boolean; message?: string }> {
  if (!callingAdminUserId || callingAdminUserId <=0 ) {
    return { success: false, message: "Invalid administrator ID." };
  }
  if (!targetUserId || targetUserId <=0 ) {
    return { success: false, message: "Invalid target user ID." };
  }

  const validatedFields = adminResetPasswordSchema.safeParse(newPasswordData);
  if (!validatedFields.success) {
    const errorMessage = "Invalid password data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
    return { success: false, message: errorMessage };
  }
  const { new_password } = validatedFields.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Verify target user belongs to the admin's tenant and is not sysad (admins cannot reset sysad passwords)
    const userCheckQuery = `SELECT username, role FROM users WHERE id = $1 AND tenant_id = $2 AND role != 'sysad'`;
    const userCheckRes = await client.query(userCheckQuery, [targetUserId, tenantId]);

    if (userCheckRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "User not found in your tenant or password reset is not permitted for this role." };
    }
    const targetUsername = userCheckRes.rows[0].username;

    const salt = bcrypt.genSaltSync(10);
    const password_hash = bcrypt.hashSync(new_password, salt);

    const updateQuery = `UPDATE users SET password_hash = $1, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') WHERE id = $2 AND tenant_id = $3`;
    const updateResult = await client.query(updateQuery, [password_hash, targetUserId, tenantId]);

    if (updateResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return { success: false, message: "Failed to update user password. User might have been modified or deleted." };
    }

    try {
      await logActivity({
        tenant_id: tenantId,
        actor_user_id: callingAdminUserId,
        action_type: 'ADMIN_RESET_USER_PASSWORD',
        description: `Admin (ID: ${callingAdminUserId}) reset password for user '${targetUsername}' (ID: ${targetUserId}).`,
        target_entity_type: 'User',
        target_entity_id: targetUserId.toString(),
      }, client);
    } catch (logError) {
      console.error("[resetUserPasswordAdmin] Failed to log activity:", logError);
      // Do not let logging failure roll back the primary action
    }

    await client.query('COMMIT');
    return { success: true, message: `Password for user ${targetUsername} reset successfully.` };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[resetUserPasswordAdmin DB Error]', error);
    return { success: false, message: `Database error during password reset: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}
