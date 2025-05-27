
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

const CREATE_UNASSIGNED_RESERVATION_QUERY = `
  INSERT INTO transactions (
    tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name,
    client_payment_method, notes, 
    created_by_user_id, status, created_at, updated_at,
    reserved_check_in_datetime, reserved_check_out_datetime,
    is_admin_created, is_accepted, is_paid, tender_amount
  )
  VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), $9, $10, $11, $12, $13, $14)
  RETURNING *;
`;


export async function createUnassignedReservation(
  data: TransactionCreateData,
  tenantId: number,
  branchId: number,
  actorUserId: number, // Renamed from staffUserId for clarity, can be admin or staff
  is_admin_created_flag: boolean = false
): Promise<{ success: boolean; message?: string; transaction?: Transaction }> {

  if (!actorUserId || actorUserId <= 0) {
    console.error("[createUnassignedReservation] Invalid actorUserId:", actorUserId);
    return { success: false, message: "Invalid user identifier for creating reservation." };
  }
  if (!tenantId || tenantId <= 0) {
    console.error("[createUnassignedReservation] Invalid tenantId:", tenantId);
    return { success: false, message: "Invalid tenant identifier." };
  }
   if (!branchId || branchId <= 0) {
    console.error("[createUnassignedReservation] Invalid branchId:", branchId);
    return { success: false, message: "Invalid branch identifier." };
  }


  const criticalConstantsCheck = {
    PENDING_BRANCH_ACCEPTANCE: TRANSACTION_LIFECYCLE_STATUS?.PENDING_BRANCH_ACCEPTANCE,
    RESERVATION_NO_ROOM: TRANSACTION_LIFECYCLE_STATUS?.RESERVATION_NO_ROOM,
    RESERVATION_WITH_ROOM: TRANSACTION_LIFECYCLE_STATUS?.RESERVATION_WITH_ROOM,
    PAID: TRANSACTION_PAYMENT_STATUS?.PAID,
    UNPAID: TRANSACTION_PAYMENT_STATUS?.UNPAID,
    PENDING_ACCEPTANCE: TRANSACTION_IS_ACCEPTED_STATUS?.PENDING,
    ACCEPTED: TRANSACTION_IS_ACCEPTED_STATUS?.ACCEPTED,
  };

  let missingConstant = "";
  if (is_admin_created_flag && criticalConstantsCheck.PENDING_BRANCH_ACCEPTANCE === undefined) missingConstant = "PENDING_BRANCH_ACCEPTANCE";
  else if (!is_admin_created_flag && criticalConstantsCheck.RESERVATION_NO_ROOM === undefined) missingConstant = "RESERVATION_NO_ROOM";
  // RESERVATION_WITH_ROOM is not directly used for unassigned, but good to have if logic changes
  if (criticalConstantsCheck.PAID === undefined) missingConstant = "PAID (PaymentStatus)";
  if (criticalConstantsCheck.UNPAID === undefined) missingConstant = "UNPAID (PaymentStatus)";
  if (is_admin_created_flag && criticalConstantsCheck.PENDING_ACCEPTANCE === undefined) missingConstant = "PENDING (IsAcceptedStatus)";
  else if (!is_admin_created_flag && criticalConstantsCheck.ACCEPTED === undefined) missingConstant = "ACCEPTED (IsAcceptedStatus)";


  if (missingConstant) {
    const errorMessage = `Server configuration error: Critical status constant '${missingConstant}' is missing or undefined.`;
    console.error('[createUnassignedReservation] CRITICAL ERROR:', errorMessage, criticalConstantsCheck);
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
      transactionLifecycleStatusValue = TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE;
      finalIsAcceptedStatusValue = TRANSACTION_IS_ACCEPTED_STATUS.PENDING;
    } else {
      transactionLifecycleStatusValue = TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM;
      finalIsAcceptedStatusValue = TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED;
    }
    
    const finalIsPaidDbValue = is_paid ?? TRANSACTION_PAYMENT_STATUS.UNPAID;
    const finalTenderAmount = (finalIsPaidDbValue === TRANSACTION_PAYMENT_STATUS.UNPAID || finalIsPaidDbValue === null) ? null : tender_amount_at_checkin;

    const transactionValues = [
      tenantId,
      branchId,
      selected_rate_id ?? null,
      client_name,
      client_payment_method ?? null,
      notes ?? null,
      actorUserId,
      transactionLifecycleStatusValue.toString(),
      is_advance_reservation ? reserved_check_in_datetime : null,
      is_advance_reservation ? reserved_check_out_datetime : null,
      is_admin_created_flag ? 1 : 0,
      finalIsAcceptedStatusValue,
      finalIsPaidDbValue,
      finalTenderAmount,
    ];

    const res = await client.query(CREATE_UNASSIGNED_RESERVATION_QUERY, transactionValues);
    await client.query('COMMIT');

    if (res.rows.length > 0) {
      const newTransactionRow = res.rows[0];
      let rate_name = null;
      let rate_price = null;
      let rate_hours = null;
      let rate_excess_hour_price = null;

      if (newTransactionRow.hotel_rate_id) {
        // Use a new connection or the same client if preferred, for fetching rate details
        const rateRes = await pool.query('SELECT name, price, hours, excess_hour_price FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [newTransactionRow.hotel_rate_id, tenantId, branchId]);
        if (rateRes.rows.length > 0) {
          rate_name = rateRes.rows[0].name;
          rate_price = parseFloat(rateRes.rows[0].price);
          rate_hours = parseInt(rateRes.rows[0].hours, 10);
          rate_excess_hour_price = rateRes.rows[0].excess_hour_price ? parseFloat(rateRes.rows[0].excess_hour_price) : null;
        }
      }

      const newTransaction: Transaction = {
        id: Number(newTransactionRow.id),
        tenant_id: Number(newTransactionRow.tenant_id),
        branch_id: Number(newTransactionRow.branch_id),
        hotel_room_id: newTransactionRow.hotel_room_id ? Number(newTransactionRow.hotel_room_id) : null,
        hotel_rate_id: newTransactionRow.hotel_rate_id ? Number(newTransactionRow.hotel_rate_id) : null,
        client_name: String(newTransactionRow.client_name),
        client_payment_method: newTransactionRow.client_payment_method,
        notes: newTransactionRow.notes,
        check_in_time: String(newTransactionRow.check_in_time), // this is creation time here
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
        rate_name: rate_name,
        rate_price: rate_price,
        rate_hours: rate_hours,
        rate_excess_hour_price: rate_excess_hour_price,
      };
      return {
        success: true,
        message: "Unassigned reservation created successfully.",
        transaction: newTransaction
      };
    }
    return { success: false, message: "Reservation creation failed after commit." };
  } catch (error: any) {
    if (client) {
        try { await client.query('ROLLBACK'); } catch (rbError) { console.error('[createUnassignedReservation] Error during rollback:', rbError); }
    }
    console.error('[createUnassignedReservation DB Error]', error);
    let detailedMessage = `Database error: ${error.message || String(error)}`;
    if (error.code === '23502' && error.column === 'created_by_user_id') {
        detailedMessage = "Database error: User ID for creation is missing or invalid.";
    }
    return { success: false, message: detailedMessage };
  } finally {
    if (client) {
        client.release();
    }
  }
}
