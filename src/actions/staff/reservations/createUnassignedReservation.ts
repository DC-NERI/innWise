
"use server";

import pg from 'pg';
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE
pg.types.setTypeParser(20, (stringValue) => parseInt(stringValue, 10));
pg.types.setTypeParser(1700, (stringValue) => parseFloat(stringValue));

import { Pool } from 'pg';
import type { Transaction } from '@/lib/types';
import { transactionCreateSchema, TransactionCreateData } from '@/lib/schemas';
import { TRANSACTION_LIFECYCLE_STATUS, TRANSACTION_PAYMENT_STATUS, TRANSACTION_IS_ACCEPTED_STATUS } from '@/lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in staff/reservations/createUnassignedReservation action', err);
});

export async function createUnassignedReservation(
  data: TransactionCreateData,
  tenantId: number,
  branchId: number,
  staffUserId: number,
  is_admin_created_flag: boolean = false
): Promise<{ success: boolean; message?: string; transaction?: Transaction }> {
  const validatedFields = transactionCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessage = "Invalid data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
    return { success: false, message: errorMessage };
  }

  const {
    client_name,
    selected_rate_id,
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

    let transactionStatus;
    let finalIsAcceptedStatus = TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED.toString(); // Default to accepted for staff-created

    if (is_admin_created_flag) {
      transactionStatus = TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE.toString();
      finalIsAcceptedStatus = TRANSACTION_IS_ACCEPTED_STATUS.PENDING.toString();
    } else {
      transactionStatus = is_advance_reservation
        ? TRANSACTION_LIFECYCLE_STATUS.ADVANCE_RESERVATION.toString()
        : TRANSACTION_PAYMENT_STATUS.PAID ? TRANSACTION_LIFECYCLE_STATUS.ADVANCE_PAID.toString() : TRANSACTION_LIFECYCLE_STATUS.ADVANCE_RESERVATION.toString(); // Simplified: If not future, treat as ADVANCE_PAID if payment made, else ADVANCE_RESERVATION
    }
    
    const finalIsPaidStatus = is_paid === TRANSACTION_PAYMENT_STATUS.PAID ? TRANSACTION_PAYMENT_STATUS.PAID : TRANSACTION_PAYMENT_STATUS.UNPAID;

    const query = `
      INSERT INTO transactions (
        tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name,
        client_payment_method, notes, check_in_time,
        created_by_user_id, status, updated_at,
        reserved_check_in_datetime, reserved_check_out_datetime,
        is_admin_created, is_accepted, is_paid, tender_amount
      )
      VALUES ($1, $2, NULL, $3, $4, $5, $6, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), $7, $8, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), $9, $10, $11, $12, $13, $14)
      RETURNING *;
    `;

    const res = await client.query(query, [
      tenantId,
      branchId,
      selected_rate_id, // hotel_rate_id
      client_name,
      client_payment_method,
      notes,
      staffUserId, // created_by_user_id
      transactionStatus,
      reserved_check_in_datetime,
      reserved_check_out_datetime,
      is_admin_created_flag ? 1 : 0,
      finalIsAcceptedStatus,
      finalIsPaidStatus,
      tender_amount_at_checkin
    ]);

    await client.query('COMMIT');

    if (res.rows.length > 0) {
      const newTransaction = res.rows[0];
      return {
        success: true,
        message: "Unassigned reservation created successfully.",
        transaction: {
          ...newTransaction,
          status: Number(newTransaction.status),
          is_paid: Number(newTransaction.is_paid),
          is_accepted: newTransaction.is_accepted !== null ? Number(newTransaction.is_accepted) : null,
          is_admin_created: newTransaction.is_admin_created !== null ? Number(newTransaction.is_admin_created) : null,
        } as Transaction
      };
    }
    return { success: false, message: "Reservation creation failed." };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[createUnassignedReservation DB Error]', error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}
    