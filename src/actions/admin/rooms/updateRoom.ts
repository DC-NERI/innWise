
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
import { hotelRoomUpdateSchema, HotelRoomUpdateData } from '@/lib/schemas';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/rooms/updateRoom action', err);
});

export async function updateRoom(
  roomId: number,
  data: HotelRoomUpdateData,
  tenantId: number,
  branchId: number
): Promise<{ success: boolean; message?: string; room?: HotelRoom }> {
  const validatedFields = hotelRoomUpdateSchema.safeParse(data);
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
    cleaning_notes,
    status,
  } = validatedFields.data;

  const client = await pool.connect();
  try {
    // Check if the new room_code already exists for another room in the same tenant and branch
    const checkExistingCodeQuery = `
      SELECT id FROM hotel_room 
      WHERE room_code = $1 AND tenant_id = $2 AND branch_id = $3 AND id != $4;
    `;
    const existingCodeRes = await client.query(checkExistingCodeQuery, [room_code, tenantId, branchId, roomId]);
    if (existingCodeRes.rows.length > 0) {
      return { success: false, message: "This room code is already in use by another room in this branch." };
    }

    const updateRoomQuery = `
      UPDATE hotel_room
      SET 
        hotel_rate_id = $1,
        room_name = $2,
        room_code = $3,
        floor = $4,
        room_type = $5,
        bed_type = $6,
        capacity = $7,
        is_available = $8,
        cleaning_status = $9,
        cleaning_notes = $10,
        status = $11,
        updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $12 AND tenant_id = $13 AND branch_id = $14
      RETURNING id, tenant_id, branch_id, hotel_rate_id, room_name, room_code, floor, room_type, bed_type, capacity, is_available, cleaning_status, cleaning_notes, status, created_at, updated_at;
    `;

    const res = await client.query(updateRoomQuery, [
      JSON.stringify(hotel_rate_ids),
      room_name,
      room_code,
      floor,
      room_type,
      bed_type,
      capacity,
      is_available,
      cleaning_status,
      cleaning_notes,
      status,
      roomId,
      tenantId,
      branchId,
    ]);

    if (res.rows.length > 0) {
      const updatedRoom = res.rows[0];
      return {
        success: true,
        message: "Room updated successfully.",
        room: {
          ...updatedRoom,
          hotel_rate_id: updatedRoom.hotel_rate_id ? JSON.parse(updatedRoom.hotel_rate_id) : [],
          is_available: Number(updatedRoom.is_available),
          cleaning_status: Number(updatedRoom.cleaning_status),
          status: String(updatedRoom.status),
        } as HotelRoom,
      };
    }
    return { success: false, message: "Room not found or update failed." };
  } catch (error) {
    let errorMessage = "Database error occurred during room update.";
     if (error instanceof Error && (error as any).code === '23505' && (error as any).constraint === 'hotel_room_room_code_key') {
        errorMessage = "This room code is already in use. Please choose a different one.";
    } else if (error instanceof Error) {
        errorMessage = `Database error: ${error.message}`;
    }
    console.error('[updateRoom DB Error]', error);
    return { success: false, message: errorMessage };
  } finally {
    client.release();
  }
}
    