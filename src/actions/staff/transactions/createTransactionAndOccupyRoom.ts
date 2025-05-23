
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
import type { HotelRoom, Transaction, SimpleRate } from '@/lib/types';
import { staffBookingCreateSchema, StaffBookingCreateData } from '@/lib/schemas';
import {
  ROOM_AVAILABILITY_STATUS,
  TRANSACTION_LIFECYCLE_STATUS,
  TRANSACTION_PAYMENT_STATUS,
  TRANSACTION_IS_ACCEPTED_STATUS
} from '@/lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in staff/transactions/createTransactionAndOccupyRoom action', err);
});

export async function createTransactionAndOccupyRoom(
  data: StaffBookingCreateData,
  tenantId: number,
  branchId: number,
  roomId: number,
  rateId: number,
  staffUserId: number
): Promise<{ success: boolean; message?: string; updatedRoomData?: Partial<HotelRoom> & { id: number }; transaction?: Partial<Transaction> }> {
  const validatedFields = staffBookingCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessage = "Invalid data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
    return { success: false, message: errorMessage };
  }

  if (!rateId) {
    return { success: false, message: "Rate ID is required for booking." };
  }
  if (!roomId) {
    return { success: false, message: "Room ID is required for booking." };
  }

  const {
    client_name,
    client_payment_method,
    notes,
    is_paid, // This is now a number from the schema (0 or 1 or 2)
    tender_amount_at_checkin,
    // is_advance_reservation and reserved_datetime fields are not directly used here,
    // as this action is for immediate check-in. They are part of the schema for reusability.
  } = validatedFields.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch rate details to set total_amount if paid upfront
    const rateRes = await client.query('SELECT price, name, hours FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND status = \'1\'', [rateId, tenantId, branchId]);
    if (rateRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Selected rate not found or is not active." };
    }
    const selectedRate = rateRes.rows[0] as SimpleRate & { name: string, hours: number };

    const finalTransactionLifecycleStatus = TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN; // '0'
    const finalIsPaidStatus = is_paid === TRANSACTION_PAYMENT_STATUS.PAID ? TRANSACTION_PAYMENT_STATUS.PAID : TRANSACTION_PAYMENT_STATUS.UNPAID;
    const totalAmountForTransaction = finalIsPaidStatus === TRANSACTION_PAYMENT_STATUS.PAID ? selectedRate.price : null;

    const transactionQuery = `
      INSERT INTO transactions (
        tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name,
        client_payment_method, notes, check_in_time,
        created_by_user_id, status, is_paid, tender_amount, total_amount,
        created_at, updated_at, is_admin_created, is_accepted
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), $8, $9, $10, $11, $12, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), $13, $14)
      RETURNING id, client_name, check_in_time, hotel_rate_id, status, is_paid, total_amount, tender_amount;
    `;
    const transactionValues = [
      tenantId,
      branchId,
      roomId,
      rateId,
      client_name,
      client_payment_method,
      notes,
      staffUserId, // created_by_user_id
      finalTransactionLifecycleStatus.toString(), // status
      finalIsPaidStatus.toString(), // is_paid
      finalIsPaidStatus === TRANSACTION_PAYMENT_STATUS.PAID ? tender_amount_at_checkin : null,
      totalAmountForTransaction,
      0, // is_admin_created (0 for false)
      TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED.toString() // is_accepted (staff implies acceptance by branch)
    ];

    const transactionRes = await client.query(transactionQuery, transactionValues);
    const newTransaction = transactionRes.rows[0];

    const roomUpdateQuery = `
      UPDATE hotel_room
      SET is_available = $1, transaction_id = $2, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $3 AND tenant_id = $4 AND branch_id = $5;
    `;
    await client.query(roomUpdateQuery, [
      ROOM_AVAILABILITY_STATUS.OCCUPIED.toString(),
      newTransaction.id,
      roomId,
      tenantId,
      branchId
    ]);

    await client.query('COMMIT');

    return {
      success: true,
      message: `Guest ${client_name} checked in successfully.`,
      updatedRoomData: {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.OCCUPIED,
        transaction_id: newTransaction.id,
        active_transaction_id: newTransaction.id,
        active_transaction_client_name: client_name,
        active_transaction_check_in_time: newTransaction.check_in_time,
        active_transaction_rate_name: selectedRate.name,
        active_transaction_rate_hours: selectedRate.hours,
        active_transaction_lifecycle_status: Number(newTransaction.status),
      },
      transaction: {
        id: newTransaction.id,
        client_name: client_name,
        status: Number(newTransaction.status),
        is_paid: Number(newTransaction.is_paid),
        total_amount: newTransaction.total_amount ? parseFloat(newTransaction.total_amount) : null,
        tender_amount: newTransaction.tender_amount ? parseFloat(newTransaction.tender_amount) : null,
        hotel_rate_id: rateId,
        hotel_room_id: roomId,
      }
    };
  } catch (error) {
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
