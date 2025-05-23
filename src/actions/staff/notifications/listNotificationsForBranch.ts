
"use server";

import pg from 'pg';
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE
pg.types.setTypeParser(20, (stringValue) => parseInt(stringValue, 10));
pg.types.setTypeParser(1700, (stringValue) => parseFloat(stringValue));

import { Pool } from 'pg';
import type { Notification } from '@/lib/types';
import { NOTIFICATION_STATUS, TRANSACTION_LIFECYCLE_STATUS, TRANSACTION_IS_ACCEPTED_STATUS } from '@/lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in staff/notifications/listNotificationsForBranch action', err);
});

export async function listNotificationsForBranch(tenantId: number, branchId: number): Promise<Notification[]> {
  const client = await pool.connect();
  try {
    const query = `
      SELECT
        n.id,
        n.tenant_id,
        n.message,
        n.status,
        n.target_branch_id,
        n.creator_user_id,
        u.username AS creator_username,
        n.transaction_id,
        n.created_at,
        n.read_at,
        n.transaction_status AS transaction_link_status, -- Renamed in previous refactor
        t.is_accepted AS transaction_is_accepted,
        t.status AS linked_transaction_status,
        n.notification_type,
        n.priority,
        n.acknowledged_at,
        n.acknowledged_by_user_id
      FROM notification n
      LEFT JOIN users u ON n.creator_user_id = u.id
      LEFT JOIN transactions t ON n.transaction_id = t.id
      WHERE n.tenant_id = $1 AND (n.target_branch_id = $2 OR n.target_branch_id IS NULL)
      ORDER BY n.created_at DESC;
    `;
    const res = await client.query(query, [tenantId, branchId]);
    return res.rows.map(row => ({
      ...row,
      status: Number(row.status),
      transaction_link_status: Number(row.transaction_link_status),
      transaction_is_accepted: row.transaction_is_accepted !== null ? Number(row.transaction_is_accepted) : null,
      linked_transaction_status: row.linked_transaction_status !== null ? Number(row.linked_transaction_status) : null,
      priority: row.priority !== null ? Number(row.priority) : null,
    }));
  } catch (error) {
    console.error('[listNotificationsForBranch DB Error]', error);
    throw new Error(`Database error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}
