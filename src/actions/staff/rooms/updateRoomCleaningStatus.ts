
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
import { roomCleaningStatusAndNotesUpdateSchema, RoomCleaningStatusAndNotesUpdateData } from '@/lib/schemas';
import { ROOM_CLEANING_STATUS, ROOM_CLEANING_STATUS_TEXT } from '@/lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in staff/rooms/updateRoomCleaningStatus action', err);
});

export async function updateRoomCleaningStatus(
  roomId: number,
  tenantId: number,
  branchId: number,
  newCleaningStatus: number, // Now expecting number directly based on schema
  newNotes: string | null | undefined,
  staffUserId: number
): Promise<{ success: boolean; message?: string; updatedRoom?: Pick<HotelRoom, 'id' | 'cleaning_status' | 'cleaning_notes'> }> {
  // Validate newCleaningStatus against ROOM_CLEANING_STATUS enum values
  const validStatuses = Object.values(ROOM_CLEANING_STATUS) as number[];
  if (!validStatuses.includes(newCleaningStatus)) {
    return { success: false, message: "Invalid cleaning status provided." };
  }
  // Validate using the schema for notes requirement if out_of_order
  const validatedFields = roomCleaningStatusAndNotesUpdateSchema.safeParse({
      cleaning_status: newCleaningStatus,
      cleaning_notes: newNotes
  });

  if (!validatedFields.success) {
      const errorMessage = "Invalid data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
      return { success: false, message: errorMessage };
  }
  const { cleaning_status: validatedStatus, cleaning_notes: validatedNotes } = validatedFields.data;


  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Update hotel_room table
    const updateRoomQuery = `
      UPDATE hotel_room
      SET cleaning_status = $1, cleaning_notes = $2, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $3 AND tenant_id = $4 AND branch_id = $5
      RETURNING id, cleaning_status, cleaning_notes;
    `;
    const roomUpdateRes = await client.query(updateRoomQuery, [
      validatedStatus, // Use validated status
      validatedNotes,  // Use validated notes
      roomId,
      tenantId,
      branchId
    ]);

    if (roomUpdateRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Room not found or update failed." };
    }

    // Insert into room_cleaning_logs
    const logInsertQuery = `
      INSERT INTO room_cleaning_logs (room_id, tenant_id, branch_id, room_cleaning_status, notes, user_id, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'))
    `;
    // We log the numerical status to the DB for room_cleaning_status
    await client.query(logInsertQuery, [
        roomId, 
        tenantId, 
        branchId, 
        validatedStatus, // Log the numeric status
        validatedNotes, // Log the notes
        staffUserId
    ]);

    await client.query('COMMIT');
    const updatedRoom = roomUpdateRes.rows[0];
    return {
      success: true,
      message: "Room cleaning status and notes updated successfully.",
      updatedRoom: {
        id: Number(updatedRoom.id),
        cleaning_status: Number(updatedRoom.cleaning_status),
        cleaning_notes: updatedRoom.cleaning_notes,
      }
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[updateRoomCleaningStatus DB Error]', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes("room_cleaning_logs_room_cleaning_status_check")) {
        return { success: false, message: "Invalid cleaning status value provided for logging." };
    }
    return { success: false, message: `Database error: ${errorMessage}` };
  } finally {
    client.release();
  }
}
    