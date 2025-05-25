
"use server";

import pg from 'pg';
// Configure pg to return numeric types as numbers instead of strings
pg.types.setTypeParser(20, (val) => parseInt(val, 10)); // int8/bigint
// Add other type parsers if needed (int2, int4, numeric, timestamp)

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/notifications/deleteNotification action', err);
});

export async function deleteNotification(notificationId: number, tenantId: number): Promise<{ success: boolean; message?: string }> {
  const client = await pool.connect();
  try {
    // Optional: Check if notification has a linked, active transaction and prevent deletion if necessary
    // For now, we'll allow deletion. Constraints on transaction_id should be ON DELETE SET NULL or similar.
    const res = await client.query('DELETE FROM notification WHERE id = $1 AND tenant_id = $2', [notificationId, tenantId]);
    if (res.rowCount > 0) {
      return { success: true, message: "Notification deleted successfully." };
    }
    return { success: false, message: "Notification not found or delete failed." };
  } catch (dbError: any) {
    console.error('[deleteNotification DB Error]', dbError);
    // Handle foreign key constraint violation (e.g., PostgreSQL error code 23503)
    if (dbError.code === '23503') {
      return { success: false, message: "Cannot delete this notification. It might be linked to an active transaction or other records." };
    }
    return { success: false, message: `Database error during notification deletion: ${dbError.message || String(dbError)}` };
  } finally {
    client.release();
  }
}
