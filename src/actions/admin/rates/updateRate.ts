
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
import { hotelRateUpdateSchema, HotelRateUpdateData } from '@/lib/schemas';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/rates/updateRate action', err);
});

export async function updateRate(rateId: number, data: HotelRateUpdateData, tenantId: number, branchId: number): Promise<{ success: boolean; message?: string; rate?: HotelRate }> {
  const validatedFields = hotelRateUpdateSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessage = "Invalid data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
    return { success: false, message: errorMessage };
  }

  const { name, price, hours, excess_hour_price, description, status } = validatedFields.data;
  const client = await pool.connect();

  try {
    const query = `
      UPDATE hotel_rates
      SET name = $1, price = $2, hours = $3, excess_hour_price = $4, description = $5, status = $6, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $7 AND tenant_id = $8 AND branch_id = $9
      RETURNING id, tenant_id, branch_id, name, price, hours, excess_hour_price, description, status, created_at, updated_at;
    `;
    const res = await client.query(query, [
      name,
      price,
      hours,
      excess_hour_price,
      description,
      status,
      rateId,
      tenantId,
      branchId
    ]);

    if (res.rows.length > 0) {
      const updatedRate = res.rows[0];
      return {
        success: true,
        message: "Rate updated successfully.",
        rate: {
          ...updatedRate,
          price: parseFloat(updatedRate.price),
          hours: parseInt(updatedRate.hours, 10),
          excess_hour_price: updatedRate.excess_hour_price ? parseFloat(updatedRate.excess_hour_price) : null,
          status: String(updatedRate.status),
        } as HotelRate
      };
    }
    return { success: false, message: "Rate not found or update failed." };
  } catch (error) {
    console.error('[updateRate DB Error]', error);
    return { success: false, message: `Database error during rate update: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}
