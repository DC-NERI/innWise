
"use server";

import pg from 'pg';
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE
pg.types.setTypeParser(20, (stringValue) => parseInt(stringValue, 10));
pg.types.setTypeParser(1700, (stringValue) => parseFloat(stringValue));

import { Pool } from 'pg';
import type { HotelRoom } from '@/lib/types';
import { ROOM_AVAILABILITY_STATUS, ROOM_CLEANING_STATUS, HOTEL_ENTITY_STATUS } from '@/lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in staff/rooms/listAvailableRoomsForBranch action', err);
});

export async function listAvailableRoomsForBranch(tenantId: number, branchId: number): Promise<HotelRoom[]> {
  const client = await pool.connect();
  try {
    const query = `
      SELECT 
        hr.id, 
        hr.room_name, 
        hr.room_code, 
        hr.hotel_rate_id, 
        hr.is_available,
        hr.cleaning_status
      FROM hotel_room hr
      WHERE hr.tenant_id = $1 
        AND hr.branch_id = $2
        AND hr.status = $3 -- Room definition is active
        AND hr.is_available = $4 -- Room booking status is available
        AND hr.cleaning_status = $5 -- Room is clean
      ORDER BY hr.room_name;
    `;
    const res = await client.query(query, [
        tenantId, 
        branchId, 
        HOTEL_ENTITY_STATUS.ACTIVE, 
        ROOM_AVAILABILITY_STATUS.AVAILABLE,
        ROOM_CLEANING_STATUS.CLEAN
    ]);
    return res.rows.map(row => ({
      ...row,
      is_available: Number(row.is_available),
      cleaning_status: Number(row.cleaning_status),
      hotel_rate_id: row.hotel_rate_id ? JSON.parse(row.hotel_rate_id) : [],
    }));
  } catch (error) {
    console.error('Failed to fetch available rooms for branch:', error);
    throw new Error(`Database error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}
    