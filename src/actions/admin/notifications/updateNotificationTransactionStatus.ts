
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
import type { Notification } from '@/lib/types';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/notifications/updateNotificationTransactionStatus action', err);
});

export async function updateNotificationTransactionStatus(
  notificationId: number,
  newTransactionLinkStatus: number, // Renamed to reflect link status
  transactionId: number | null,
  tenantId: number
): Promise<{ success: boolean; message?: string; notification?: Notification }> {
  const client = await pool.connect();
  try {
    const query = `
      UPDATE notification
      SET transaction_status = $1, transaction_id = $2, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $3 AND tenant_id = $4
      RETURNING id, tenant_id, message, status AS notification_read_status, target_branch_id, creator_user_id, transaction_id, created_at, read_at, transaction_status AS notification_link_status, null as target_branch_name, null as creator_username, null as transaction_is_accepted, null as linked_transaction_lifecycle_status, notification_type, priority, acknowledged_at, acknowledged_by_user_id;
    `;
    const res = await client.query(query, [newTransactionLinkStatus, transactionId, notificationId, tenantId]);
    if (res.rows.length > 0) {
      const updatedNotification = res.rows[0];
      // Potentially fetch branch_name and creator_username if needed for the full Notification object
      return {
        success: true,
        message: "Notification transaction link status updated.",
        notification: {
          ...updatedNotification,
          status: Number(updatedNotification.notification_read_status),
          transaction_status: Number(updatedNotification.notification_link_status),
          transaction_is_accepted: updatedNotification.transaction_is_accepted !== null ? Number(updatedNotification.transaction_is_accepted) : null,
          linked_transaction_status: updatedNotification.linked_transaction_lifecycle_status !== null ? Number(updatedNotification.linked_transaction_lifecycle_status) : null,
          priority: updatedNotification.priority !== null ? Number(updatedNotification.priority) : null,
          // Add more fields from row if needed for full Notification type
        } as Notification,
      };
    }
    return { success: false, message: "Notification not found or update failed." };
  } catch (dbError) {
    console.error('[updateNotificationTransactionStatus DB Error]', dbError);
    return { success: false, message: `Database error during notification update: ${dbError instanceof Error ? dbError.message : String(dbError)}` };
  } finally {
    client.release();
  }
}
