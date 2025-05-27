
"use server";

import pg from 'pg';
// Configure pg to return numeric types as numbers
pg.types.setTypeParser(pg.types.builtins.INT2, (val: string) => parseInt(val, 10));
pg.types.setTypeParser(pg.types.builtins.INT4, (val: string) => parseInt(val, 10));
pg.types.setTypeParser(pg.types.builtins.INT8, (val: string) => parseInt(val, 10));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (val: string) => parseFloat(val));
// Configure pg to return timestamp without timezone as strings
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (stringValue: string) => stringValue);
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (stringValue: string) => stringValue);

import { Pool } from 'pg';
import type { Notification } from '@/lib/types';
// Constants are not directly used in this query's WHERE clause for status filtering,
// but they help in understanding the data structure and for client-side mapping.

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('[listNotificationsForBranch Pool Error] Unexpected error on idle client:', err);
});

export async function listNotificationsForBranch(tenantId: number, branchId: number): Promise<Notification[]> {
  if (typeof tenantId !== 'number' || isNaN(tenantId) || typeof branchId !== 'number' || isNaN(branchId)) {
    console.warn(`[listNotificationsForBranch] Invalid tenantId (${tenantId}) or branchId (${branchId}). Aborting fetch.`);
    return [];
  }

  let client: pg.PoolClient | undefined;
  try {
    client = await pool.connect();
    const query = `
      SELECT
        n.id,
        n.tenant_id,
        n.message,
        n.status AS notification_read_status,        -- Notification read/unread status (VARCHAR in DB, e.g. '0', '1')
        n.target_branch_id,
        tb.branch_name AS target_branch_name,
        n.creator_user_id,
        u.username AS creator_username,
        n.transaction_id,
        n.transaction_status AS notification_link_status, -- Notification link status (INTEGER in DB)
        n.created_at,
        n.read_at,
        t.is_accepted AS transaction_is_accepted,      -- Transaction acceptance status (SMALLINT in DB)
        t.status AS linked_transaction_lifecycle_status, -- Transaction lifecycle status (VARCHAR in DB, e.g. '0'-'6')
        n.notification_type,
        n.priority,
        n.acknowledged_at,
        n.acknowledged_by_user_id
      FROM notification n
      LEFT JOIN users u ON n.creator_user_id = u.id
      LEFT JOIN tenant_branch tb ON n.target_branch_id = tb.id AND n.tenant_id = tb.tenant_id
      LEFT JOIN transactions t ON n.transaction_id = t.id AND n.tenant_id = t.tenant_id AND (n.target_branch_id = t.branch_id OR n.target_branch_id IS NULL)
      WHERE n.tenant_id = $1 AND (n.target_branch_id = $2 OR n.target_branch_id IS NULL)
      ORDER BY n.created_at DESC;
    `;
    const res = await client.query(query, [tenantId, branchId]);

    return res.rows.map(row => {
      const notification: Notification = {
        id: Number(row.id),
        tenant_id: Number(row.tenant_id),
        message: row.message,
        status: Number(row.notification_read_status), // Read/unread status
        target_branch_id: row.target_branch_id ? Number(row.target_branch_id) : null,
        target_branch_name: row.target_branch_name,
        creator_user_id: row.creator_user_id ? Number(row.creator_user_id) : null,
        creator_username: row.creator_username,
        transaction_id: row.transaction_id ? Number(row.transaction_id) : null,
        created_at: String(row.created_at),
        read_at: row.read_at ? String(row.read_at) : null,
        transaction_status: Number(row.notification_link_status), // Link status
        transaction_is_accepted: row.transaction_is_accepted !== null ? Number(row.transaction_is_accepted) : null,
        linked_transaction_lifecycle_status: row.linked_transaction_lifecycle_status !== null ? String(row.linked_transaction_lifecycle_status) : null, // Keep as string from DB for now, to be cast to Number on client if needed
        notification_type: row.notification_type,
        priority: row.priority !== null ? Number(row.priority) : null,
        acknowledged_at: row.acknowledged_at ? String(row.acknowledged_at) : null,
        acknowledged_by_user_id: row.acknowledged_by_user_id ? Number(row.acknowledged_by_user_id) : null,
      };
      return notification;
    });
  } catch (dbError: any) {
    console.error('[listNotificationsForBranch DB Error Raw]', dbError);
    const errorMessage = dbError?.message || 'Unknown database error occurred while fetching notifications.';
    throw new Error(`Database error in listNotificationsForBranch: ${errorMessage}`);
  } finally {
    if (client) {
      client.release();
    }
  }
}
