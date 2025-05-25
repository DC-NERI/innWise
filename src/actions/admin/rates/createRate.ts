
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
import { hotelRateCreateSchema, HotelRateCreateData } from '@/lib/schemas';
import { HOTEL_ENTITY_STATUS } from '../../../lib/constants'; // Adjusted path

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/rates/createRate action', err);
});

export async function createRate(data: HotelRateCreateData, tenantId: number, branchId: number): Promise<{ success: boolean; message?: string; rate?: HotelRate }> {
  const validatedFields = hotelRateCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessage = "Invalid data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
    return { success: false, message: errorMessage };
  }

  const { name, price, hours, excess_hour_price, description } = validatedFields.data;
  const client = await pool.connect();

  try {
    const query = `
      INSERT INTO hotel_rates (tenant_id, branch_id, name, price, hours, excess_hour_price, description, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'))
      RETURNING id, tenant_id, branch_id, name, price, hours, excess_hour_price, description, status, created_at, updated_at;
    `;
    const res = await client.query(query, [
      tenantId,
      branchId,
      name,
      price,
      hours,
      excess_hour_price,
      description,
      HOTEL_ENTITY_STATUS.ACTIVE
    ]);

    if (res.rows.length > 0) {
      const newRate = res.rows[0];
      return {
        success: true,
        message: "Rate created successfully.",
        rate: {
          ...newRate,
          price: parseFloat(newRate.price),
          hours: parseInt(newRate.hours, 10),
          excess_hour_price: newRate.excess_hour_price ? parseFloat(newRate.excess_hour_price) : null,
          status: String(newRate.status),
        } as HotelRate
      };
    }
    return { success: false, message: "Rate creation failed." };
  } catch (error) {
    console.error('[createRate DB Error]', error);
    return { success: false, message: `Database error during rate creation: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}
