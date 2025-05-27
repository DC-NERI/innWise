
"use server";

import pg from 'pg';
// Configure pg to return numeric types as numbers instead of strings
pg.types.setTypeParser(pg.types.builtins.INT2, (val: string) => parseInt(val, 10));
pg.types.setTypeParser(pg.types.builtins.INT4, (val: string) => parseInt(val, 10));
pg.types.setTypeParser(pg.types.builtins.INT8, (val: string) => parseInt(val, 10));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (val: string) => parseFloat(val));
// Configure pg to return timestamp without timezone as strings
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE

import { Pool } from 'pg';
import type { HotelRoom, Transaction, SimpleRate, StaffBookingCreateData } from '@/lib/types'; // StaffBookingCreateData is suitable here
import { staffBookingCreateSchema } from '@/lib/schemas'; // Use staffBookingCreateSchema
import {
  ROOM_AVAILABILITY_STATUS,
  TRANSACTION_LIFECYCLE_STATUS,
  TRANSACTION_PAYMENT_STATUS,
  TRANSACTION_IS_ACCEPTED_STATUS,
  HOTEL_ENTITY_STATUS,
  ROOM_CLEANING_STATUS
} from '../../../lib/constants'; // Adjusted path

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in staff/reservations/createReservation action', err);
});

const CREATE_RESERVATION_SQL = `
  INSERT INTO transactions (
    tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name,
    client_payment_method, notes, 
    created_by_user_id, status, 
    created_at, updated_at,
    reserved_check_in_datetime, reserved_check_out_datetime,
    is_admin_created, is_accepted, is_paid, tender_amount, total_amount
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), $10, $11, $12, $13, $14, $15, $16)
  RETURNING *;
`;

const UPDATE_ROOM_FOR_RESERVATION_SQL = `
  UPDATE hotel_room
  SET is_available = $1, transaction_id = $2, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
  WHERE id = $3 AND tenant_id = $4 AND branch_id = $5;
`;

