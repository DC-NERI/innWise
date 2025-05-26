
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
import { HOTEL_ENTITY_STATUS } from '../../../lib/constants';
import { logActivity } from '../../activityLogger';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/tenants/archiveTenant action', err);
});

export async function archiveTenant(tenantId: number, sysAdUserId: number): Promise<{ success: boolean; message?: string }> {
  if (!sysAdUserId || sysAdUserId <= 0) {
    return { success: false, message: "Invalid System Administrator ID for logging." };
  }
  if (typeof HOTEL_ENTITY_STATUS?.ARCHIVED === 'undefined') {
    console.error("[archiveTenant] CRITICAL ERROR: HOTEL_ENTITY_STATUS.ARCHIVED is undefined.");
    return { success: false, message: "Server configuration error for archiving tenant." };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch tenant name for logging
    const tenantDetailsRes = await client.query('SELECT tenant_name FROM tenants WHERE id = $1', [tenantId]);
    if (tenantDetailsRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Tenant not found." };
    }
    const tenantName = tenantDetailsRes.rows[0].tenant_name;

    // Archive the tenant
    const updateQuery = `
      UPDATE tenants
      SET status = $1, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $2;
    `;
    const res = await client.query(updateQuery, [HOTEL_ENTITY_STATUS.ARCHIVED, tenantId]);

    if (res.rowCount > 0) {
      // Log the activity
      await logActivity({
        actor_user_id: sysAdUserId,
        action_type: 'SYSAD_ARCHIVED_TENANT',
        description: `SysAd (ID: ${sysAdUserId}) archived tenant '${tenantName}' (ID: ${tenantId}).`,
        target_entity_type: 'Tenant',
        target_entity_id: tenantId.toString(),
        details: { tenant_name: tenantName }
      }, client);

      await client.query('COMMIT');
      return { success: true, message: "Tenant archived successfully." };
    }

    await client.query('ROLLBACK');
    return { success: false, message: "Tenant not found or archive failed." };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[archiveTenant DB Error]', error);
    const dbError = error as Error;
    return { success: false, message: `Database error during tenant archive: ${dbError.message}` };
  } finally {
    client.release();
  }
}
