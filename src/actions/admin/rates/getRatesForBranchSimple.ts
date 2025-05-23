
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
import type { SimpleRate } from '@/lib/types';
import { HOTEL_ENTITY_STATUS } from '../../../lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/rates/getRatesForBranchSimple action', err);
});

export async function getRatesForBranchSimple(tenantId: number, branchId: number): Promise<SimpleRate[]> {
   if (typeof HOTEL_ENTITY_STATUS?.ACTIVE === 'undefined') {
    console.error('[getRatesForBranchSimple] CRITICAL ERROR: HOTEL_ENTITY_STATUS constant is undefined. Check imports and constants.ts file.');
    throw new Error('Server configuration error: Required constants for rate fetching are undefined.');
  }
  const client = await pool.connect();
  try {
    const query = `
      SELECT id, name, price, hours
      FROM hotel_rates
      WHERE tenant_id = $1 AND branch_id = $2 AND status = $3
      ORDER BY name;
    `;
    const res = await client.query(query, [tenantId, branchId, HOTEL_ENTITY_STATUS.ACTIVE]);
    return res.rows.map(row => ({
      id: Number(row.id),
      name: row.name,
      price: parseFloat(row.price),
      hours: parseInt(row.hours, 10),
    }));
  } catch (error) {
    console.error('[getRatesForBranchSimple DB Error]', error);
    throw new Error(`Database error while fetching rates: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}
