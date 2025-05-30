
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
  console.error('[logLoginAttempt Pool Error] Unexpected error on idle client:', err);
});

export async function logLoginAttempt(
  userId: number | null,
  ipAddress: string | null,
  userAgent: string | null,
  status: 0 | 1, // 0 for failed, 1 for success
  errorDetails?: string | null
): Promise<void> {
  // console.log('[logLoginAttempt] Action called with:', { userId, ipAddress, userAgent, status, errorDetails });

  let client;
  try {
    client = await pool.connect();

    // login_time has a default in the DB, so we don't need to explicitly set it unless we want to override
    const queryText = `
      INSERT INTO login_logs (user_id, ip_address, user_agent, status, error_details, login_time)
      VALUES ($1, $2, $3, $4, $5, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'));
    `;
    const values = [
      userId,
      ipAddress || null,
      userAgent || null,
      status, // Will be 0 or 1
      errorDetails || null,
    ];

    // console.log('[logLoginAttempt] Executing query:', queryText, 'With values:', values);
    await client.query(queryText, values);
    // console.log('[logLoginAttempt] Login attempt logged successfully to login_logs.');

  } catch (dbError: any) {
    console.error('[logLoginAttempt DB Error] Failed to log login attempt to login_logs:', dbError.message, dbError.stack, dbError);
    // Do not let this error break the main login flow.
  } finally {
    if (client) {
      client.release();
    }
  }
}
