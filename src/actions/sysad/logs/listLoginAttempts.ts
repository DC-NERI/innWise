
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
  limit: number = 10,
  usernameFilter?: string,
  startDateFilter?: string, // YYYY-MM-DD
  endDateFilter?: string    // YYYY-MM-DD
): Promise<{ success: boolean; message?: string; logs?: LoginLog[]; totalCount?: number }> {
  if (page < 1) page = 1;
  if (limit < 1) limit = 10;
  const offset = (page - 1) * limit;

  let client;
  try {
    client = await pool.connect();

    let whereClauses: string[] = [];
    let queryParams: any[] = [];
    let paramIndex = 1;

    if (usernameFilter && usernameFilter.trim() !== "") {
      whereClauses.push(`u.username ILIKE $${paramIndex++}`);
      queryParams.push(`%${usernameFilter.trim()}%`);
    }
    if (startDateFilter) {
      whereClauses.push(`ll.login_time >= $${paramIndex++}`);
      queryParams.push(startDateFilter);
    }
    if (endDateFilter) {
      // To include the entire end date, we check for login_time < (endDate + 1 day)
      whereClauses.push(`ll.login_time < ($${paramIndex++}::date + INTERVAL '1 day')`);
      queryParams.push(endDateFilter);
    }

    const whereString = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countQuery = `
      SELECT COUNT(ll.id) 
      FROM login_logs ll
      LEFT JOIN users u ON ll.user_id = u.id
      ${whereString};
    `;
    const countRes = await client.query(countQuery, queryParams);
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
      ${whereString}
      ORDER BY ll.login_time DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++};
    `;
    const logsRes = await client.query(logsQuery, [...queryParams, limit, offset]);

    const logs = logsRes.rows.map(row => ({
      id: Number(row.id),
      user_id: row.user_id ? Number(row.user_id) : null,
      username: row.username,
      login_time: String(row.login_time),
      ip_address: row.ip_address,
      user_agent: row.user_agent,
      status: Number(row.status),
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
    