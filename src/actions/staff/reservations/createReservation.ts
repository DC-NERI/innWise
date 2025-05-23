
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
import type { HotelRoom, Transaction, SimpleRate, StaffBookingCreateData } from '@/lib/types';
import { staffBookingCreateSchema } from '@/lib/schemas';
import {
  ROOM_AVAILABILITY_STATUS,
  TRANSACTION_LIFECYCLE_STATUS,
  TRANSACTION_PAYMENT_STATUS,
  ROOM_CLEANING_STATUS,
  TRANSACTION_IS_ACCEPTED_STATUS,
  HOTEL_ENTITY_STATUS
} from '@/lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in staff/reservations/createReservation action', err);
});

export async function createReservation(
  data: StaffBookingCreateData,
  tenantId: number,
  branchId: number,
  roomId: number,
  rateId: number,
  staffUserId: number
): Promise<{ success: boolean; message?: string; updatedRoomData?: Partial<HotelRoom> & { id: number }; transaction?: Partial<Transaction> }> {

  if (!staffUserId || typeof staffUserId !== 'number' || staffUserId <= 0) {
    console.error("[createReservation] Invalid staffUserId:", staffUserId);
    return { success: false, message: "Invalid user identifier for creating reservation." };
  }
  
  const validatedFields = staffBookingCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessage = "Invalid data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
    return { success: false, message: errorMessage };
  }
  if (!rateId) { // Already checked by schema, but good for defense
    return { success: false, message: "Rate ID is required for reservation." };
  }


  const {
    client_name,
    client_payment_method,
    notes,
    is_advance_reservation,
    reserved_check_in_datetime,
    reserved_check_out_datetime,
    is_paid,
    tender_amount_at_checkin,
  } = validatedFields.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const roomRes = await client.query(
      'SELECT is_available, cleaning_status, room_name FROM hotel_room WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND status = $4 FOR UPDATE',
      [roomId, tenantId, branchId, HOTEL_ENTITY_STATUS.ACTIVE]
    );

    if (roomRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Room not found or is not active." };
    }
    const room = roomRes.rows[0];
    if (Number(room.is_available) !== ROOM_AVAILABILITY_STATUS.AVAILABLE) {
      await client.query('ROLLBACK');
      return { success: false, message: `Room is not available (current status: ${Number(room.is_available)}). Cannot reserve.` };
    }
    if (Number(room.cleaning_status) !== ROOM_CLEANING_STATUS.CLEAN) {
        await client.query('ROLLBACK');
        return { success: false, message: "Room is not clean and cannot be reserved." };
    }

    const finalTransactionLifecycleStatus = TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM; // 2
    const finalPaymentStatus = is_paid ?? TRANSACTION_PAYMENT_STATUS.UNPAID;
    const tenderAmountForTransaction = finalPaymentStatus !== TRANSACTION_PAYMENT_STATUS.UNPAID ? tender_amount_at_checkin : null;


    const transactionQueryText = `
      INSERT INTO transactions (
        tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name,
        client_payment_method, notes, check_in_time, 
        created_by_user_id, status, is_paid, tender_amount,
        reserved_check_in_datetime, reserved_check_out_datetime,
        created_at, updated_at, is_accepted, is_admin_created
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), $8, $9, $10, $11, $12, $13, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), $14, $15)
      RETURNING id, client_name, check_in_time, hotel_rate_id, reserved_check_in_datetime, status, is_paid, tender_amount;
    `;

    const transactionValues = [
      tenantId, // $1
      branchId, // $2
      roomId, // $3
      rateId, // $4
      client_name, // $5
      client_payment_method, // $6
      notes, // $7
      staffUserId, // $8 created_by_user_id
      finalTransactionLifecycleStatus.toString(), // $9 status
      finalPaymentStatus, // $10 is_paid (integer)
      tenderAmountForTransaction, // $11
      is_advance_reservation ? reserved_check_in_datetime : null, // $12 reserved_check_in_datetime
      is_advance_reservation ? reserved_check_out_datetime : null, // $13 reserved_check_out_datetime
      TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED, // $14 is_accepted 
      0 // $15 is_admin_created (0 for false)
    ];
    
    const transactionRes = await client.query(transactionQueryText, transactionValues);
    const newTransaction = transactionRes.rows[0];

    const roomUpdateQueryText = `
      UPDATE hotel_room
      SET is_available = $1, transaction_id = $2, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $3 AND tenant_id = $4 AND branch_id = $5;
    `;
    await client.query(roomUpdateQueryText, [
      ROOM_AVAILABILITY_STATUS.RESERVED,
      newTransaction.id,
      roomId,
      tenantId,
      branchId
    ]);

    const rateNameRes = await client.query('SELECT name, hours FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [rateId, tenantId, branchId]);
    const rateName = rateNameRes.rows.length > 0 ? rateNameRes.rows[0].name : null;
    const rateHours = rateNameRes.rows.length > 0 ? parseInt(rateNameRes.rows[0].hours, 10) : null;


    await client.query('COMMIT');

    return {
      success: true,
      message: `Room ${room.room_name} reserved successfully for ${client_name}.`,
      updatedRoomData: {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.RESERVED,
        transaction_id: Number(newTransaction.id),
        active_transaction_id: Number(newTransaction.id),
        active_transaction_client_name: client_name,
        active_transaction_check_in_time: newTransaction.reserved_check_in_datetime || newTransaction.check_in_time,
        active_transaction_rate_name: rateName,
        active_transaction_rate_hours: rateHours,
        active_transaction_lifecycle_status: Number(newTransaction.status),
      },
      transaction: {
        id: Number(newTransaction.id),
        client_name: client_name,
        status: Number(newTransaction.status),
        is_paid: Number(newTransaction.is_paid),
        tender_amount: newTransaction.tender_amount ? parseFloat(newTransaction.tender_amount) : null,
        hotel_rate_id: rateId,
        hotel_room_id: roomId,
        reserved_check_in_datetime: newTransaction.reserved_check_in_datetime,
      }
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[createReservation DB Error]', error);
    const dbError = error as any;
    if (dbError.code === '23505' && dbError.constraint && dbError.constraint.includes('hotel_room_id_status_unique_active_reservations')) { 
      return { success: false, message: "This room already has an active reservation or booking." };
    }
    return { success: false, message: `Database error while creating reservation: ${dbError.message || String(dbError)}` };
  } finally {
    client.release();
  }
}

    