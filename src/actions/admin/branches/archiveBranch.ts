
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
  console.error('Unexpected error on idle client in admin/branches/archiveBranch action', err);
});

export async function archiveBranch(branchId: number, sysAdUserId: number): Promise<{ success: boolean; message?: string }> {
  if (typeof HOTEL_ENTITY_STATUS?.ARCHIVED === 'undefined') {
    console.error('[archiveBranch] CRITICAL ERROR: HOTEL_ENTITY_STATUS.ARCHIVED is undefined.');
    return { success: false, message: 'Server configuration error for archiving branch.' };
  }
  if (!sysAdUserId || sysAdUserId <= 0) {
    return { success: false, message: "Invalid System Administrator ID for logging." };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const branchDetailsRes = await client.query('SELECT branch_name, tenant_id FROM tenant_branch WHERE id = $1', [branchId]);
    if (branchDetailsRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Branch not found." };
    }
    const { branch_name, tenant_id } = branchDetailsRes.rows[0];

    const query = `
      UPDATE tenant_branch
      SET status = $1, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $2;
    `;
    const res = await client.query(query, [HOTEL_ENTITY_STATUS.ARCHIVED, branchId]);

    if (res.rowCount > 0) {
      await logActivity({
        tenant_id: tenant_id,
        branch_id: branchId,
        actor_user_id: sysAdUserId,
        action_type: 'SYSAD_ARCHIVED_BRANCH',
        description: `SysAd (ID: ${sysAdUserId}) archived branch '${branch_name}' (ID: ${branchId}).`,
        target_entity_type: 'Branch',
        target_entity_id: branchId.toString(),
        details: { branch_name }
      }, client);
      await client.query('COMMIT');
      return { success: true, message: "Branch archived successfully." };
    }
    await client.query('ROLLBACK');
    return { success: false, message: "Branch not found or archive failed." };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[archiveBranch DB Error]', error);
    return { success: false, message: `Database error during branch archive: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}