export async function createReservation(
  data: StaffBookingCreateData, // Using StaffBookingCreateData
  tenantId: number,
  branchId: number,
  roomId: number,
  rateId: number, // Explicitly passed rateId
  staffUserId: number
): Promise<{ success: boolean; message?: string; updatedRoomData?: Partial<HotelRoom> & { id: number }; transaction?: Transaction }> {

  if (!staffUserId || staffUserId <= 0) {
    console.error("[createReservation] Invalid staffUserId:", staffUserId);
    return { success: false, message: "Invalid user identifier for creating reservation." };
  }
   if (!tenantId || tenantId <= 0) return { success: false, message: "Invalid tenant identifier." };
   if (!branchId || branchId <= 0) return { success: false, message: "Invalid branch identifier." };
   if (!roomId || roomId <= 0) return { success: false, message: "Invalid room identifier." };
   if (!rateId || rateId <= 0) return { success: false, message: "Invalid rate identifier." };


  const validatedFields = staffBookingCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessages = "Invalid data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
    return { success: false, message: errorMessages };
  }

  const {
    client_name,
    client_payment_method,
    notes,
    is_advance_reservation, // This should typically be true if this action is called
    reserved_check_in_datetime,
    reserved_check_out_datetime,
    is_paid, // from schema, can be boolean
    tender_amount_at_checkin,
  } = validatedFields.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch Room and Rate details for validation and use
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
      return { success: false, message: `Room is not available (current status: ${ROOM_AVAILABILITY_STATUS_TEXT[Number(room.is_available)]}). Cannot reserve.` };
    }
    if (Number(room.cleaning_status) !== ROOM_CLEANING_STATUS.CLEAN) {
        await client.query('ROLLBACK');
        return { success: false, message: "Room is not clean and cannot be reserved." };
    }

    const rateRes = await client.query(
      'SELECT price, name, hours, excess_hour_price FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND status = $4',
      [rateId, tenantId, branchId, HOTEL_ENTITY_STATUS.ACTIVE]
    );
    if (rateRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Selected rate not found or is not active." };
    }
    const selectedRateDetails = rateRes.rows[0] as { price: number; name: string; hours: number; excess_hour_price: number | null };

    // For a new reservation of a specific room by staff, it is immediately 'RESERVATION_WITH_ROOM'
    const finalTransactionLifecycleStatus = TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM;
    
    // Determine payment status based on is_paid flag
    const finalIsPaidStatus = is_paid ? TRANSACTION_PAYMENT_STATUS.PAID : TRANSACTION_PAYMENT_STATUS.UNPAID;
    
    // If paid, total_amount is rate price, otherwise null for reservations
    const totalAmountForTransaction = (finalIsPaidStatus === TRANSACTION_PAYMENT_STATUS.PAID) ? selectedRateDetails.price : null;
    const tenderAmountForTransaction = (finalIsPaidStatus === TRANSACTION_PAYMENT_STATUS.PAID) ? tender_amount_at_checkin : null;


    const transactionValues = [
      tenantId,
      branchId,
      roomId, // hotel_room_id
      rateId, // hotel_rate_id
      client_name,
      client_payment_method,
      notes,
      staffUserId, // created_by_user_id
      finalTransactionLifecycleStatus.toString(), // status
      is_advance_reservation ? reserved_check_in_datetime : null, // reserved_check_in_datetime
      is_advance_reservation ? reserved_check_out_datetime : null, // reserved_check_out_datetime
      0, // is_admin_created (0 for false)
      TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED, // Staff created reservation is auto-accepted by branch
      finalIsPaidStatus, // is_paid (integer)
      tenderAmountForTransaction, // tender_amount
      totalAmountForTransaction   // total_amount
    ];
    
    const transactionRes = await client.query(CREATE_RESERVATION_SQL, transactionValues);
    const newTransactionRow = transactionRes.rows[0];

    await client.query(UPDATE_ROOM_FOR_RESERVATION_SQL, [
      ROOM_AVAILABILITY_STATUS.RESERVED,
      newTransactionRow.id,
      roomId,
      tenantId,
      branchId
    ]);

    await client.query('COMMIT');

    // Map to Transaction type
    const transactionResult: Transaction = {
        id: Number(newTransactionRow.id),
        tenant_id: Number(newTransactionRow.tenant_id),
        branch_id: Number(newTransactionRow.branch_id),
        hotel_room_id: Number(newTransactionRow.hotel_room_id),
        hotel_rate_id: Number(newTransactionRow.hotel_rate_id),
        client_name: String(newTransactionRow.client_name),
        client_payment_method: newTransactionRow.client_payment_method,
        notes: newTransactionRow.notes,
        check_in_time: newTransactionRow.check_in_time ? String(newTransactionRow.check_in_time) : null, // May be null if it's future only
        check_out_time: newTransactionRow.check_out_time,
        hours_used: newTransactionRow.hours_used ? Number(newTransactionRow.hours_used) : null,
        total_amount: newTransactionRow.total_amount ? parseFloat(newTransactionRow.total_amount) : null,
        tender_amount: newTransactionRow.tender_amount !== null ? parseFloat(newTransactionRow.tender_amount) : null,
        is_paid: Number(newTransactionRow.is_paid),
        created_by_user_id: Number(newTransactionRow.created_by_user_id),
        check_out_by_user_id: newTransactionRow.check_out_by_user_id ? Number(newTransactionRow.check_out_by_user_id) : null,
        accepted_by_user_id: newTransactionRow.accepted_by_user_id ? Number(newTransactionRow.accepted_by_user_id) : null,
        declined_by_user_id: newTransactionRow.declined_by_user_id ? Number(newTransactionRow.declined_by_user_id) : null,
        status: Number(newTransactionRow.status),
        created_at: String(newTransactionRow.created_at),
        updated_at: String(newTransactionRow.updated_at),
        reserved_check_in_datetime: newTransactionRow.reserved_check_in_datetime,
        reserved_check_out_datetime: newTransactionRow.reserved_check_out_datetime,
        is_admin_created: Number(newTransactionRow.is_admin_created),
        is_accepted: Number(newTransactionRow.is_accepted),
        rate_name: selectedRateDetails.name,
        rate_price: selectedRateDetails.price,
        rate_hours: selectedRateDetails.hours,
        rate_excess_hour_price: selectedRateDetails.excess_hour_price,
        room_name: room.room_name,
      };

    return {
      success: true,
      message: `Room ${room.room_name} reserved successfully for ${client_name}.`,
      updatedRoomData: {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.RESERVED,
        transaction_id: Number(newTransactionRow.id),
        active_transaction_id: Number(newTransactionRow.id),
        active_transaction_client_name: client_name,
        // For a reservation, the 'active' check-in time is the reserved time
        active_transaction_check_in_time: newTransactionRow.reserved_check_in_datetime || newTransactionRow.created_at, // Use created_at as fallback if no reserved time
        active_transaction_rate_name: selectedRateDetails.name,
        active_transaction_rate_hours: selectedRateDetails.hours,
        active_transaction_lifecycle_status: Number(newTransactionRow.status),
      },
      transaction: transactionResult
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[createReservation DB Error]', error);
    return { success: false, message: `Database error while creating reservation: ${error.message || String(error)}` };
  } finally {
    client.release();
  }
}
