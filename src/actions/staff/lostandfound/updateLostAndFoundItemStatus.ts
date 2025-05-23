
"use server";

import pg from 'pg';
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE
pg.types.setTypeParser(20, (stringValue) => parseInt(stringValue, 10));
pg.types.setTypeParser(1700, (stringValue) => parseFloat(stringValue));

import { Pool } from 'pg';
import type { LostAndFoundLog } from '@/lib/types';
import { lostAndFoundUpdateStatusSchema, LostAndFoundUpdateStatusData } from '@/lib/schemas';
import { LOST_AND_FOUND_STATUS } from '@/lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in staff/lostandfound/updateLostAndFoundItemStatus action', err);
});

export async function updateLostAndFoundItemStatus(
  itemId: number,
  data: LostAndFoundUpdateStatusData,
  tenantId: number,
  branchId: number,
  updatedByUserId: number // We might not use updatedByUserId in the table itself, but it's good for audit if needed later
): Promise<{ success: boolean; message?: string; item?: LostAndFoundLog }> {
  const validatedFields = lostAndFoundUpdateStatusSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessage = "Invalid data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
    return { success: false, message: errorMessage };
  }

  const { status: newStatus, claimed_by_details, disposed_details } = validatedFields.data;
  const client = await pool.connect();

  try {
    let claimedAtValue = null;
    if (newStatus === LOST_AND_FOUND_STATUS.CLAIMED) {
      claimedAtValue = `(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')`;
    }

    const query = `
      UPDATE lost_and_found_logs
      SET
        status = $1,
        claimed_by_details = CASE WHEN $1 = ${LOST_AND_FOUND_STATUS.CLAIMED} THEN $2 ELSE claimed_by_details END,
        disposed_details = CASE WHEN $1 = ${LOST_AND_FOUND_STATUS.DISPOSED} THEN $3 ELSE disposed_details END,
        claimed_at = CASE WHEN $1 = ${LOST_AND_FOUND_STATUS.CLAIMED} AND claimed_at IS NULL THEN (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') ELSE claimed_at END,
        updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $4 AND tenant_id = $5 AND branch_id = $6
      RETURNING id, tenant_id, branch_id, item AS item_name, description, found_location, reported_by_user_id, status, found_at, updated_at, claimed_at, claimed_by_details, disposed_details;
    `;

    const res = await client.query(query, [
      newStatus,
      newStatus === LOST_AND_FOUND_STATUS.CLAIMED ? claimed_by_details : null,
      newStatus === LOST_AND_FOUND_STATUS.DISPOSED ? disposed_details : null,
      itemId,
      tenantId,
      branchId
    ]);

    if (res.rows.length > 0) {
      const updatedItem = res.rows[0];
      let reported_by_username = null;
      if (updatedItem.reported_by_user_id) {
        const userRes = await client.query('SELECT username FROM users WHERE id = $1', [updatedItem.reported_by_user_id]);
        if (userRes.rows.length > 0) {
          reported_by_username = userRes.rows[0].username;
        }
      }
      return {
        success: true,
        message: "Lost and found item status updated.",
        item: { ...updatedItem, status: Number(updatedItem.status), reported_by_username } as LostAndFoundLog
      };
    }
    return { success: false, message: "Failed to update item status or item not found." };
  } catch (error) {
    console.error('[updateLostAndFoundItemStatus DB Error]', error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}
