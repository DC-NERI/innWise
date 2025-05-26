
"use server";

import pg from 'pg';
// Configure pg to return numeric types as numbers instead of strings
pg.types.setTypeParser(20, (val) => parseInt(val, 10)); // int8/bigint
pg.types.setTypeParser(21, (val) => parseInt(val, 10)); // int2/smallint
pg.types.setTypeParser(23, (val) => parseInt(val, 10)); // int4/integer
pg.types.setTypeParser(1700, (val) => parseFloat(val)); // numeric/decimal

import { Pool } from 'pg';
import type { SystemOverviewData } from '@/lib/types';
import { HOTEL_ENTITY_STATUS } from '@/lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in getSystemOverviewData action', err);
});

export async function getSystemOverviewData(): Promise<{ success: boolean; message?: string; overview?: SystemOverviewData }> {
  let client;
  try {
    client = await pool.connect();

    // Total Active Tenants
    const activeTenantsRes = await client.query(
      'SELECT COUNT(*) FROM tenants WHERE status = $1',
      [HOTEL_ENTITY_STATUS.ACTIVE]
    );
    const totalActiveTenants = parseInt(activeTenantsRes.rows[0].count, 10);

    // Total Active Branches
    const activeBranchesRes = await client.query(
      'SELECT COUNT(*) FROM tenant_branch WHERE status = $1',
      [HOTEL_ENTITY_STATUS.ACTIVE]
    );
    const totalActiveBranches = parseInt(activeBranchesRes.rows[0].count, 10);

    // User Counts by Role
    const userCountsRes = await client.query(
      "SELECT role, COUNT(*) as count FROM users WHERE status = $1 GROUP BY role",
      [HOTEL_ENTITY_STATUS.ACTIVE]
    );
    const userCountsByRole = {
      sysad: 0,
      admin: 0,
      staff: 0,
      housekeeping: 0,
    };
    userCountsRes.rows.forEach(row => {
      if (row.role in userCountsByRole) {
        userCountsByRole[row.role as keyof typeof userCountsByRole] = parseInt(row.count, 10);
      }
    });

    const overview: SystemOverviewData = {
      totalActiveTenants,
      totalActiveBranches,
      userCountsByRole,
    };

    return { success: true, overview };

  } catch (dbError: any) {
    console.error('[getSystemOverviewData DB Error]', dbError);
    return { success: false, message: `Database error: ${dbError.message}` };
  } finally {
    if (client) {
      client.release();
    }
  }
}

    