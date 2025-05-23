
"use server";

import pg from 'pg';
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE
pg.types.setTypeParser(20, (stringValue) => parseInt(stringValue, 10));
pg.types.setTypeParser(1700, (stringValue) => parseFloat(stringValue));

import { Pool } from 'pg';
import type { HotelRoom } from '@/lib/types';
import { TRANSACTION_LIFECYCLE_STATUS, ROOM_AVAILABILITY_STATUS } from '@/lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in staff/reservations/cancelReservation action', err);
});

export async function cancelReservation(
  transactionId: number,
  tenantId: number,
  branchId: number,
  roomId: number | null
): Promise<{ success: boolean; message?: string; updatedRoomData?: Partial<HotelRoom> & { id: number } }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check current status of transaction
    const transactionRes = await client.query(
        'SELECT status, hotel_room_id FROM transactions WHERE id = $1 AND tenant_id = $2 AND branch_id = $3',
        [transactionId, tenantId, branchId]
    );

    if (transactionRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, message: "Transaction not found." };
    }
    const currentTransaction = transactionRes.rows[0];
    const currentTransactionStatus = Number(currentTransaction.status);
    const currentRoomId = currentTransaction.hotel_room_id; // This is the room ID from the transaction itself

    if (currentTransactionStatus === TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN ||
        currentTransactionStatus === TRANSACTION_LIFECYCLE_STATUS.CHECKED_OUT ||
        currentTransactionStatus === TRANSACTION_LIFECYCLE_STATUS.VOIDED_CANCELLED) {
        await client.query('ROLLBACK');
        return { success: false, message: `Cannot cancel transaction in status: ${TRANSACTION_LIFECYCLE_STATUS_TEXT[currentTransactionStatus]}.` };
    }


    const updateTransactionQuery = `
      UPDATE transactions
      SET status = $1,
          updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $2 AND tenant_id = $3 AND branch_id = $4;
    `;
    await client.query(updateTransactionQuery, [
      TRANSACTION_LIFECYCLE_STATUS.VOIDED_CANCELLED.toString(),
      transactionId,
      tenantId,
      branchId
    ]);

    let updatedRoomData: (Partial<HotelRoom> & { id: number }) | undefined = undefined;

    // If a roomId was associated with this transaction (either passed in or from transaction record), make it available
    const finalRoomIdToUpdate = roomId ?? currentRoomId;

    if (finalRoomIdToUpdate) {
      const roomUpdateResult = await client.query(
        `UPDATE hotel_room
         SET is_available = $1,
             transaction_id = NULL,
             updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
         WHERE id = $2 AND tenant_id = $3 AND branch_id = $4
         RETURNING cleaning_status, hotel_rate_id;`,
        [ROOM_AVAILABILITY_STATUS.AVAILABLE, finalRoomIdToUpdate, tenantId, branchId]
      );
       if (roomUpdateResult.rows.length > 0) {
            updatedRoomData = {
                id: finalRoomIdToUpdate,
                is_available: ROOM_AVAILABILITY_STATUS.AVAILABLE,
                transaction_id: null,
                active_transaction_id: null,
                active_transaction_client_name: null,
                active_transaction_check_in_time: null,
                active_transaction_rate_name: null,
                cleaning_status: Number(roomUpdateResult.rows[0].cleaning_status),
                hotel_rate_id: roomUpdateResult.rows[0].hotel_rate_id ? JSON.parse(roomUpdateResult.rows[0].hotel_rate_id) : [],
            };
        }
    }

    await client.query('COMMIT');
    return { success: true, message: "Reservation cancelled successfully.", updatedRoomData };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[cancelReservation DB Error]', error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}
    