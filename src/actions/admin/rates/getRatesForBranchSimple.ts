
"use server";

import pg from 'pg';
pg.types.setTypeParser(1114, (stringValue) => stringValue);
pg.types.setTypeParser(1184, (stringValue) => stringValue);
pg.types.setTypeParser(20, (stringValue) => parseInt(stringValue, 10));
pg.types.setTypeParser(1700, (stringValue) => parseFloat(stringValue));

import { Pool } from 'pg';
import type { SimpleRate } from '@/lib/types';
import { HOTEL_ENTITY_STATUS } from '@/lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/rates/getRatesForBranchSimple action', err);
});

export async function getRatesForBranchSimple(tenantId: number, branchId: number): Promise<SimpleRate[]> {
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
      id: row.id,
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
