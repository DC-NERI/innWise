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
import type { HotelRoom } from '@/lib/types';
import { hotelRoomCreateSchema, HotelRoomCreateData } from '@/lib/schemas';
import { HOTEL_ENTITY_STATUS } from '../../../lib/constants'; // Adjusted path

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/rooms/createRoom action', err);
});

export async function createRoom(
data: HotelRoomCreateData, tenantId: number, branchId: number, adminUserId: number): Promise<{ success: boolean; message?: string; room?: HotelRoom }> {
  const validatedFields = hotelRoomCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessage = "Invalid data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
    return { success: false, message: errorMessage };
  }

  const {
    hotel_rate_ids,
    room_name,
    room_code,
    floor,
    room_type,
    bed_type,
    capacity,
    is_available,
    cleaning_status,
    cleaning_notes
  } = validatedFields.data;

  const client = await pool.connect();
  try {
    const insertRoomQuery = `
      INSERT INTO hotel_room (
        tenant_id, branch_id, hotel_rate_id, room_name, room_code, floor,
        room_type, bed_type, capacity, is_available, cleaning_status, cleaning_notes, status,
        created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'))
      RETURNING id, tenant_id, branch_id, hotel_rate_id, room_name, room_code, floor, room_type, bed_type, capacity, is_available, cleaning_status, cleaning_notes, status, created_at, updated_at;
    `;

    const res = await client.query(insertRoomQuery, [
      tenantId,
      branchId,
      JSON.stringify(hotel_rate_ids), // Store as JSON string
      room_name,
      room_code,
      floor,
      room_type,
      bed_type,
      capacity,
      is_available,
      cleaning_status,
      cleaning_notes,
      HOTEL_ENTITY_STATUS.ACTIVE,
    ]);

    if (res.rows.length > 0) {
      const newRoom = res.rows[0];
      return {
        success: true,
        message: "Room created successfully.",
        room: {
          ...newRoom,
          hotel_rate_id: (() => {
            const val = newRoom.hotel_rate_id;
            if (Array.isArray(val)) return val;
            if (typeof val === "string") {
              try {
                return JSON.parse(val);
              } catch {
                // fallback: try comma-separated numbers
                if (val.includes(",")) {
                  return val.split(",").map(v => Number(v.trim())).filter(Boolean);
                }
                if (!isNaN(Number(val))) return [Number(val)];
                return [];
              }
            }
            if (typeof val === "number") return [val];
            return [];
          })(),
          is_available: Number(newRoom.is_available),
          cleaning_status: Number(newRoom.cleaning_status),
          status: String(newRoom.status),
        } as HotelRoom,
      };
    }
    return { success: false, message: "Room creation failed." };
  } catch (error) {
    let errorMessage = "Database error occurred during room creation.";
    if (error instanceof Error && (error as any).code === '23505' && (error as any).constraint === 'hotel_room_room_code_key') {
      errorMessage = "This room code is already in use. Please choose a different one.";
    } else if (error instanceof Error) {
      errorMessage = `Database error: ${error.message}`;
    }
    console.error('[createRoom DB Error]', error);
    return { success: false, message: errorMessage };
  } finally {
    client.release();
  }
}
