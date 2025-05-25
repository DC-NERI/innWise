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
import type { ActivityLog } from '../../../lib/types'; // Adjusted path

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/users/listActivityLogsForTenant action', err);
});

export async function listActivityLogsForTenant(
  tenantId: number,
  page: number = 1,
  limit: number = 10
): Promise<{ success: boolean; message?: string; logs?: ActivityLog[]; totalCount?: number }> {
  if (!tenantId || typeof tenantId !== 'number' || tenantId <= 0) {
    return { success: false, message: "Invalid tenant ID provided." };
  }
  if (page < 1) page = 1;
  if (limit < 1) limit = 10;
  const offset = (page - 1) * limit;

  const client = await pool.connect();
  try {
    const countQuery = 'SELECT COUNT(*) FROM activity_logs WHERE tenant_id = $1';
    const countRes = await client.query(countQuery, [tenantId]);
    const totalCount = parseInt(countRes.rows[0].count, 10);

    const logsQuery = `
      SELECT 
        al.id, al.tenant_id, t.tenant_name, al.branch_id, tb.branch_name, 
        al.user_id, al.username, al.action_type, al.description, 
        al.target_entity_type, al.target_entity_id, al.details, al.created_at
      FROM activity_logs al
      LEFT JOIN tenants t ON al.tenant_id = t.id
      LEFT JOIN tenant_branch tb ON al.branch_id = tb.id AND al.tenant_id = tb.tenant_id -- Ensure branch belongs to tenant
      WHERE al.tenant_id = $1
      ORDER BY al.created_at DESC
      LIMIT $2 OFFSET $3;
    `;
    const logsRes = await client.query(logsQuery, [tenantId, limit, offset]);

    const logs = logsRes.rows.map(row => ({
      id: Number(row.id),
      tenant_id: row.tenant_id ? Number(row.tenant_id) : null,
      tenant_name: row.tenant_name,
      branch_id: row.branch_id ? Number(row.branch_id) : null,
      branch_name: row.branch_name,
      user_id: row.user_id ? Number(row.user_id) : null,
      username: row.username,
      action_type: row.action_type,
      description: row.description,
      target_entity_type: row.target_entity_type,
      target_entity_id: row.target_entity_id,
      details: row.details, // details is JSONB, should be parsed by client if needed
      created_at: String(row.created_at),
    })) as ActivityLog[];

    return { success: true, logs, totalCount };
  } catch (error) {
    console.error('[listActivityLogsForTenant DB Error]', error);
    return { success: false, message: `Database error while fetching activity logs: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}
