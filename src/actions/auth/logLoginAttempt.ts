
"use server";

import pg from 'pg';
// Configure pg to return numeric types as numbers instead of strings
pg.types.setTypeParser(20, (val) => parseInt(val, 10)); // int8/bigint
pg.types.setTypeParser(21, (val) => parseInt(val, 10)); // int2/smallint
pg.types.setTypeParser(23, (val) => parseInt(val, 10)); // int4/integer
pg.types.setTypeParser(1700, (val) => parseFloat(val)); // numeric/decimal

// Configure pg to return timestamp types as strings
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE
pg.types.setTypeParser(1082, (stringValue) => stringValue); // DATE

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in logLoginAttempt action', err);
});

export async function logLoginAttempt(
  userId: number,
  ipAddress: string | null,
  userAgent: string | null,
  status: 'success' | 'failed'
): Promise<void> {
  if (!userId || userId <= 0) {
    // Cannot log if userId is invalid, due to NOT NULL constraint in login_logs
    // This case should ideally be handled by the caller if a user_id isn't found.
    console.warn('[logLoginAttempt] Attempted to log with invalid userId:', userId);
    return;
  }

  let client;
  try {
    client = await pool.connect();
    const query = `
      INSERT INTO login_logs (user_id, ip_address, user_agent, status, login_time)
      VALUES ($1, $2, $3, $4, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'));
    `;
    await client.query(query, [userId, ipAddress, userAgent, status]);
  } catch (error) {
    // Log the error on the server, but do not let it break the main login flow
    console.error('[logLoginAttempt DB Error] Failed to log login attempt:', error);
  } finally {
    if (client) {
      client.release();
    }
  }
}
