
"use server";

import pg from 'pg';
// Configure pg to return numeric types as numbers
pg.types.setTypeParser(pg.types.builtins.INT2, (val: string) => parseInt(val, 10));
pg.types.setTypeParser(pg.types.builtins.INT4, (val: string) => parseInt(val, 10));
pg.types.setTypeParser(pg.types.builtins.INT8, (val: string) => parseInt(val, 10));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (val: string) => parseFloat(val));
// Configure pg to return timestamp without timezone as strings
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE

import { Pool } from 'pg';
import type { Transaction } from '@/lib/types';
import { transactionUnassignedUpdateSchema, TransactionUnassignedUpdateData } from '@/lib/schemas';
import {
  TRANSACTION_LIFECYCLE_STATUS,
  TRANSACTION_LIFECYCLE_STATUS_TEXT,
  TRANSACTION_PAYMENT_STATUS,
  TRANSACTION_IS_ACCEPTED_STATUS, // Added for consistency if needed, though not directly used in this action's core logic
  HOTEL_ENTITY_STATUS
} from '../../../lib/constants';
import { logActivity } from '../../activityLogger';

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
  branchId: number,
  staffUserId: number
): Promise<{ success: boolean; message?: string; updatedTransaction?: Transaction }> {
  console.log(`[updateUnassignedReservation] Action started. TxID: ${transactionId}, StaffID: ${staffUserId}, Data:`, JSON.stringify(data));

  if (!staffUserId || staffUserId <= 0) {
    console.error("[updateUnassignedReservation] Invalid staffUserId:", staffUserId);
    return { success: false, message: "Invalid user identifier." };
  }

  const validatedFields = transactionUnassignedUpdateSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessages = JSON.stringify(validatedFields.error.flatten().fieldErrors);
    console.warn("[updateUnassignedReservation] Validation failed:", errorMessages);
    return { success: false, message: "Invalid data: " + errorMessages };
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

  let client: pg.PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    console.log(`[updateUnassignedReservation] BEGIN transaction for TxID: ${transactionId}`);

    const PRE_CHECK_SQL = 'SELECT status, is_accepted, hotel_rate_id FROM transactions WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND hotel_room_id IS NULL FOR UPDATE';
    const currentTransactionRes = await client.query(PRE_CHECK_SQL, [transactionId, tenantId, branchId]);

    if (currentTransactionRes.rows.length === 0) {
      await client.query('ROLLBACK');
      console.warn(`[updateUnassignedReservation] ROLLBACK: Transaction ${transactionId} not found for tenant ${tenantId}, branch ${branchId}, or already assigned a room.`);
      return { success: false, message: "Reservation not found, already assigned a room, or does not belong to this branch/tenant." };
    }

    const currentStatus = Number(currentTransactionRes.rows[0].status);
    const currentIsAccepted = Number(currentTransactionRes.rows[0].is_accepted);
    const currentRateId = currentTransactionRes.rows[0].hotel_rate_id;

    console.log(`[updateUnassignedReservation] TxID ${transactionId} current DB status: ${currentStatus}, is_accepted: ${currentIsAccepted}, rate_id: ${currentRateId}`);

    // This action should only update reservations that are in 'RESERVATION_NO_ROOM' (3) and 'ACCEPTED' (2) state.
    if (currentStatus !== TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM || currentIsAccepted !== TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED) {
      await client.query('ROLLBACK');
      const errorMessage = `Reservation cannot be updated from its current state (Lifecycle: ${TRANSACTION_LIFECYCLE_STATUS_TEXT[currentStatus] || 'Unknown'}, Acceptance: ${TRANSACTION_IS_ACCEPTED_STATUS_TEXT[currentIsAccepted] || 'Unknown'}). Expected 'Reservation (No Room)' and 'Accepted'.`;
      console.warn(`[updateUnassignedReservation] ROLLBACK: ${errorMessage} for TxID: ${transactionId}`);
      return { success: false, message: errorMessage };
    }

    // For an unassigned reservation being edited, its lifecycle status remains 'RESERVATION_NO_ROOM' (3).
    // The payment status and advance reservation details can change.
    const finalNewTransactionLifecycleStatus = TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM;

    const finalIsPaidDbValue = is_paid ?? TRANSACTION_PAYMENT_STATUS.UNPAID;
    const finalTenderAmount = (finalIsPaidDbValue === TRANSACTION_PAYMENT_STATUS.UNPAID || finalIsPaidDbValue === null) ? null : tender_amount_at_checkin;

    const UPDATE_SQL = `
      UPDATE transactions
      SET
        client_name = COALESCE($1, client_name),
        hotel_rate_id = $2,
        client_payment_method = $3,
        notes = $4,
        status = $5, -- Should remain '3' (RESERVATION_NO_ROOM)
        reserved_check_in_datetime = $6,
        reserved_check_out_datetime = $7,
        is_paid = $8,
        tender_amount = $9,
        updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $10 AND tenant_id = $11 AND branch_id = $12 AND hotel_room_id IS NULL
        AND status::INTEGER = $13 -- Ensure it's still in the expected state
        AND is_accepted::INTEGER = $14
      RETURNING *;
    `;

    const queryParams = [
      client_name,                              // $1
      selected_rate_id ?? null,                 // $2
      client_payment_method ?? null,            // $3
      notes ?? null,                            // $4
      finalNewTransactionLifecycleStatus.toString(), // $5
      is_advance_reservation ? reserved_check_in_datetime : null, // $6
      is_advance_reservation ? reserved_check_out_datetime : null, // $7
      finalIsPaidDbValue,                       // $8
      finalTenderAmount,                        // $9
      transactionId,                            // $10
      tenantId,                                 // $11
      branchId,                                 // $12
      TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM, // $13 (Current expected status)
      TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED // $14 (Current expected acceptance)
    ];

    console.log('[updateUnassignedReservation] Executing UPDATE query with params:', JSON.stringify(queryParams.map(p => p === undefined ? null : p)));
    const res = await client.query(UPDATE_SQL, queryParams);
    console.log('[updateUnassignedReservation] UPDATE query executed. Row count:', res.rowCount);

    if (res.rowCount === 0) {
      await client.query('ROLLBACK');
      console.warn(`[updateUnassignedReservation] ROLLBACK: UPDATE affected 0 rows for TxID ${transactionId}. Transaction state might have changed, or IDs mismatch. Or it was not in status '3' and accepted '2'.`);
      return { success: false, message: "Failed to update reservation. It might have been processed, assigned a room, or its state changed." };
    }

    const updatedTransactionRow = res.rows[0];
    await client.query('COMMIT');
    console.log(`[updateUnassignedReservation] Transaction COMMITTED successfully for TxID: ${transactionId}. New status: ${updatedTransactionRow.status}, is_paid: ${updatedTransactionRow.is_paid}`);

    // Log activity AFTER successful commit
    try {
      const logDescription = `Staff (ID: ${staffUserId}) updated unassigned reservation for '${updatedTransactionRow.client_name}' (Transaction ID: ${transactionId}).`;
      console.log(`[updateUnassignedReservation] Attempting to log activity post-commit for TxID: ${transactionId}. Description: ${logDescription}`);
      await logActivity({
        tenant_id: tenantId,
        branch_id: branchId,
        actor_user_id: staffUserId,
        action_type: 'STAFF_UPDATED_UNASSIGNED_RESERVATION',
        description: logDescription,
        target_entity_type: 'Transaction',
        target_entity_id: transactionId.toString(),
        details: { updated_fields: Object.keys(data).filter(k => data[k as keyof TransactionUnassignedUpdateData] !== undefined), client_name: updatedTransactionRow.client_name }
      });
      console.log(`[updateUnassignedReservation] Activity logged successfully post-commit for TxID: ${transactionId}.`);
    } catch (logError: any) {
      console.error(`[updateUnassignedReservation] Failed to log activity post-commit for TxID: ${transactionId}. Error:`, logError.message, logError.stack);
    }

    // Fetch rate name for the returned object
    let rateName: string | null = null;
    let ratePrice: number | null = null;
    let rateHours: number | null = null;

    if (updatedTransactionRow.hotel_rate_id) {
      const rateClient = await pool.connect(); // Use a new connection from the pool
      try {
        const rateRes = await rateClient.query(
          'SELECT name, price, hours FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND status = $4',
          [updatedTransactionRow.hotel_rate_id, tenantId, branchId, HOTEL_ENTITY_STATUS.ACTIVE]
        );
        if (rateRes.rows.length > 0) {
          rateName = rateRes.rows[0].name;
          ratePrice = parseFloat(rateRes.rows[0].price);
          rateHours = parseInt(rateRes.rows[0].hours, 10);
        }
      } catch (rateFetchError) {
        console.error(`[updateUnassignedReservation] Error fetching rate details post-commit for TxID ${transactionId}:`, rateFetchError);
      } finally {
        rateClient.release();
      }
    }

    const finalUpdatedTransaction: Transaction = {
      id: Number(updatedTransactionRow.id),
      tenant_id: Number(updatedTransactionRow.tenant_id),
      branch_id: Number(updatedTransactionRow.branch_id),
      hotel_room_id: null, // Remains null for unassigned
      hotel_rate_id: updatedTransactionRow.hotel_rate_id ? Number(updatedTransactionRow.hotel_rate_id) : null,
      client_name: String(updatedTransactionRow.client_name),
      client_payment_method: updatedTransactionRow.client_payment_method,
      notes: updatedTransactionRow.notes,
      check_in_time: updatedTransactionRow.check_in_time, // This is the reservation creation/acceptance time, not actual check-in
      check_out_time: updatedTransactionRow.check_out_time,
      hours_used: updatedTransactionRow.hours_used ? Number(updatedTransactionRow.hours_used) : null,
      total_amount: updatedTransactionRow.total_amount ? parseFloat(updatedTransactionRow.total_amount) : null,
      tender_amount: updatedTransactionRow.tender_amount !== null ? parseFloat(updatedTransactionRow.tender_amount) : null,
      is_paid: Number(updatedTransactionRow.is_paid),
      created_by_user_id: Number(updatedTransactionRow.created_by_user_id),
      check_out_by_user_id: updatedTransactionRow.check_out_by_user_id ? Number(updatedTransactionRow.check_out_by_user_id) : null,
      accepted_by_user_id: updatedTransactionRow.accepted_by_user_id ? Number(updatedTransactionRow.accepted_by_user_id) : null,
      declined_by_user_id: updatedTransactionRow.declined_by_user_id ? Number(updatedTransactionRow.declined_by_user_id) : null,
      status: Number(updatedTransactionRow.status),
      created_at: updatedTransactionRow.created_at,
      updated_at: updatedTransactionRow.updated_at,
      reserved_check_in_datetime: updatedTransactionRow.reserved_check_in_datetime,
      reserved_check_out_datetime: updatedTransactionRow.reserved_check_out_datetime,
      is_admin_created: Number(updatedTransactionRow.is_admin_created),
      is_accepted: Number(updatedTransactionRow.is_accepted),
      rate_name: rateName,
      rate_price: ratePrice,
      rate_hours: rateHours,
    };

    console.log(`[updateUnassignedReservation] Returning updated transaction for TxID ${transactionId}:`, JSON.stringify(finalUpdatedTransaction, null, 2));
    return {
      success: true,
      message: "Unassigned reservation details updated successfully.",
      updatedTransaction: finalUpdatedTransaction,
    };

  } catch (dbError: any) {
    if (client) {
      try {
        await client.query('ROLLBACK');
        console.warn(`[updateUnassignedReservation] Transaction ROLLED BACK for TxID: ${transactionId} due to error: ${dbError.message}`);
      } catch (rbError: any) {
        console.error(`[updateUnassignedReservation] Error during rollback for TxID: ${transactionId}:`, rbError);
      }
    }
    console.error(`[updateUnassignedReservation DB Full Error for TxID: ${transactionId}]`, dbError);
    return { success: false, message: `Database error during reservation update: ${dbError.message}` };
  } finally {
    if (client) {
      client.release();
      console.log(`[updateUnassignedReservation] Client released for TxID: ${transactionId}`);
    }
  }
}
