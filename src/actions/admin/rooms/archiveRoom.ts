
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

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/rooms/archiveRoom action', err);
});

export async function archiveRoom(
roomId: number, tenantId: number, branchId: number, adminUserId: number): Promise<{ success: boolean; message?: string }> {
  const client = await pool.connect();
  try {
    const query = `
      UPDATE hotel_room
      SET status = $1, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $2 AND tenant_id = $3 AND branch_id = $4;
    `;
    const res = await client.query(query, [
      HOTEL_ENTITY_STATUS.ARCHIVED,
      roomId,
      tenantId,
      branchId,
    ]);

    if (res.rowCount > 0) {
      return { success: true, message: "Room archived successfully." };
    }
    return { success: false, message: "Room not found or archive failed." };
  } catch (error) {
    console.error('[archiveRoom DB Error]', error);
    return { success: false, message: `Database error during room archive: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}
    