
"use server";

import pg from 'pg';
pg.types.setTypeParser(1114, (stringValue) => stringValue);
pg.types.setTypeParser(1184, (stringValue) => stringValue);
pg.types.setTypeParser(20, (stringValue) => parseInt(stringValue, 10));
pg.types.setTypeParser(1700, (stringValue) => parseFloat(stringValue));

import { Pool } from 'pg';
import type { Transaction } from '@/lib/types';
import { transactionUnassignedUpdateSchema, TransactionUnassignedUpdateData } from '@/lib/schemas';
import { TRANSACTION_LIFECYCLE_STATUS, TRANSACTION_PAYMENT_STATUS } from '@/lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in staff/reservations/updateUnassignedReservation action', err);
});

export async function updateUnassignedReservation(
  transactionId: number,
  data: TransactionUnassignedUpdateData,
  tenantId: number,
  branchId: number
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

    const currentTransactionRes = await client.query('SELECT status FROM transactions WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND hotel_room_id IS NULL', [transactionId, tenantId, branchId]);
    if (currentTransactionRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, message: "Reservation not found or already assigned a room." };
    }

    const currentStatus = Number(currentTransactionRes.rows[0].status);
    let newTransactionStatus = currentStatus;

    // Only allow certain statuses to be updated this way
    if (currentStatus === TRANSACTION_LIFECYCLE_STATUS.ADVANCE_PAID || currentStatus === TRANSACTION_LIFECYCLE_STATUS.ADVANCE_RESERVATION) {
        newTransactionStatus = is_advance_reservation
            ? TRANSACTION_LIFECYCLE_STATUS.ADVANCE_RESERVATION
            : (is_paid === TRANSACTION_PAYMENT_STATUS.PAID ? TRANSACTION_LIFECYCLE_STATUS.ADVANCE_PAID : TRANSACTION_LIFECYCLE_STATUS.ADVANCE_RESERVATION);
    } else {
        await client.query('ROLLBACK');
        return { success: false, message: "Reservation cannot be updated from its current state." };
    }

    const query = `
      UPDATE transactions
      SET
        client_name = COALESCE($1, client_name),
        hotel_rate_id = COALESCE($2, hotel_rate_id),
        client_payment_method = COALESCE($3, client_payment_method),
        notes = $4,
        status = $5,
        reserved_check_in_datetime = $6,
        reserved_check_out_datetime = $7,
        is_paid = $8,
        tender_amount = $9,
        updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $10 AND tenant_id = $11 AND branch_id = $12 AND hotel_room_id IS NULL
      RETURNING *;
    `;

    const res = await client.query(query, [
      client_name,
      selected_rate_id,
      client_payment_method,
      notes,
      newTransactionStatus.toString(),
      reserved_check_in_datetime,
      reserved_check_out_datetime,
      is_paid,
      tender_amount_at_checkin,
      transactionId,
      tenantId,
      branchId
    ]);

    if (res.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update reservation or reservation not found." };
    }

    await client.query('COMMIT');
    const updatedTransaction = res.rows[0];
    return {
      success: true,
      message: "Reservation updated successfully.",
      updatedTransaction: {
        ...updatedTransaction,
        status: Number(updatedTransaction.status),
        is_paid: Number(updatedTransaction.is_paid),
        is_accepted: updatedTransaction.is_accepted !== null ? Number(updatedTransaction.is_accepted) : null,
        is_admin_created: updatedTransaction.is_admin_created !== null ? Number(updatedTransaction.is_admin_created) : null,
      } as Transaction
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[updateUnassignedReservation DB Error]', error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}
    