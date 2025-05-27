
"use server";

import pg from 'pg';
// Configure pg to return numeric types as numbers instead of strings
pg.types.setTypeParser(20, (val) => parseInt(val, 10)); // int8/bigint
pg.types.setTypeParser(21, (val) => parseInt(val, 10)); // int2/smallint
pg.types.setTypeParser(23, (val) => parseInt(val, 10)); // int4/integer
pg.types.setTypeParser(1700, (val) => parseFloat(val)); // numeric/decimal
// Configure pg to return timestamp without timezone as strings
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE


import { Pool } from 'pg';
import type { Transaction } from '@/lib/types';
import { transactionUnassignedUpdateSchema, TransactionUnassignedUpdateData } from '@/lib/schemas';
import {
  TRANSACTION_LIFECYCLE_STATUS,
  TRANSACTION_PAYMENT_STATUS,
  TRANSACTION_IS_ACCEPTED_STATUS
} from '../../../lib/constants'; // Corrected import path
import { logActivity } from '../../activityLogger';


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
  // More specific constant check
  if (
    !TRANSACTION_LIFECYCLE_STATUS ||
    typeof TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE === 'undefined' ||
    typeof TRANSACTION_LIFECYCLE_STATUS.ADVANCE_RESERVATION === 'undefined' ||
    typeof TRANSACTION_LIFECYCLE_STATUS.ADVANCE_PAID === 'undefined' ||
    !TRANSACTION_IS_ACCEPTED_STATUS ||
    typeof TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED === 'undefined' ||
    !TRANSACTION_PAYMENT_STATUS ||
    typeof TRANSACTION_PAYMENT_STATUS.PAID === 'undefined' ||
    typeof TRANSACTION_PAYMENT_STATUS.UNPAID === 'undefined' ||
    typeof TRANSACTION_PAYMENT_STATUS.ADVANCE_PAID === 'undefined'
  ) {
    let missingConstantDetails = [];
    if (!TRANSACTION_LIFECYCLE_STATUS) missingConstantDetails.push("TRANSACTION_LIFECYCLE_STATUS is undefined.");
    else {
        if (typeof TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE === 'undefined') missingConstantDetails.push("PENDING_BRANCH_ACCEPTANCE is undefined in TRANSACTION_LIFECYCLE_STATUS.");
        if (typeof TRANSACTION_LIFECYCLE_STATUS.ADVANCE_RESERVATION === 'undefined') missingConstantDetails.push("ADVANCE_RESERVATION is undefined in TRANSACTION_LIFECYCLE_STATUS.");
        if (typeof TRANSACTION_LIFECYCLE_STATUS.ADVANCE_PAID === 'undefined') missingConstantDetails.push("ADVANCE_PAID is undefined in TRANSACTION_LIFECYCLE_STATUS.");
    }
    if (!TRANSACTION_IS_ACCEPTED_STATUS) missingConstantDetails.push("TRANSACTION_IS_ACCEPTED_STATUS is undefined.");
    else {
        if (typeof TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED === 'undefined') missingConstantDetails.push("ACCEPTED is undefined in TRANSACTION_IS_ACCEPTED_STATUS.");
    }
    if (!TRANSACTION_PAYMENT_STATUS) missingConstantDetails.push("TRANSACTION_PAYMENT_STATUS is undefined.");
    else {
        if (typeof TRANSACTION_PAYMENT_STATUS.PAID === 'undefined') missingConstantDetails.push("PAID is undefined in TRANSACTION_PAYMENT_STATUS.");
        if (typeof TRANSACTION_PAYMENT_STATUS.UNPAID === 'undefined') missingConstantDetails.push("UNPAID is undefined in TRANSACTION_PAYMENT_STATUS.");
        if (typeof TRANSACTION_PAYMENT_STATUS.ADVANCE_PAID === 'undefined') missingConstantDetails.push("ADVANCE_PAID is undefined in TRANSACTION_PAYMENT_STATUS.");
    }
    const errorMessage = `Server configuration error: Critical status constants are missing or undefined in acceptReservationByStaff. Details: ${missingConstantDetails.join('; ')}`;
    console.error('[acceptReservationByStaff] CRITICAL ERROR:', errorMessage);
    return { success: false, message: errorMessage };
  }

  const validatedFields = transactionUnassignedUpdateSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessages = Object.values(validatedFields.error.flatten().fieldErrors).flat().join(' ');
    const errorMessage = "Invalid data: " + errorMessages;
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

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const currentTxRes = await client.query(
      "SELECT client_name, status FROM transactions WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND status::INTEGER = $4",
      [transactionId, tenantId, branchId, TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE]
    );

    if (currentTxRes.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return { success: false, message: "Reservation not found or not pending branch acceptance." };
    }
    const originalClientName = currentTxRes.rows[0].client_name;

    const newTransactionStatus = is_advance_reservation
        ? TRANSACTION_LIFECYCLE_STATUS.ADVANCE_RESERVATION
        : TRANSACTION_LIFECYCLE_STATUS.ADVANCE_PAID; // When staff accepts, it's for a reservation.

    const finalIsPaidStatus = is_paid ?? TRANSACTION_PAYMENT_STATUS.UNPAID;

    const updateQuery = `
      UPDATE transactions
      SET
        client_name = COALESCE($1, client_name),
        hotel_rate_id = $2,
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
      RETURNING id, tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name, client_payment_method, notes, check_in_time, check_out_time, hours_used, total_amount, tender_amount, is_paid, created_by_user_id, check_out_by_user_id, accepted_by_user_id, declined_by_user_id, status, created_at, updated_at, reserved_check_in_datetime, reserved_check_out_datetime, is_admin_created, is_accepted;
    `;

    const res = await client.query(updateQuery, [
      client_name,
      selected_rate_id, // This is now required by transactionUnassignedUpdateSchema
      client_payment_method ?? null,
      notes ?? null,
      newTransactionStatus.toString(),
      TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED,
      staffUserId,
      is_advance_reservation ? reserved_check_in_datetime : null,
      is_advance_reservation ? reserved_check_out_datetime : null,
      finalIsPaidStatus,
      (finalIsPaidStatus === TRANSACTION_PAYMENT_STATUS.UNPAID) ? null : tender_amount_at_checkin,
      transactionId,
      tenantId,
      branchId,
    ]);

    if (res.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return { success: false, message: "Reservation not found, already processed, or not pending acceptance when attempting update." };
    }

    const updatedTransactionRow = res.rows[0];

    try {
        await logActivity({
            tenant_id: tenantId,
            branch_id: branchId,
            actor_user_id: staffUserId,
            action_type: 'STAFF_ACCEPTED_ADMIN_RESERVATION',
            description: `Staff (ID: ${staffUserId}) accepted admin-created reservation for '${client_name || originalClientName}' (Transaction ID: ${transactionId}). Status set to ${newTransactionStatus}.`,
            target_entity_type: 'Transaction',
            target_entity_id: transactionId.toString(),
            details: {
                client_name: client_name || originalClientName,
                new_status: newTransactionStatus,
                rate_id: selected_rate_id,
                is_paid: finalIsPaidStatus
            }
        }, client);
    } catch (logError) {
        console.error('[acceptReservationByStaff] Failed to log activity, but reservation acceptance was successful. Error:', logError);
        // Do not let logging failure roll back the primary action
    }


    await client.query('COMMIT');
    client.release();

    let rateName = null;
    if (updatedTransactionRow.hotel_rate_id) {
      // Use a new client for read-after-write to avoid issues with transaction state if any
      const rateClient = await pool.connect();
      try {
        const rateRes = await rateClient.query('SELECT name FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [updatedTransactionRow.hotel_rate_id, tenantId, branchId]);
        if (rateRes.rows.length > 0) rateName = rateRes.rows[0].name;
      } finally {
        rateClient.release();
      }
    }

    return {
      success: true,
      message: "Reservation accepted and updated successfully.",
      updatedTransaction: {
        ...updatedTransactionRow,
        status: Number(updatedTransactionRow.status),
        is_paid: Number(updatedTransactionRow.is_paid),
        is_accepted: Number(updatedTransactionRow.is_accepted),
        is_admin_created: Number(updatedTransactionRow.is_admin_created),
        rate_name: rateName
      } as Transaction
    };

  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rbError) {
        console.error('[acceptReservationByStaff] Error during rollback:', rbError);
      }
    }
    console.error('[acceptReservationByStaff DB Error]', error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    if (client && !client.release) { // Check if client might have been released in catch block's finally
        // client.release(); // This was causing an issue - client might be released already
    }
  }
}
