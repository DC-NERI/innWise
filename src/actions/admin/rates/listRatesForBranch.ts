
"use server";

import pg from 'pg';
// Configure pg to return numeric types as numbers instead of strings
pg.types.setTypeParser(20, (val) => parseInt(val, 10)); // int8
pg.types.setTypeParser(21, (val) => parseInt(val, 10)); // int2
pg.types.setTypeParser(23, (val) => parseInt(val, 10)); // int4
pg.types.setTypeParser(1700, (val) => parseFloat(val)); // numeric

// Configure pg to return timestamp without timezone as strings
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE

import { Pool } from 'pg';
import type { HotelRate } from '@/lib/types';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/rates/listRatesForBranch action', err);
});

export async function listRatesForBranch(branchId: number, tenantId: number): Promise<HotelRate[]> {
  if (!branchId || !tenantId) {
    return [];
  }
  const client = await pool.connect();
  try {
    const query = `
      SELECT hr.id, hr.tenant_id, hr.branch_id, tb.branch_name, hr.name, hr.price, hr.hours, hr.excess_hour_price, hr.description, hr.status, hr.created_at, hr.updated_at
      FROM hotel_rates hr
      JOIN tenant_branch tb ON hr.branch_id = tb.id AND hr.tenant_id = tb.tenant_id
      WHERE hr.branch_id = $1 AND hr.tenant_id = $2
      ORDER BY hr.name;
    `;
    const res = await client.query(query, [branchId, tenantId]);
    return res.rows.map(row => ({
      ...row,
      price: parseFloat(row.price),
      hours: parseInt(row.hours, 10),
      excess_hour_price: row.excess_hour_price ? parseFloat(row.excess_hour_price) : null,
      status: String(row.status),
    })) as HotelRate[];
  } catch (error) {
    console.error('[listRatesForBranch DB Error]', error);
    throw new Error(`Database error while fetching rates for branch ${branchId}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}
