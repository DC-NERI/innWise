
"use server";

import pg from 'pg';
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE
pg.types.setTypeParser(20, (stringValue) => parseInt(stringValue, 10));
pg.types.setTypeParser(1700, (stringValue) => parseFloat(stringValue));
pg.types.setTypeParser(21, (stringValue) => parseInt(stringValue, 10)); // int2
pg.types.setTypeParser(23, (stringValue) => parseInt(stringValue, 10)); // int4


import { Pool } from 'pg';
import type { Transaction } from '@/lib/types';
import { transactionUnassignedUpdateSchema, TransactionUnassignedUpdateData } from '@/lib/schemas';
import { 
  TRANSACTION_IS_ACCEPTED_STATUS, 
  TRANSACTION_LIFECYCLE_STATUS, 
  TRANSACTION_PAYMENT_STATUS 
} from '@/lib/constants';
import { logActivity } from '@/actions/activityLogger';


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
  if (
    typeof TRANSACTION_LIFECYCLE_STATUS?.PENDING_BRANCH_ACCEPTANCE === 'undefined' ||
    typeof TRANSACTION_LIFECYCLE_STATUS?.ADVANCE_RESERVATION === 'undefined' ||
    typeof TRANSACTION_LIFECYCLE_STATUS?.ADVANCE_PAID === 'undefined' ||
    typeof TRANSACTION_IS_ACCEPTED_STATUS?.ACCEPTED === 'undefined' ||
    typeof TRANSACTION_PAYMENT_STATUS?.PAID === 'undefined' ||
    typeof TRANSACTION_PAYMENT_STATUS?.UNPAID === 'undefined'
  ) {
    const errorMessage = "Server configuration error: Critical status constants are missing or undefined in acceptReservationByStaff.";
    console.error('[acceptReservationByStaff] CRITICAL ERROR:', errorMessage);
    return { success: false, message: errorMessage };
  }
  
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

    // Fetch current transaction details for logging and to ensure it's in the correct state
    const currentTxRes = await client.query(
      "SELECT client_name, status FROM transactions WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND status::INTEGER = $4",
      [transactionId, tenantId, branchId, TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE]
    );

    if (currentTxRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Reservation not found or not pending branch acceptance." };
    }
    const originalClientName = currentTxRes.rows[0].client_name;


    const newTransactionLifecycleStatus = is_advance_reservation 
        ? TRANSACTION_LIFECYCLE_STATUS.ADVANCE_RESERVATION 
        : (Number(is_paid) === TRANSACTION_PAYMENT_STATUS.PAID || Number(is_paid) === TRANSACTION_PAYMENT_STATUS.ADVANCE_PAID ? TRANSACTION_LIFECYCLE_STATUS.ADVANCE_PAID : TRANSACTION_LIFECYCLE_STATUS.ADVANCE_RESERVATION);


    const updateQuery = `
      UPDATE transactions
      SET
        client_name = COALESCE($1, client_name),
        hotel_rate_id = $2, -- Rate is required
        client_payment_method = $3,
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
      selected_rate_id, // $2 (Now required by schema for this action)
      client_payment_method ?? null, // $3
      notes ?? null, // $4
      newTransactionLifecycleStatus.toString(), // $5
      TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED, // $6
      staffUserId, // $7
      is_advance_reservation ? reserved_check_in_datetime : null, // $8
      is_advance_reservation ? reserved_check_out_datetime : null, // $9
      is_paid, // $10
      (is_paid === TRANSACTION_PAYMENT_STATUS.UNPAID || is_paid === null) ? null : tender_amount_at_checkin, // $11
      transactionId, // $12
      tenantId, // $13
      branchId, // $14
    ]);

    if (res.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Reservation not found, already processed, or not pending acceptance." };
    }

    const updatedTransactionRow = res.rows[0];

    await logActivity({
        tenant_id: tenantId,
        branch_id: branchId,
        actor_user_id: staffUserId,
        action_type: 'STAFF_ACCEPTED_ADMIN_RESERVATION',
        description: `Staff (ID: ${staffUserId}) accepted admin-created reservation for '${client_name || originalClientName}' (Transaction ID: ${transactionId}).`,
        target_entity_type: 'Transaction',
        target_entity_id: transactionId.toString(),
        details: { 
            client_name: client_name || originalClientName, 
            new_status: newTransactionLifecycleStatus,
            rate_id: selected_rate_id,
            is_paid: is_paid
        }
    }, client);

    await client.query('COMMIT');
    
    let rateName = null;
    if (updatedTransactionRow.hotel_rate_id) {
      const rateRes = await pool.query('SELECT name FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [updatedTransactionRow.hotel_rate_id, tenantId, branchId]);
      if (rateRes.rows.length > 0) rateName = rateRes.rows[0].name;
    }

    return {
      success: true,
      message: "Reservation accepted and updated successfully.",
      updatedTransaction: {
        ...updatedTransactionRow,
        status: Number(updatedTransactionRow.status),
        is_paid: updatedTransactionRow.is_paid !== null ? Number(updatedTransactionRow.is_paid) : null,
        is_accepted: updatedTransactionRow.is_accepted !== null ? Number(updatedTransactionRow.is_accepted) : null,
        is_admin_created: updatedTransactionRow.is_admin_created !== null ? Number(updatedTransactionRow.is_admin_created) : null,
        rate_name: rateName
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

