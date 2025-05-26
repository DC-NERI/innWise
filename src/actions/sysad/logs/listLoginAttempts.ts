
"use server";

import pg from 'pg';
// Configure pg to return numeric types as numbers instead of strings
pg.types.setTypeParser(20, (val) => parseInt(val, 10)); // int8/bigint
pg.types.setTypeParser(21, (val) => parseInt(val, 10)); // int2/smallint
pg.types.setTypeParser(23, (val) => parseInt(val, 10)); // int4/integer
pg.types.setTypeParser(1700, (val) => parseFloat(val)); // numeric/decimal

// Configure pg to return timestamp types as strings
pg.types.setTypeParser(1082, (stringValue) => stringValue); // DATE
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE (TIMESTAMPTZ)

import { Pool } from 'pg';
import type { LoginLog } from '@/lib/types';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in sysad/logs/listLoginAttempts action', err);
});

export async function listLoginAttempts(
  page: number = 1,
  limit: number = 15
): Promise<{ success: boolean; message?: string; logs?: LoginLog[]; totalCount?: number }> {
  if (page < 1) page = 1;
  if (limit < 1) limit = 15;
  const offset = (page - 1) * limit;

  let client;
  try {
    client = await pool.connect();

    const countQuery = 'SELECT COUNT(*) FROM login_logs';
    const countRes = await client.query(countQuery);
    const totalCount = parseInt(countRes.rows[0].count, 10);

    const logsQuery = `
      SELECT 
        ll.id, 
        ll.user_id, 
        u.username,
        ll.login_time, 
        ll.ip_address, 
        ll.user_agent, 
        ll.status, 
        ll.error_details
      FROM login_logs ll
      LEFT JOIN users u ON ll.user_id = u.id
      ORDER BY ll.login_time DESC
      LIMIT $1 OFFSET $2;
    `;
    const logsRes = await client.query(logsQuery, [limit, offset]);

    const logs = logsRes.rows.map(row => ({
      id: Number(row.id),
      user_id: row.user_id ? Number(row.user_id) : null,
      username: row.username,
      login_time: String(row.login_time), // TIMESTAMPTZ will be string
      ip_address: row.ip_address,
      user_agent: row.user_agent,
      status: Number(row.status), // 0 for failed, 1 for success
      error_details: row.error_details,
    })) as LoginLog[];

    return { success: true, logs, totalCount };
  } catch (dbError: any) {
    console.error('[listLoginAttempts DB Error]', dbError);
    return { success: false, message: `Database error while fetching login logs: ${dbError.message}` };
  } finally {
    if (client) {
      client.release();
    }
  }
}
