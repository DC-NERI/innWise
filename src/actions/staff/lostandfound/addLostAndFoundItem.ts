
"use server";

import pg from 'pg';
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE
pg.types.setTypeParser(20, (stringValue) => parseInt(stringValue, 10));
pg.types.setTypeParser(1700, (stringValue) => parseFloat(stringValue));

import { Pool } from 'pg';
import type { LostAndFoundLog } from '@/lib/types';
import { lostAndFoundCreateSchema, LostAndFoundCreateData } from '@/lib/schemas';
import { LOST_AND_FOUND_STATUS } from '@/lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in staff/lostandfound/addLostAndFoundItem action', err);
});

export async function addLostAndFoundItem(
  data: LostAndFoundCreateData,
  tenantId: number,
  branchId: number,
  reportedByUserId: number
): Promise<{ success: boolean; message?: string; item?: LostAndFoundLog }> {
  const validatedFields = lostAndFoundCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessage = "Invalid data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
    return { success: false, message: errorMessage };
  }

  const { item_name, description, found_location } = validatedFields.data;
  const client = await pool.connect();

  try {
    const query = `
      INSERT INTO lost_and_found_logs (
        tenant_id, branch_id, item, description, found_location,
        reported_by_user_id, status, found_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'))
      RETURNING id, tenant_id, branch_id, item AS item_name, description, found_location, reported_by_user_id, status, found_at, updated_at, claimed_at, claimed_by_details, disposed_details;
    `;
    const res = await client.query(query, [
      tenantId, branchId, item_name, description, found_location,
      reportedByUserId, LOST_AND_FOUND_STATUS.FOUND
    ]);

    if (res.rows.length > 0) {
      const newItem = res.rows[0];
      // Fetch username for the newly created item
      let reported_by_username = null;
      if (newItem.reported_by_user_id) {
        const userRes = await client.query('SELECT username FROM users WHERE id = $1', [newItem.reported_by_user_id]);
        if (userRes.rows.length > 0) {
          reported_by_username = userRes.rows[0].username;
        }
      }
      return {
        success: true,
        message: "Lost and found item logged successfully.",
        item: { ...newItem, status: Number(newItem.status), reported_by_username } as LostAndFoundLog
      };
    }
    return { success: false, message: "Failed to log item." };
  } catch (error) {
    console.error('[addLostAndFoundItem DB Error]', error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}
