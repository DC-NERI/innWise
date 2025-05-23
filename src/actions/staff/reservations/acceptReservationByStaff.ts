
"use server";

import pg from 'pg';
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE
pg.types.setTypeParser(20, (stringValue) => parseInt(stringValue, 10));
pg.types.setTypeParser(1700, (stringValue) => parseFloat(stringValue));

import { Pool } from 'pg';
import type { Transaction } from '@/lib/types';
import { transactionUnassignedUpdateSchema, TransactionUnassignedUpdateData } from '@/lib/schemas';
import { TRANSACTION_IS_ACCEPTED_STATUS, TRANSACTION_LIFECYCLE_STATUS, TRANSACTION_PAYMENT_STATUS } from '@/lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in staff/reservations/acceptReservationByStaff action', err);
});

export async function acceptReservationByStaff(
  transactionId: number,
  data: TransactionUnassignedUpdateData,
  tenantId: number,
  branchId: number,
  staffUserId: number
): Promise<{ success: boolean; message?: string; updatedTransaction?: Transaction }> {
  const validatedFields = transactionUnassignedUpdateSchema.safeParse(data);
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

    const newTransactionStatus = is_advance_reservation ? TRANSACTION_LIFECYCLE_STATUS.ADVANCE_RESERVATION : TRANSACTION_LIFECYCLE_STATUS.ADVANCE_PAID;

    const updateQuery = `
      UPDATE transactions
      SET
        client_name = COALESCE($1, client_name),
        hotel_rate_id = COALESCE($2, hotel_rate_id),
        client_payment_method = COALESCE($3, client_payment_method),
        notes = $4,
        status = $5,
        is_accepted = $6,
        accepted_by_user_id = $7,
        reserved_check_in_datetime = $8,
        reserved_check_out_datetime = $9,
        is_paid = $10,
        tender_amount = $11,
        updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $12 AND tenant_id = $13 AND branch_id = $14 AND status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE}
      RETURNING *;
    `;

    const res = await client.query(updateQuery, [
      client_name, // $1
      selected_rate_id, // $2
      client_payment_method, // $3
      notes, // $4
      newTransactionStatus.toString(), // $5
      TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED, // $6
      staffUserId, // $7
      reserved_check_in_datetime, // $8
      reserved_check_out_datetime, // $9
      is_paid ? TRANSACTION_PAYMENT_STATUS.PAID : TRANSACTION_PAYMENT_STATUS.UNPAID, // $10
      tender_amount_at_checkin, // $11
      transactionId, // $12
      tenantId, // $13
      branchId, // $14
    ]);

    if (res.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Reservation not found, already processed, or not pending acceptance." };
    }

    await client.query('COMMIT');
    const updatedTransaction = res.rows[0];
    return {
      success: true,
      message: "Reservation accepted and updated successfully.",
      updatedTransaction: {
        ...updatedTransaction,
        status: Number(updatedTransaction.status),
        is_paid: Number(updatedTransaction.is_paid),
        is_accepted: Number(updatedTransaction.is_accepted),
      } as Transaction
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[acceptReservationByStaff DB Error]', error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}
