
"use server";

import pg from 'pg';
pg.types.setTypeParser(1114, (stringValue) => stringValue);
pg.types.setTypeParser(1184, (stringValue) => stringValue);
pg.types.setTypeParser(20, (stringValue) => parseInt(stringValue, 10));
pg.types.setTypeParser(1700, (stringValue) => parseFloat(stringValue));

import { Pool } from 'pg';
import type { Transaction, HotelRoom } from '@/lib/types';
import { assignRoomAndCheckInSchema, AssignRoomAndCheckInData } from '@/lib/schemas';
import { TRANSACTION_LIFECYCLE_STATUS, ROOM_AVAILABILITY_STATUS, TRANSACTION_IS_ACCEPTED_STATUS } from '@/lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in staff/reservations/assignRoomAndCheckIn action', err);
});

export async function assignRoomAndCheckIn(
  transactionId: number,
  roomId: number,
  staffUserId: number,
  tenantId: number,
  branchId: number
): Promise<{ success: boolean; message?: string; updatedRoomData?: Partial<HotelRoom> & { id: number }, updatedTransaction?: Transaction }> {
  const validatedData = assignRoomAndCheckInSchema.safeParse({ selected_room_id: roomId });
  if (!validatedData.success) {
    return { success: false, message: "Invalid room ID." };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const reservationRes = await client.query(
      `SELECT status, is_accepted, client_name, hotel_rate_id, reserved_check_in_datetime 
       FROM transactions 
       WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND hotel_room_id IS NULL 
       AND (status::INTEGER = $4 OR status::INTEGER = $5 OR status::INTEGER = $6)`,
      [
        transactionId, 
        tenantId, 
        branchId, 
        TRANSACTION_LIFECYCLE_STATUS.ADVANCE_PAID, 
        TRANSACTION_LIFECYCLE_STATUS.ADVANCE_RESERVATION,
        TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE 
      ]
    );

    if (reservationRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Reservation not found, already assigned, or not in a valid state for assignment." };
    }

    const reservation = reservationRes.rows[0];
    const currentStatus = Number(reservation.status);
    const isAccepted = Number(reservation.is_accepted);

    if (currentStatus === TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE && isAccepted !== TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED) {
        await client.query('ROLLBACK');
        return { success: false, message: "This reservation must be accepted by the branch before assigning a room." };
    }

    // Check if room is actually available and clean
    const roomRes = await client.query(
      'SELECT is_available, cleaning_status FROM hotel_room WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 FOR UPDATE',
      [roomId, tenantId, branchId]
    );

    if (roomRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Selected room not found." };
    }
    const room = roomRes.rows[0];
    if (Number(room.is_available) !== ROOM_AVAILABILITY_STATUS.AVAILABLE || Number(room.cleaning_status) !== 0 /* Clean */) {
      await client.query('ROLLBACK');
      return { success: false, message: "Selected room is not available or not clean." };
    }
    
    let checkInTimeValue = `(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')`;
    // If it's an advance reservation and has a specific check-in time, use that. Otherwise, use current time.
    if ((currentStatus === TRANSACTION_LIFECYCLE_STATUS.ADVANCE_RESERVATION || currentStatus === TRANSACTION_LIFECYCLE_STATUS.ADVANCE_PAID) && reservation.reserved_check_in_datetime) {
        checkInTimeValue = `'${reservation.reserved_check_in_datetime}'::TIMESTAMP WITHOUT TIME ZONE`;
    }


    const updateTransactionQuery = `
      UPDATE transactions
      SET hotel_room_id = $1,
          status = $2,
          check_in_time = ${checkInTimeValue}, 
          updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $3 AND tenant_id = $4 AND branch_id = $5
      RETURNING *;
    `;
    const transactionUpdateResult = await client.query(updateTransactionQuery, [
      roomId,
      TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN.toString(),
      transactionId,
      tenantId,
      branchId
    ]);

    if (transactionUpdateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update transaction details." };
    }
    const updatedTransaction = transactionUpdateResult.rows[0];


    const updateRoomQuery = `
      UPDATE hotel_room
      SET is_available = $1,
          transaction_id = $2,
          updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $3 AND tenant_id = $4 AND branch_id = $5
      RETURNING id, is_available, transaction_id, cleaning_status, hotel_rate_id;
    `;
    const roomUpdateResult = await client.query(updateRoomQuery, [
      ROOM_AVAILABILITY_STATUS.OCCUPIED,
      transactionId,
      roomId,
      tenantId,
      branchId
    ]);
     if (roomUpdateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update room status." };
    }

    const rateRes = await client.query('SELECT name FROM hotel_rates WHERE id = $1', [updatedTransaction.hotel_rate_id]);
    const rateName = rateRes.rows.length > 0 ? rateRes.rows[0].name : null;


    await client.query('COMMIT');
    return {
      success: true,
      message: `Room assigned and guest ${reservation.client_name} checked in.`,
      updatedRoomData: {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.OCCUPIED,
        transaction_id: transactionId,
        active_transaction_id: transactionId,
        active_transaction_client_name: reservation.client_name,
        active_transaction_check_in_time: updatedTransaction.check_in_time,
        active_transaction_rate_name: rateName,
        cleaning_status: Number(roomUpdateResult.rows[0].cleaning_status), // return current cleaning status
        hotel_rate_id: roomUpdateResult.rows[0].hotel_rate_id ? JSON.parse(roomUpdateResult.rows[0].hotel_rate_id) : [],
      },
      updatedTransaction: {
          ...updatedTransaction,
          status: Number(updatedTransaction.status),
          is_paid: Number(updatedTransaction.is_paid),
      }
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[assignRoomAndCheckIn DB Error]', error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}
    