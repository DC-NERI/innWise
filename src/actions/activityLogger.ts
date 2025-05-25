
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

import { Pool, type PoolClient } from 'pg';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in activityLogger action', err);
});

interface ActivityLogData {
  tenant_id?: number | null;
  branch_id?: number | null;
  actor_user_id: number;
  actor_username?: string | null; // Optional: if not provided, will try to fetch
  action_type: string; // e.g., 'USER_LOGIN', 'CREATED_TENANT', 'UPDATED_BRANCH'
  description?: string | null; // Human-readable summary
  target_entity_type?: string | null; // e.g., 'User', 'Tenant', 'Branch'
  target_entity_id?: string | null; // The ID of the entity being acted upon
  details?: Record<string, any> | null; // JSONB for additional context
}

export async function logActivity(
  data: ActivityLogData,
  existingClient?: PoolClient // Optional: for use within an existing transaction
): Promise<void> {
  let client = existingClient;
  let shouldReleaseClient = false;

  try {
    if (!client) {
      client = await pool.connect();
      shouldReleaseClient = true;
    }

    let usernameToLog = data.actor_username;
    if (!usernameToLog && data.actor_user_id) {
      try {
        const userRes = await client.query('SELECT username FROM users WHERE id = $1', [data.actor_user_id]);
        if (userRes.rows.length > 0) {
          usernameToLog = userRes.rows[0].username;
        } else {
          usernameToLog = `User (ID: ${data.actor_user_id})`; // Fallback if user not found
        }
      } catch (userFetchError) {
        console.error('[logActivity] Error fetching username:', userFetchError);
        usernameToLog = `User (ID: ${data.actor_user_id}, Error fetching name)`;
      }
    }


    const query = `
      INSERT INTO activity_logs (
        tenant_id, branch_id, user_id, username, action_type, 
        description, target_entity_type, target_entity_id, details, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, 
        $6, $7, $8, $9, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      );
    `;
    const values = [
      data.tenant_id,
      data.branch_id,
      data.actor_user_id,
      usernameToLog,
      data.action_type,
      data.description,
      data.target_entity_type,
      data.target_entity_id,
      data.details ? JSON.stringify(data.details) : null,
    ];

    await client.query(query, values);
  } catch (error) {
    // Log the error on the server, but do not let it break the main action
    console.error('[logActivity DB Error] Failed to log activity:', error);
    // Optionally, you could try to log this failure to a different system or file
  } finally {
    if (client && shouldReleaseClient) {
      client.release();
    }
  }
}
    