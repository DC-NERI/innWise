
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
import { HOTEL_ENTITY_STATUS } from '../../../lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/users/archiveUserAdmin action', err);
});

export async function archiveUserAdmin(userId: number, callingTenantId: number): Promise<{ success: boolean; message?: string }> {
  if (typeof HOTEL_ENTITY_STATUS?.ARCHIVED === 'undefined') {
    console.error('[archiveUserAdmin] CRITICAL ERROR: HOTEL_ENTITY_STATUS.ARCHIVED is undefined.');
    return { success: false, message: 'Server configuration error for archiving user.' };
  }
  const client = await pool.connect();
  try {
    // Verify that the user being archived belongs to the admin's tenant and is not a sysad
    const userCheckRes = await client.query('SELECT role FROM users WHERE id = $1 AND tenant_id = $2', [userId, callingTenantId]);
    if (userCheckRes.rows.length === 0) {
      return { success: false, message: "User not found in your tenant or access denied." };
    }
    if (userCheckRes.rows[0].role === 'sysad') {
      return { success: false, message: "SysAd users cannot be archived by tenant admins." };
    }

    const query = `
      UPDATE users
      SET status = $1, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $2 AND tenant_id = $3 AND role != 'sysad';
    `;
    const res = await client.query(query, [HOTEL_ENTITY_STATUS.ARCHIVED, userId, callingTenantId]);

    if (res.rowCount > 0) {
      return { success: true, message: "User archived successfully." };
    }
    return { success: false, message: "User not found, not in your tenant, or archive failed." };
  } catch (error) {
    console.error('[archiveUserAdmin DB Error]', error);
    return { success: false, message: `Database error during user archive: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}
    