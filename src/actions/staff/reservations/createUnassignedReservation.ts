
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
import { transactionCreateSchema, TransactionCreateData } from '@/lib/schemas';
import {
  TRANSACTION_LIFECYCLE_STATUS,
  TRANSACTION_PAYMENT_STATUS,
  TRANSACTION_IS_ACCEPTED_STATUS
} from '../../../lib/constants';

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

  if (!staffUserId || typeof staffUserId !== 'number' || staffUserId <= 0) {
    console.error("[createUnassignedReservation] Invalid staffUserId received:", staffUserId, "Data:", data);
    return { success: false, message: "Invalid user identifier for creating reservation." };
  }

  // Critical check for constants availability
  if (
    !TRANSACTION_LIFECYCLE_STATUS ||
    !TRANSACTION_PAYMENT_STATUS ||
    !TRANSACTION_IS_ACCEPTED_STATUS ||
    (is_admin_created_flag && typeof TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE === 'undefined') ||
    (!is_admin_created_flag && (typeof TRANSACTION_LIFECYCLE_STATUS.ADVANCE_RESERVATION === 'undefined' || typeof TRANSACTION_LIFECYCLE_STATUS.ADVANCE_PAID === 'undefined')) ||
    typeof TRANSACTION_PAYMENT_STATUS.PAID === 'undefined' ||
    typeof TRANSACTION_PAYMENT_STATUS.UNPAID === 'undefined' ||
    (is_admin_created_flag && typeof TRANSACTION_IS_ACCEPTED_STATUS.PENDING === 'undefined') ||
    (!is_admin_created_flag && typeof TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED === 'undefined')
  ) {
    const errorMessage = "Server configuration error: Critical status constants are missing or undefined in createUnassignedReservation.";
    // console.error('[createUnassignedReservation] CRITICAL ERROR:', errorMessage, {
    //     TRANSACTION_LIFECYCLE_STATUS_defined: !!TRANSACTION_LIFECYCLE_STATUS,
    //     PENDING_BRANCH_ACCEPTANCE_defined: typeof TRANSACTION_LIFECYCLE_STATUS?.PENDING_BRANCH_ACCEPTANCE,
    //     ADVANCE_RESERVATION_defined: typeof TRANSACTION_LIFECYCLE_STATUS?.ADVANCE_RESERVATION,
    //     ADVANCE_PAID_defined: typeof TRANSACTION_LIFECYCLE_STATUS?.ADVANCE_PAID,
    //     TRANSACTION_PAYMENT_STATUS_defined: !!TRANSACTION_PAYMENT_STATUS,
    //     PAID_defined: typeof TRANSACTION_PAYMENT_STATUS?.PAID,
    //     UNPAID_defined: typeof TRANSACTION_PAYMENT_STATUS?.UNPAID,
    //     TRANSACTION_IS_ACCEPTED_STATUS_defined: !!TRANSACTION_IS_ACCEPTED_STATUS,
    //     PENDING_defined: typeof TRANSACTION_IS_ACCEPTED_STATUS?.PENDING,
    //     ACCEPTED_defined: typeof TRANSACTION_IS_ACCEPTED_STATUS?.ACCEPTED,
    //     is_admin_created_flag,
    // });
    return { success: false, message: errorMessage };
  }

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

    let transactionLifecycleStatusValue: number;
    let finalIsAcceptedStatusValue: number;

    if (is_admin_created_flag) {
      transactionLifecycleStatusValue = TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE; // 4
      finalIsAcceptedStatusValue = TRANSACTION_IS_ACCEPTED_STATUS.PENDING; // 3
    } else { // Staff creating for their own branch
      transactionLifecycleStatusValue = is_advance_reservation
        ? TRANSACTION_LIFECYCLE_STATUS.ADVANCE_RESERVATION // 3
        : (is_paid === TRANSACTION_PAYMENT_STATUS.PAID ? TRANSACTION_LIFECYCLE_STATUS.ADVANCE_PAID : TRANSACTION_LIFECYCLE_STATUS.ADVANCE_RESERVATION); // 2 or 3
      finalIsAcceptedStatusValue = TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED; // 2
    }
    
    const finalIsPaidDbValue = is_paid ?? TRANSACTION_PAYMENT_STATUS.UNPAID;

    const queryText = `
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
    const transactionValues = [
      tenantId, // $1
      branchId, // $2
      selected_rate_id ?? null, // $3 hotel_rate_id (can be null)
      client_name, // $4
      client_payment_method ?? null, // $5 can be null
      notes ?? null, // $6
      staffUserId, // $7 created_by_user_id
      transactionLifecycleStatusValue.toString(), // $8 status (VARCHAR in DB)
      is_advance_reservation ? reserved_check_in_datetime : null, // $9
      is_advance_reservation ? reserved_check_out_datetime : null, // $10
      is_admin_created_flag ? 1 : 0, // $11 is_admin_created (SMALLINT)
      finalIsAcceptedStatusValue, // $12 is_accepted (SMALLINT)
      finalIsPaidDbValue, // $13 is_paid (INTEGER)
      (finalIsPaidDbValue === TRANSACTION_PAYMENT_STATUS.UNPAID || finalIsPaidDbValue === null) ? null : tender_amount_at_checkin ?? null, // $14 tender_amount
    ];

    const res = await client.query(queryText, transactionValues);

    await client.query('COMMIT');

    if (res.rows.length > 0) {
      const newTransactionRow = res.rows[0];
      let rate_name = null;
      if (newTransactionRow.hotel_rate_id) {
        const rateRes = await client.query('SELECT name FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [newTransactionRow.hotel_rate_id, tenantId, branchId]);
        if (rateRes.rows.length > 0) {
          rate_name = rateRes.rows[0].name;
        }
      }

      const newTransaction: Transaction = {
        id: Number(newTransactionRow.id),
        tenant_id: Number(newTransactionRow.tenant_id),
        branch_id: Number(newTransactionRow.branch_id),
        hotel_room_id: newTransactionRow.hotel_room_id ? Number(newTransactionRow.hotel_room_id) : null,
        hotel_rate_id: newTransactionRow.hotel_rate_id ? Number(newTransactionRow.hotel_rate_id) : null,
        client_name: newTransactionRow.client_name,
        client_payment_method: newTransactionRow.client_payment_method,
        notes: newTransactionRow.notes,
        check_in_time: newTransactionRow.check_in_time,
        check_out_time: newTransactionRow.check_out_time,
        hours_used: newTransactionRow.hours_used ? Number(newTransactionRow.hours_used) : null,
        total_amount: newTransactionRow.total_amount ? parseFloat(newTransactionRow.total_amount) : null,
        tender_amount: newTransactionRow.tender_amount ? parseFloat(newTransactionRow.tender_amount) : null,
        is_paid: newTransactionRow.is_paid !== null ? Number(newTransactionRow.is_paid) : null,
        created_by_user_id: Number(newTransactionRow.created_by_user_id),
        check_out_by_user_id: newTransactionRow.check_out_by_user_id ? Number(newTransactionRow.check_out_by_user_id) : null,
        accepted_by_user_id: newTransactionRow.accepted_by_user_id ? Number(newTransactionRow.accepted_by_user_id) : null,
        declined_by_user_id: newTransactionRow.declined_by_user_id ? Number(newTransactionRow.declined_by_user_id) : null,
        status: Number(newTransactionRow.status),
        created_at: newTransactionRow.created_at,
        updated_at: newTransactionRow.updated_at,
        reserved_check_in_datetime: newTransactionRow.reserved_check_in_datetime,
        reserved_check_out_datetime: newTransactionRow.reserved_check_out_datetime,
        is_admin_created: newTransactionRow.is_admin_created !== null ? Number(newTransactionRow.is_admin_created) : null,
        is_accepted: newTransactionRow.is_accepted !== null ? Number(newTransactionRow.is_accepted) : null,
        rate_name: rate_name,
      };
      return {
        success: true,
        message: "Unassigned reservation created successfully.",
        transaction: newTransaction
      };
    }
    // This part should ideally not be reached if RETURNING * worked and transaction was committed
    return { success: false, message: "Reservation creation failed after commit." };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[createUnassignedReservation DB Error]', error);
    const dbError = error as any; // Cast to any to access potential code/constraint
    let detailedMessage = `Database error: ${dbError.message || String(dbError)}`;
    if (dbError.code === '23502' && dbError.column === 'created_by_user_id') { // 23502 is not_null_violation
        detailedMessage = "Database error: User ID for creation is missing or invalid.";
    }
    return { success: false, message: detailedMessage };
  } finally {
    client.release();
  }
}
