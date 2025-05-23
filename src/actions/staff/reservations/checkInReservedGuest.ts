
"use server";

import pg from 'pg';
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE
pg.types.setTypeParser(20, (stringValue) => parseInt(stringValue, 10));
pg.types.setTypeParser(1700, (stringValue) => parseFloat(stringValue));

import { Pool } from 'pg';
import type { HotelRoom } from '@/lib/types';
import { ROOM_AVAILABILITY_STATUS, TRANSACTION_LIFECYCLE_STATUS } from '@/lib/constants';

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
  staffUserId: number // staffUserId is good for audit, though not directly used in this specific update logic
): Promise<{ success: boolean; message?: string; updatedRoomData?: Partial<HotelRoom> & { id: number } }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch the reservation to get its reserved_check_in_datetime if needed
    const reservationRes = await client.query(
      `SELECT reserved_check_in_datetime, client_name, hotel_rate_id 
       FROM transactions 
       WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND hotel_room_id = $4 
       AND (status::INTEGER = $5 OR status::INTEGER = $6)`, // Can check-in ADVANCE_PAID or ADVANCE_RESERVATION
      [
        transactionId, 
        tenantId, 
        branchId, 
        roomId,
        TRANSACTION_LIFECYCLE_STATUS.ADVANCE_PAID.toString(),
        TRANSACTION_LIFECYCLE_STATUS.ADVANCE_RESERVATION.toString()
      ]
    );

    if (reservationRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Reservation not found or not in a state that can be checked in." };
    }
    const reservationDetails = reservationRes.rows[0];
    const clientName = reservationDetails.client_name;
    const rateId = reservationDetails.hotel_rate_id;

    let actualCheckInTimeValue: string;
    let checkInQueryPart: string;
    let checkInQueryParams: (string | null)[] = [];

    // Use reserved_check_in_datetime if it exists and is in the future or very recent past, otherwise use current time
    // For simplicity, we'll use CURRENT_TIMESTAMP if it's a same-day check-in, or the reserved time if it's for the future
    // More complex logic might be needed for early/late check-ins based on policy
    if (reservationDetails.reserved_check_in_datetime) {
      // For this example, we'll use the reserved_check_in_datetime if it's present.
      // In a real scenario, you might compare it with current time to decide if it's an early check-in or on-time.
      // And apply AT TIME ZONE 'Asia/Manila' if the reserved_check_in_datetime was stored as UTC.
      // Assuming reserved_check_in_datetime is already 'Asia/Manila' equivalent due to form input handling
      checkInQueryPart = `check_in_time = $1`;
      checkInQueryParams.push(reservationDetails.reserved_check_in_datetime);
      actualCheckInTimeValue = reservationDetails.reserved_check_in_datetime;
    } else {
      // If no specific reserved time, use current time
      checkInQueryPart = `check_in_time = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')`;
      // actualCheckInTimeValue will be fetched via RETURNING
    }

    const updateTransactionQuery = `
      UPDATE transactions
      SET status = $${checkInQueryParams.length + 1}, ${checkInQueryPart}, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $${checkInQueryParams.length + 2} AND tenant_id = $${checkInQueryParams.length + 3} AND branch_id = $${checkInQueryParams.length + 4}
      RETURNING check_in_time;
    `;

    const transactionUpdateResult = await client.query(updateTransactionQuery, [
      ...checkInQueryParams,
      TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN.toString(), // New status: Occupied
      transactionId,
      tenantId,
      branchId
    ]);
    
    if (transactionUpdateResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, message: "Failed to update transaction for check-in." };
    }
    actualCheckInTimeValue = transactionUpdateResult.rows[0].check_in_time;


    const roomUpdateResult = await client.query(
      `UPDATE hotel_room
       SET is_available = $1, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $2 AND tenant_id = $3 AND branch_id = $4
       RETURNING cleaning_status, hotel_rate_id;`,
      [ROOM_AVAILABILITY_STATUS.OCCUPIED, roomId, tenantId, branchId]
    );

    if (roomUpdateResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, message: "Failed to update room status for check-in." };
    }

    const rateRes = await client.query('SELECT name, hours FROM hotel_rates WHERE id = $1', [rateId]);
    const rateName = rateRes.rows.length > 0 ? rateRes.rows[0].name : null;
    const rateHours = rateRes.rows.length > 0 ? parseInt(rateRes.rows[0].hours, 10) : null;

    await client.query('COMMIT');
    return {
      success: true,
      message: `Guest ${clientName} checked in successfully.`,
      updatedRoomData: {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.OCCUPIED,
        transaction_id: transactionId, // Transaction ID remains the same
        active_transaction_id: transactionId,
        active_transaction_client_name: clientName,
        active_transaction_check_in_time: actualCheckInTimeValue,
        active_transaction_rate_name: rateName,
        active_transaction_rate_hours: rateHours,
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
    