
"use server";

import pg from 'pg';
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE
pg.types.setTypeParser(20, (stringValue) => parseInt(stringValue, 10));
pg.types.setTypeParser(1700, (stringValue) => parseFloat(stringValue));

import { Pool } from 'pg';
import { NOTIFICATION_STATUS } from '@/lib/constants';
import type { Notification } from '@/lib/types';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in staff/notifications/markStaffNotificationAsRead action', err);
});

export async function markStaffNotificationAsRead(notificationId: number, tenantId: number, branchId: number): Promise<{ success: boolean; message?: string, notification?: Notification }> {
  const client = await pool.connect();
  try {
    const checkQuery = 'SELECT status FROM notification WHERE id = $1 AND tenant_id = $2 AND (target_branch_id = $3 OR target_branch_id IS NULL)';
    const checkRes = await client.query(checkQuery, [notificationId, tenantId, branchId]);

    if (checkRes.rows.length === 0) {
      return { success: false, message: "Notification not found or access denied." };
    }
    if (Number(checkRes.rows[0].status) === NOTIFICATION_STATUS.READ) {
      return { success: true, message: "Notification already marked as read." };
    }

    const updateQuery = `
      UPDATE notification
      SET status = $1, read_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $2 AND tenant_id = $3 AND (target_branch_id = $4 OR target_branch_id IS NULL)
      RETURNING *;
    `;
    const res = await client.query(updateQuery, [NOTIFICATION_STATUS.READ.toString(), notificationId, tenantId, branchId]);
    if (res.rows.length > 0) {
      const updatedNotification = res.rows[0];
      return {
        success: true,
        message: "Notification marked as read.",
        notification: {
          ...updatedNotification,
          status: Number(updatedNotification.status),
          transaction_link_status: Number(updatedNotification.transaction_status),
          transaction_is_accepted: updatedNotification.transaction_is_accepted !== null ? Number(updatedNotification.transaction_is_accepted) : null,
          linked_transaction_status: updatedNotification.linked_transaction_status !== null ? Number(updatedNotification.linked_transaction_status) : null,
          priority: updatedNotification.priority !== null ? Number(updatedNotification.priority) : null,
        }
      };
    }
    return { success: false, message: "Failed to mark notification as read." };
  } catch (error) {
    console.error('[markStaffNotificationAsRead DB Error]', error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}
