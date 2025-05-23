
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
import type { HotelRoom, Transaction } from '@/lib/types';
import { ROOM_AVAILABILITY_STATUS, TRANSACTION_LIFECYCLE_STATUS, TRANSACTION_PAYMENT_STATUS } from '@/lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in staff/reservations/checkInReservedGuest action', err);
});

export async function checkInReservedGuest(
  transactionId: number,
  roomId: number,
  tenantId: number,
  branchId: number,
  staffUserId: number
): Promise<{ success: boolean; message?: string; updatedRoomData?: Partial<HotelRoom> & { id: number } }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const selectReservationQuery = `
      SELECT reserved_check_in_datetime, client_name, hotel_rate_id, is_paid 
      FROM transactions 
      WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND hotel_room_id = $4 
      AND status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM}
    `;
    const reservationRes = await client.query(
      selectReservationQuery,
      [
        transactionId,
        tenantId,
        branchId,
        roomId
      ]
    );

    if (reservationRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Reservation not found or not in a state that can be checked in (must be 'Reservation with Room')." };
    }
    const reservationDetails = reservationRes.rows[0];
    const clientName = reservationDetails.client_name;
    const rateId = reservationDetails.hotel_rate_id;

    let actualCheckInTimeValue: string | null = null;
    let checkInQueryPart: string;
    const updateTransactionParams: (string | number | Date | null)[] = [];

    if (reservationDetails.reserved_check_in_datetime) {
      checkInQueryPart = `check_in_time = $1`;
      actualCheckInTimeValue = reservationDetails.reserved_check_in_datetime;
      updateTransactionParams.push(actualCheckInTimeValue);
    } else {
      checkInQueryPart = `check_in_time = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')`;
    }

    updateTransactionParams.push(
      TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN.toString(), // New status: Checked-In
      transactionId,
      tenantId,
      branchId
    );

    const updateTransactionQuery = `
      UPDATE transactions
      SET status = $${actualCheckInTimeValue ? 2 : 1}, 
          ${checkInQueryPart},
          updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $${actualCheckInTimeValue ? 3 : 2} 
        AND tenant_id = $${actualCheckInTimeValue ? 4 : 3} 
        AND branch_id = $${actualCheckInTimeValue ? 5 : 4}
      RETURNING check_in_time, is_paid;
    `;

    const transactionUpdateResult = await client.query(updateTransactionQuery, updateTransactionParams);

    if (transactionUpdateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update transaction for check-in." };
    }
    const updatedTransactionDetails = transactionUpdateResult.rows[0];
    actualCheckInTimeValue = updatedTransactionDetails.check_in_time; // Use the actual check-in time from DB

    const updateRoomQuery = `
      UPDATE hotel_room
      SET is_available = $1, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $2 AND tenant_id = $3 AND branch_id = $4
      RETURNING cleaning_status, hotel_rate_id;
    `;
    const roomUpdateResult = await client.query(updateRoomQuery, [
      ROOM_AVAILABILITY_STATUS.OCCUPIED.toString(),
      roomId,
      tenantId,
      branchId
    ]);

    if (roomUpdateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update room status for check-in." };
    }

    const rateRes = await client.query('SELECT name, hours FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [rateId, tenantId, branchId]);
    const rateName = rateRes.rows.length > 0 ? rateRes.rows[0].name : null;
    const rateHours = rateRes.rows.length > 0 ? parseInt(rateRes.rows[0].hours, 10) : null;

    await client.query('COMMIT');
    return {
      success: true,
      message: `Guest ${clientName} checked in successfully.`,
      updatedRoomData: {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.OCCUPIED,
        transaction_id: transactionId,
        active_transaction_id: transactionId,
        active_transaction_client_name: clientName,
        active_transaction_check_in_time: actualCheckInTimeValue,
        active_transaction_rate_name: rateName,
        active_transaction_rate_hours: rateHours,
        active_transaction_lifecycle_status: TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN,
        cleaning_status: Number(roomUpdateResult.rows[0].cleaning_status),
        hotel_rate_id: roomUpdateResult.rows[0].hotel_rate_id ? JSON.parse(roomUpdateResult.rows[0].hotel_rate_id) : [],
      }
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("[checkInReservedGuest DB Error]", error);
    return { success: false, message: `Database error during reserved check-in: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}
