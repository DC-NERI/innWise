
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
import { HOTEL_ENTITY_STATUS } from '../../../lib/constants'; // Adjusted path
import { logActivity } from '../../activityLogger'; // Adjusted path

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/users/archiveUser action', err);
});

export async function archiveUser(userId: number, sysAdUserId: number): Promise<{ success: boolean; message?: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch user details for logging
    const userDetailsRes = await client.query('SELECT username, tenant_id, tenant_branch_id FROM users WHERE id = $1', [userId]);
    if (userDetailsRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "User not found." };
    }
    const { username, tenant_id, tenant_branch_id } = userDetailsRes.rows[0];

    const query = `
      UPDATE users
      SET status = $1, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $2;
    `;
    const res = await client.query(query, [HOTEL_ENTITY_STATUS.ARCHIVED, userId]);

    if (res.rowCount > 0) {
      await logActivity({
          tenant_id: tenant_id,
          branch_id: tenant_branch_id,
          actor_user_id: sysAdUserId,
          action_type: 'SYSAD_ARCHIVED_USER',
          description: `SysAd (ID: ${sysAdUserId}) archived user '${username}' (ID: ${userId}).`,
          target_entity_type: 'User',
          target_entity_id: userId.toString(),
          details: { username }
      }, client);
      await client.query('COMMIT');
      return { success: true, message: "User archived successfully." };
    }
    await client.query('ROLLBACK');
    return { success: false, message: "User not found or archive failed." };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[archiveUser DB Error]', error);
    return { success: false, message: `Database error during user archive: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}
