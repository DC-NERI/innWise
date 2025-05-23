
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
import type { Transaction } from '@/lib/types';
import { transactionReservedUpdateSchema, TransactionReservedUpdateData } from '@/lib/schemas';
import { TRANSACTION_LIFECYCLE_STATUS, TRANSACTION_PAYMENT_STATUS } from '@/lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in staff/reservations/updateReservedTransactionDetails action', err);
});

export async function updateReservedTransactionDetails(
  transactionId: number,
  data: TransactionReservedUpdateData,
  tenantId: number,
  branchId: number
): Promise<{ success: boolean; message?: string; updatedTransaction?: Transaction }> {
  const validatedFields = transactionReservedUpdateSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessage = "Invalid data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
    return { success: false, message: errorMessage };
  }

  const {
    client_name,
    selected_rate_id,
    client_payment_method,
    notes,
    is_advance_reservation, // This determines if reserved_datetime fields are used
    reserved_check_in_datetime,
    reserved_check_out_datetime,
    is_paid,
    tender_amount_at_checkin,
  } = validatedFields.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if the transaction is in a state that allows this update (e.g., 'RESERVATION_WITH_ROOM')
    const currentTransactionRes = await client.query(
      'SELECT status FROM transactions WHERE id = $1 AND tenant_id = $2 AND branch_id = $3',
      [transactionId, tenantId, branchId]
    );

    if (currentTransactionRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Transaction not found." };
    }

    const currentStatus = Number(currentTransactionRes.rows[0].status);
    if (currentStatus !== TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM) { // Status '2'
      await client.query('ROLLBACK');
      return { success: false, message: `Transaction is not in a state that allows detailed updates (current status: ${currentStatus}). It must be an active room reservation.` };
    }

    // For this specific update, we are primarily updating details of an *existing* room-assigned reservation.
    // The lifecycle status '2' (RESERVATION_WITH_ROOM) should typically remain.
    const finalTransactionStatus = TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM.toString();
    const finalIsPaidStatus = (is_paid === TRANSACTION_PAYMENT_STATUS.PAID || is_paid === TRANSACTION_PAYMENT_STATUS.ADVANCE_PAID) ? is_paid : TRANSACTION_PAYMENT_STATUS.UNPAID;


    const updateQuery = `
      UPDATE transactions
      SET
        client_name = $1,
        hotel_rate_id = $2,
        client_payment_method = $3,
        notes = $4,
        status = $5, -- Should remain RESERVATION_WITH_ROOM for this specific update
        reserved_check_in_datetime = $6,
        reserved_check_out_datetime = $7,
        is_paid = $8,
        tender_amount = $9,
        updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $10 AND tenant_id = $11 AND branch_id = $12
      RETURNING *;
    `;

    const res = await client.query(updateQuery, [
      client_name,
      selected_rate_id,
      client_payment_method,
      notes,
      finalTransactionStatus,
      is_advance_reservation ? reserved_check_in_datetime : null,
      is_advance_reservation ? reserved_check_out_datetime : null,
      finalIsPaidStatus.toString(),
      tender_amount_at_checkin,
      transactionId,
      tenantId,
      branchId
    ]);

    if (res.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update reservation details or reservation not found after initial check." };
    }

    await client.query('COMMIT');
    const updatedTransactionRow = res.rows[0];

    // Fetch rate and room name for the full Transaction object
    let rateName = null;
    let roomName = null;

    if (updatedTransactionRow.hotel_rate_id) {
        const rateRes = await client.query('SELECT name FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [updatedTransactionRow.hotel_rate_id, tenantId, branchId]);
        if (rateRes.rows.length > 0) rateName = rateRes.rows[0].name;
    }
    if (updatedTransactionRow.hotel_room_id) {
        const roomRes = await client.query('SELECT room_name FROM hotel_room WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [updatedTransactionRow.hotel_room_id, tenantId, branchId]);
        if (roomRes.rows.length > 0) roomName = roomRes.rows[0].room_name;
    }
    
    const updatedTransaction: Transaction = {
      id: Number(updatedTransactionRow.id),
      tenant_id: Number(updatedTransactionRow.tenant_id),
      branch_id: Number(updatedTransactionRow.branch_id),
      hotel_room_id: updatedTransactionRow.hotel_room_id ? Number(updatedTransactionRow.hotel_room_id) : null,
      hotel_rate_id: updatedTransactionRow.hotel_rate_id ? Number(updatedTransactionRow.hotel_rate_id) : null,
      client_name: updatedTransactionRow.client_name,
      client_payment_method: updatedTransactionRow.client_payment_method,
      notes: updatedTransactionRow.notes,
      check_in_time: updatedTransactionRow.check_in_time,
      check_out_time: updatedTransactionRow.check_out_time,
      hours_used: updatedTransactionRow.hours_used ? Number(updatedTransactionRow.hours_used) : null,
      total_amount: updatedTransactionRow.total_amount ? parseFloat(updatedTransactionRow.total_amount) : null,
      tender_amount: updatedTransactionRow.tender_amount ? parseFloat(updatedTransactionRow.tender_amount) : null,
      is_paid: updatedTransactionRow.is_paid !== null ? Number(updatedTransactionRow.is_paid) : null,
      created_by_user_id: Number(updatedTransactionRow.created_by_user_id),
      check_out_by_user_id: updatedTransactionRow.check_out_by_user_id ? Number(updatedTransactionRow.check_out_by_user_id) : null,
      accepted_by_user_id: updatedTransactionRow.accepted_by_user_id ? Number(updatedTransactionRow.accepted_by_user_id) : null,
      declined_by_user_id: updatedTransactionRow.declined_by_user_id ? Number(updatedTransactionRow.declined_by_user_id) : null,
      status: Number(updatedTransactionRow.status),
      created_at: updatedTransactionRow.created_at,
      updated_at: updatedTransactionRow.updated_at,
      reserved_check_in_datetime: updatedTransactionRow.reserved_check_in_datetime,
      reserved_check_out_datetime: updatedTransactionRow.reserved_check_out_datetime,
      is_admin_created: updatedTransactionRow.is_admin_created !== null ? Number(updatedTransactionRow.is_admin_created) : null,
      is_accepted: updatedTransactionRow.is_accepted !== null ? Number(updatedTransactionRow.is_accepted) : null,
      rate_name: rateName,
      room_name: roomName,
      rate_price: null, // Not fetched in this specific action, can be added if needed
      rate_hours: null, // Not fetched in this specific action
      rate_excess_hour_price: null // Not fetched
    };


    return {
      success: true,
      message: "Reservation details updated successfully.",
      updatedTransaction: updatedTransaction
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[updateReservedTransactionDetails DB Error]', error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}
    
