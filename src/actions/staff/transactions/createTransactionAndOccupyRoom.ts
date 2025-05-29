
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
import type { HotelRoom, Transaction, SimpleRate, StaffBookingCreateData } from '@/lib/types';
import { staffBookingCreateSchema } from '@/lib/schemas';
import {
  ROOM_AVAILABILITY_STATUS,
  TRANSACTION_LIFECYCLE_STATUS,
  TRANSACTION_PAYMENT_STATUS,
  TRANSACTION_IS_ACCEPTED_STATUS,
  HOTEL_ENTITY_STATUS
} from '@/lib/constants';
import { format as formatDateTime, parseISO, addHours as dateFnsAddHours, differenceInMilliseconds } from 'date-fns';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in staff/transactions/createTransactionAndOccupyRoom action', err);
});

const CREATE_TRANSACTION_OCCUPY_SQL = `
  INSERT INTO transactions (
    tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name,
    client_payment_method, notes, check_in_time,
    created_by_user_id, status, is_paid, tender_amount, total_amount,
    created_at, updated_at, is_admin_created, is_accepted,
    reserved_check_in_datetime, reserved_check_out_datetime
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), $8, $9, $10, $11, $12, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), $13, $14, $15, $16)
  RETURNING *;
`;

const UPDATE_ROOM_OCCUPY_SQL = `
  UPDATE hotel_room
  SET is_available = $1, transaction_id = $2, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
  WHERE id = $3 AND tenant_id = $4 AND branch_id = $5;
`;

export async function createTransactionAndOccupyRoom(
  data: StaffBookingCreateData,
  tenantId: number,
  branchId: number,
  roomId: number,
  rateId: number,
  staffUserId: number
): Promise<{ success: boolean; message?: string; updatedRoomData?: Partial<HotelRoom> & { id: number }; transaction?: Transaction }> {
  
  if (!staffUserId || staffUserId <= 0) {
    console.error("[createTransactionAndOccupyRoom] Invalid staffUserId:", staffUserId);
    return { success: false, message: "Invalid user identifier for creating transaction." };
  }
  if (!tenantId || tenantId <= 0) {
    console.error("[createTransactionAndOccupyRoom] Invalid tenantId:", tenantId);
    return { success: false, message: "Invalid tenant identifier." };
  }
  if (!branchId || branchId <= 0) {
    console.error("[createTransactionAndOccupyRoom] Invalid branchId:", branchId);
    return { success: false, message: "Invalid branch identifier." };
  }
   if (!roomId || roomId <= 0) {
    console.error("[createTransactionAndOccupyRoom] Invalid roomId:", roomId);
    return { success: false, message: "Invalid room identifier." };
  }
   if (!rateId || rateId <= 0) {
    console.error("[createTransactionAndOccupyRoom] Invalid rateId:", rateId);
    return { success: false, message: "Invalid rate identifier." };
  }

  const validatedFields = staffBookingCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessages = "Invalid data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
    return { success: false, message: errorMessages };
  }

  const {
    client_name,
    client_payment_method,
    notes,
    is_paid,
    tender_amount_at_checkin,
    is_advance_reservation, // Will be true if booking for future from room status
    reserved_check_in_datetime,
    reserved_check_out_datetime,
  } = validatedFields.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const rateRes = await client.query(
      'SELECT price, name, hours, excess_hour_price FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND status = $4',
      [rateId, tenantId, branchId, HOTEL_ENTITY_STATUS.ACTIVE]
    );
    if (rateRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Selected rate not found or is not active." };
    }
    const selectedRateDetails = rateRes.rows[0] as { price: number; name: string; hours: number; excess_hour_price: number | null };

    // For direct booking/walk-in, status is CHECKED_IN, and is_paid tracks immediate payment.
    // If it's an advance reservation being made directly (mode === 'reserve' in UI), status is RESERVATION_WITH_ROOM
    const finalTransactionLifecycleStatus = is_advance_reservation 
        ? TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM 
        : TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN;

    const finalIsPaidStatus = is_paid ? TRANSACTION_PAYMENT_STATUS.PAID : TRANSACTION_PAYMENT_STATUS.UNPAID;
    
    // total_amount for immediate check-in if paid, refers to the base rate price for the standard duration.
    // For reservations, total_amount is typically calculated upon actual check-in or checkout.
    // For simplicity, if paid at booking/reservation, we set total_amount to rate price.
    const totalAmountForTransaction = (finalIsPaidStatus === TRANSACTION_PAYMENT_STATUS.PAID) ? selectedRateDetails.price : null;
    const tenderAmountForTransaction = (finalIsPaidStatus === TRANSACTION_PAYMENT_STATUS.PAID) ? tender_amount_at_checkin : null;

    const transactionValues = [
      tenantId,
      branchId,
      roomId,
      rateId,
      client_name,
      client_payment_method,
      notes,
      staffUserId,
      finalTransactionLifecycleStatus.toString(),
      finalIsPaidStatus,
      tenderAmountForTransaction,
      totalAmountForTransaction,
      0, // is_admin_created (0 for false)
      TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED, // Staff created, so considered accepted by branch
      is_advance_reservation ? reserved_check_in_datetime : null,
      is_advance_reservation ? reserved_check_out_datetime : null,
    ];
    
    const transactionRes = await client.query(CREATE_TRANSACTION_OCCUPY_SQL, transactionValues);
    const newTransactionRow = transactionRes.rows[0];

    const roomAvailabilityStatusToSet = is_advance_reservation ? ROOM_AVAILABILITY_STATUS.RESERVED : ROOM_AVAILABILITY_STATUS.OCCUPIED;

    await client.query(UPDATE_ROOM_OCCUPY_SQL, [
      roomAvailabilityStatusToSet,
      newTransactionRow.id,
      roomId,
      tenantId,
      branchId
    ]);

    await client.query('COMMIT');

    const finalMessage = is_advance_reservation 
        ? `Room ${roomId} reserved successfully for ${client_name}.`
        : `Guest ${client_name} checked in successfully to room ${roomId}.`;

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
        check_in_time: String(newTransactionRow.check_in_time),
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
        rate_name: selectedRateDetails.name, // From fetched rate
        rate_price: selectedRateDetails.price,
        rate_hours: selectedRateDetails.hours,
        rate_excess_hour_price: selectedRateDetails.excess_hour_price,
      };


    return {
      success: true,
      message: finalMessage,
      updatedRoomData: {
        id: roomId,
        is_available: roomAvailabilityStatusToSet,
        transaction_id: Number(newTransactionRow.id),
        active_transaction_id: Number(newTransactionRow.id),
        active_transaction_client_name: client_name,
        active_transaction_check_in_time: is_advance_reservation ? newTransactionRow.reserved_check_in_datetime : newTransactionRow.check_in_time,
        active_transaction_rate_name: selectedRateDetails.name,
        active_transaction_rate_hours: selectedRateDetails.hours,
        active_transaction_lifecycle_status: Number(newTransactionRow.status),
      },
      transaction: transactionResult,
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[createTransactionAndOccupyRoom DB Error]', error);
    const dbError = error as any;
    if (dbError.code === '23503' && dbError.constraint && dbError.constraint.includes('hotel_room_id')) {
      return { success: false, message: "Selected room is not valid or does not exist." };
    }
    if (dbError.code === '23503' && dbError.constraint && dbError.constraint.includes('hotel_rate_id')) {
      return { success: false, message: "Selected rate is not valid or does not exist." };
    }
    return { success: false, message: `Database error during check-in: ${dbError.message || String(dbError)}` };
  } finally {
    client.release();
  }
}
