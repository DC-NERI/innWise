
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
  userId: number | null, // Can be null if username not found
  ipAddress: string | null,
  userAgent: string | null,
  status: 'success' | 'failed',
  attemptedUsername?: string | null,
  errorDetails?: string | null
): Promise<void> {
  console.log('[logLoginAttempt] Action called with:', { userId, ipAddress, userAgent, status, attemptedUsername, errorDetails });

  let client;
  try {
    client = await pool.connect();

    let finalErrorDetails = errorDetails;
    if (status === 'failed' && attemptedUsername && errorDetails) {
      finalErrorDetails = `Attempted Username: ${attemptedUsername}. Reason: ${errorDetails}`;
    } else if (status === 'failed' && attemptedUsername && !errorDetails) {
      finalErrorDetails = `Attempted Username: ${attemptedUsername}.`;
    }

    const query = `
      INSERT INTO login_logs (user_id, ip_address, user_agent, status, error_details, login_time)
      VALUES ($1, $2, $3, $4, $5, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'));
    `;
    const values = [userId, ipAddress, userAgent, status, finalErrorDetails];

    console.log('[logLoginAttempt] Executing query:', query);
    console.log('[logLoginAttempt] With values:', values);

    await client.query(query, values);
    console.log('[logLoginAttempt] Login attempt logged successfully to DB.');
  } catch (dbError: any) {
    console.error('[logLoginAttempt DB Error] Failed to log login attempt:', dbError);
    // Do not let this error break the main login flow.
  } finally {
    if (client) {
      client.release();
    }
  }
}
