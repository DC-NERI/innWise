
"use server";

import pg from 'pg';
// Configure pg to return numeric types as numbers
pg.types.setTypeParser(pg.types.builtins.INT2, (val: string) => parseInt(val, 10));
pg.types.setTypeParser(pg.types.builtins.INT4, (val: string) => parseInt(val, 10));
pg.types.setTypeParser(pg.types.builtins.INT8, (val: string) => parseInt(val, 10)); // bigint
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (val: string) => parseFloat(val));
// Configure pg to return timestamp without timezone as strings
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE

import { Pool, type PoolClient } from 'pg';
import type { Transaction, HotelRoom } from '@/lib/types';
import {
  TRANSACTION_LIFECYCLE_STATUS,
  TRANSACTION_LIFECYCLE_STATUS_TEXT,
  ROOM_AVAILABILITY_STATUS,
  ROOM_AVAILABILITY_STATUS_TEXT,
  TRANSACTION_IS_ACCEPTED_STATUS,
  HOTEL_ENTITY_STATUS,
  ROOM_CLEANING_STATUS,
  ROOM_CLEANING_STATUS_TEXT,
  TRANSACTION_PAYMENT_STATUS
} from '@/lib/constants';
import { logActivity } from '@/actions/activityLogger'; // Adjusted path

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('[assignRoomAndCheckIn Pool Error] Unexpected error on idle client:', err);
});

const SELECT_RESERVATION_FOR_ASSIGNMENT_SQL = `
  SELECT status, is_accepted, client_name, hotel_rate_id, reserved_check_in_datetime, is_paid, tender_amount, total_amount
  FROM transactions
  WHERE id = $1 AND tenant_id = $2 AND branch_id = $3
    AND hotel_room_id IS NULL
  FOR UPDATE;
`;

const ROOM_CHECK_FOR_ASSIGNMENT_SQL = `
  SELECT is_available, cleaning_status, room_name, hotel_rate_id AS room_hotel_rate_ids_json
  FROM hotel_room
  WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND status = $4
  FOR UPDATE;
`;

const LOG_CLEANING_SQL = `
  INSERT INTO room_cleaning_logs (room_id, tenant_id, branch_id, room_cleaning_status, notes, user_id, created_at)
  VALUES ($1, $2, $3, $4, $5, $6, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'))
`;


export async function assignRoomAndCheckIn(
  transactionId: number,
  roomId: number,
  staffUserId: number,
  tenantId: number,
  branchId: number
): Promise<{ success: boolean; message?: string; updatedRoomData?: Partial<HotelRoom> & { id: number }, updatedTransaction?: Transaction }> {

  const EXPECTED_RESERVATION_LIFECYCLE_STATUS_INT = TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM; // 3
  const EXPECTED_IS_ACCEPTED_STATUS_INT = TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED; // 2
  const NEW_TRANSACTION_LIFECYCLE_STATUS_INT = TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN; // 0
  const ROOM_NOW_OCCUPIED_STATUS_INT = ROOM_AVAILABILITY_STATUS.OCCUPIED; // 1
  const ROOM_DEFINITION_ACTIVE_STATUS_STR = HOTEL_ENTITY_STATUS.ACTIVE; // '1'
  const ROOM_CLEANING_STATUS_CLEAN_INT = ROOM_CLEANING_STATUS.CLEAN; // 0
  const ROOM_NEEDS_INSPECTION_STATUS_INT = ROOM_CLEANING_STATUS.INSPECTION; // 2

  if (
    EXPECTED_RESERVATION_LIFECYCLE_STATUS_INT === undefined ||
    EXPECTED_IS_ACCEPTED_STATUS_INT === undefined ||
    NEW_TRANSACTION_LIFECYCLE_STATUS_INT === undefined ||
    ROOM_NOW_OCCUPIED_STATUS_INT === undefined ||
    ROOM_DEFINITION_ACTIVE_STATUS_STR === undefined ||
    ROOM_CLEANING_STATUS_CLEAN_INT === undefined ||
    ROOM_NEEDS_INSPECTION_STATUS_INT === undefined ||
    TRANSACTION_PAYMENT_STATUS?.PAID === undefined ||
    TRANSACTION_PAYMENT_STATUS?.UNPAID === undefined
  ) {
    const errorMessage = "Server configuration error: Critical status constants are missing or undefined in assignRoomAndCheckIn.";
    console.error('[assignRoomAndCheckIn] CRITICAL ERROR:', errorMessage);
    return { success: false, message: errorMessage };
  }

  console.log(`[assignRoomAndCheckIn] Action started. TxID: ${transactionId}, RoomID: ${roomId}, StaffID: ${staffUserId}, TenantID: ${tenantId}, BranchID: ${branchId}`);
  console.log(`[assignRoomAndCheckIn] Expected reservation status: ${EXPECTED_RESERVATION_LIFECYCLE_STATUS_INT}, Expected acceptance: ${EXPECTED_IS_ACCEPTED_STATUS_INT}`);

  if (!transactionId || transactionId <= 0) return { success: false, message: "Invalid Transaction ID." };
  if (!roomId || roomId <= 0) return { success: false, message: "Invalid Room ID." };
  if (!staffUserId || staffUserId <= 0) return { success: false, message: "Invalid Staff User ID." };
  if (!tenantId || tenantId <= 0) return { success: false, message: "Invalid Tenant ID." };
  if (!branchId || branchId <= 0) return { success: false, message: "Invalid Branch ID." };

  let client: PoolClient | undefined;
  let updatedTransactionRow: any = null; // To store the result of the transaction update
  let updatedRoomDbRow: any = null; // To store the result of the room update
  let checkInTimeForReturn: string | null = null;

  try {
    client = await pool.connect();
    console.log(`[assignRoomAndCheckIn] Database client connected for TxID: ${transactionId}.`);
    await client.query('BEGIN');
    console.log(`[assignRoomAndCheckIn] BEGIN transaction for TxID: ${transactionId}`);

    const reservationRes = await client.query(SELECT_RESERVATION_FOR_ASSIGNMENT_SQL, [
      transactionId,
      tenantId,
      branchId,
    ]);
    
    if (reservationRes.rows.length === 0) {
      await client.query('ROLLBACK');
      const debugQuery = 'SELECT id, status, is_accepted, hotel_room_id, branch_id FROM transactions WHERE id = $1 AND tenant_id = $2';
      const debugTxRes = await pool.query(debugQuery, [transactionId, tenantId]); // Use pool for read-only debug after rollback
      const currentTxState = debugTxRes.rows[0];
      const errorMessage = `Reservation (ID: ${transactionId}) not found, already assigned, or not in a valid state for assignment. Current state (if found): Status ${currentTxState?.status}, Accepted ${currentTxState?.is_accepted}, Room ${currentTxState?.hotel_room_id}, Branch ${currentTxState?.branch_id}. Expected status '${EXPECTED_RESERVATION_LIFECYCLE_STATUS_INT}' and accepted '${EXPECTED_IS_ACCEPTED_STATUS_INT}'.`;
      console.warn(`[assignRoomAndCheckIn] ROLLBACK (Pre-check - reservation select): ${errorMessage}`);
      return { success: false, message: errorMessage };
    }

    const reservation = reservationRes.rows[0];
    console.log('[assignRoomAndCheckIn] Found reservation for assignment:', reservation);

    const currentDbStatus = Number(reservation.status);
    const currentDbIsAccepted = Number(reservation.is_accepted);

    if (currentDbStatus !== EXPECTED_RESERVATION_LIFECYCLE_STATUS_INT || currentDbIsAccepted !== EXPECTED_IS_ACCEPTED_STATUS_INT) {
        await client.query('ROLLBACK');
        const errorMessage = `Reservation (ID: ${transactionId}) not in a valid state for assignment. Current status: ${currentDbStatus}, Accepted: ${currentDbIsAccepted}. Expected status '${EXPECTED_RESERVATION_LIFECYCLE_STATUS_INT}' and accepted '${EXPECTED_IS_ACCEPTED_STATUS_INT}'.`;
        console.warn(`[assignRoomAndCheckIn] ROLLBACK (Pre-check - reservation status/acceptance): ${errorMessage}`);
        return { success: false, message: errorMessage };
    }


    const roomRes = await client.query(ROOM_CHECK_FOR_ASSIGNMENT_SQL, [roomId, tenantId, branchId, ROOM_DEFINITION_ACTIVE_STATUS_STR]);

    if (roomRes.rows.length === 0) {
      await client.query('ROLLBACK');
      console.warn(`[assignRoomAndCheckIn] Rollback (Pre-check - room select): Room ID ${roomId} not found or inactive.`);
      return { success: false, message: "Selected room not found or is not active." };
    }
    updatedRoomDbRow = roomRes.rows[0]; // Store initial room details
    console.log('[assignRoomAndCheckIn] Found room for assignment:', updatedRoomDbRow);

    if (Number(updatedRoomDbRow.is_available) !== ROOM_AVAILABILITY_STATUS.AVAILABLE) {
      await client.query('ROLLBACK');
      console.warn(`[assignRoomAndCheckIn] Rollback: Room ID ${roomId} is not available. Current availability: ${updatedRoomDbRow.is_available}`);
      return { success: false, message: `Selected room is not available. Current status: ${ROOM_AVAILABILITY_STATUS_TEXT[Number(updatedRoomDbRow.is_available)]}` };
    }
    if (Number(updatedRoomDbRow.cleaning_status) !== ROOM_CLEANING_STATUS_CLEAN_INT) {
      await client.query('ROLLBACK');
      console.warn(`[assignRoomAndCheckIn] Rollback: Room ID ${roomId} is not clean. Current cleaning status: ${updatedRoomDbRow.cleaning_status}`);
      return { success: false, message: `Selected room is not clean (Current status: ${ROOM_CLEANING_STATUS_TEXT[Number(updatedRoomDbRow.cleaning_status)] || 'Unknown'}). Cannot assign.` };
    }

    const finalIsPaidStatus = Number(reservation.is_paid ?? TRANSACTION_PAYMENT_STATUS.UNPAID);
    const finalTenderAmount = reservation.tender_amount !== null ? parseFloat(String(reservation.tender_amount)) : null;
    
    let ratePrice: number | null = null;
    if (reservation.hotel_rate_id) {
        const rateResDb = await client.query(
            'SELECT price FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND status = $4',
            [reservation.hotel_rate_id, tenantId, branchId, HOTEL_ENTITY_STATUS.ACTIVE]
        );
        if (rateResDb.rows.length > 0) {
            ratePrice = parseFloat(rateResDb.rows[0].price);
        } else {
            await client.query('ROLLBACK');
            console.warn(`[assignRoomAndCheckIn] Rollback: Selected rate ID ${reservation.hotel_rate_id} not found or inactive for reservation TxID ${transactionId}.`);
            return { success: false, message: "Selected rate for reservation not found or inactive. Cannot proceed with check-in." };
        }
    } else {
        await client.query('ROLLBACK');
        console.warn(`[assignRoomAndCheckIn] Rollback: Reservation TxID ${transactionId} does not have an associated rate. Cannot proceed with check-in.`);
        return { success: false, message: "Reservation does not have an associated rate. Cannot proceed with check-in." };
    }
    
    const totalAmountForTransaction = (finalIsPaidStatus === TRANSACTION_PAYMENT_STATUS.PAID || finalIsPaidStatus === TRANSACTION_PAYMENT_STATUS.ADVANCE_PAID) 
        ? ratePrice 
        : (reservation.total_amount !== null ? parseFloat(String(reservation.total_amount)) : null);

    let actualCheckInTimeParam: string | null = null;
    if (reservation.reserved_check_in_datetime) {
      actualCheckInTimeParam = reservation.reserved_check_in_datetime;
    }

    const UPDATE_TRANSACTION_SQL = `
      UPDATE transactions
      SET hotel_room_id = $1,
          status = $2,
          check_in_time = COALESCE($3::TIMESTAMP WITHOUT TIME ZONE, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')),
          is_paid = $4,
          tender_amount = $5,
          total_amount = $6,
          updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $7 AND tenant_id = $8 AND branch_id = $9
      RETURNING *, check_in_time as effective_check_in_time;
    `;

    const transactionUpdateParams = [
      roomId,
      NEW_TRANSACTION_LIFECYCLE_STATUS_INT.toString(),
      actualCheckInTimeParam, 
      finalIsPaidStatus,
      finalTenderAmount,
      totalAmountForTransaction,
      transactionId,
      tenantId,
      branchId,
    ];
    
    console.log('[assignRoomAndCheckIn] Attempting to UPDATE transaction with params:', JSON.stringify(transactionUpdateParams));
    const transactionUpdateResult = await client.query(UPDATE_TRANSACTION_SQL, transactionUpdateParams);

    if (transactionUpdateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      console.warn(`[assignRoomAndCheckIn] Rollback (Transaction Update): Failed to UPDATE transaction details for check-in (TxID: ${transactionId}). Row count 0.`);
      return { success: false, message: "Failed to update transaction details for check-in. Transaction may have been modified." };
    }
    updatedTransactionRow = transactionUpdateResult.rows[0];
    checkInTimeForReturn = updatedTransactionRow.effective_check_in_time; 
    console.log(`[assignRoomAndCheckIn] Transaction TxID ${transactionId} updated for check-in. Effective check-in time: ${checkInTimeForReturn}`);

    const UPDATE_ROOM_SQL = `
      UPDATE hotel_room
      SET is_available = $1,
          transaction_id = $2,
          cleaning_status = $3,
          cleaning_notes = $4,
          updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $5 AND tenant_id = $6 AND branch_id = $7
      RETURNING id, is_available, transaction_id, cleaning_status, hotel_rate_id AS room_hotel_rate_ids_json, room_name, room_code, cleaning_notes;
    `;
    const roomUpdateResult = await client.query(UPDATE_ROOM_SQL, [
      ROOM_NOW_OCCUPIED_STATUS_INT,
      transactionId,
      ROOM_NEEDS_INSPECTION_STATUS_INT,
      `Checked-in guest: ${updatedTransactionRow.client_name}. Room set to '${ROOM_CLEANING_STATUS_TEXT[ROOM_NEEDS_INSPECTION_STATUS_INT]}'.`,
      roomId,
      tenantId,
      branchId
    ]);

    if (roomUpdateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      console.warn(`[assignRoomAndCheckIn] Rollback (Room Update): Failed to UPDATE room status for RoomID ${roomId}.`);
      return { success: false, message: "Failed to update room status." };
    }
    updatedRoomDbRow = roomUpdateResult.rows[0]; // Re-assign with updated room details
    console.log(`[assignRoomAndCheckIn] RoomID ${roomId} status updated.`);

    await client.query(LOG_CLEANING_SQL, [
      roomId,
      tenantId,
      branchId,
      ROOM_NEEDS_INSPECTION_STATUS_INT,
      `Room set to '${ROOM_CLEANING_STATUS_TEXT[ROOM_NEEDS_INSPECTION_STATUS_INT]}' after guest ${updatedTransactionRow.client_name} checked in via reservation assignment.`,
      staffUserId
    ]);
    console.log(`[assignRoomAndCheckIn] Cleaning log created for RoomID ${roomId}.`);

    console.log(`[assignRoomAndCheckIn] Attempting to COMMIT transaction for TxID: ${transactionId}.`);
    await client.query('COMMIT');
    console.log(`[assignRoomAndCheckIn] Transaction COMMITTED successfully for TxID: ${transactionId}.`);

  } catch (error) {
    if (client) {
      try {
        console.warn(`[assignRoomAndCheckIn] Error occurred. Attempting to ROLLBACK for TxID: ${transactionId}`, error);
        await client.query('ROLLBACK');
        console.warn(`[assignRoomAndCheckIn] Transaction ROLLED BACK for TxID: ${transactionId} due to error.`);
      } catch (rbError) {
        console.error(`[assignRoomAndCheckIn] Error during rollback for TxID: ${transactionId}:`, rbError);
      }
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[assignRoomAndCheckIn DB Full Error]', error);
    return { success: false, message: `Database error during room assignment and check-in: ${errorMessage}` };
  } finally {
    if (client) {
      client.release();
      console.log(`[assignRoomAndCheckIn] Client released for TxID: ${transactionId}`);
    }
  }

  // Post-commit operations (fetch rate name, log activity)
  let rateNameFromDb: string | null = null;
  let rateHoursFromDb: number | null = null;
  let rateExcessHourPriceFromDb: number | null = null;
  let fetchedRatePrice: number | null = null;

  if (updatedTransactionRow && updatedTransactionRow.hotel_rate_id) {
    try {
      const rateClient = await pool.connect();
      const rateNameRes = await rateClient.query(
        'SELECT name, hours, excess_hour_price, price FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3',
        [updatedTransactionRow.hotel_rate_id, tenantId, branchId]
      );
      if (rateNameRes.rows.length > 0) {
          rateNameFromDb = rateNameRes.rows[0].name;
          rateHoursFromDb = rateNameRes.rows[0].hours ? parseInt(String(rateNameRes.rows[0].hours), 10) : null;
          rateExcessHourPriceFromDb = rateNameRes.rows[0].excess_hour_price ? parseFloat(String(rateNameRes.rows[0].excess_hour_price)) : null;
          fetchedRatePrice = rateNameRes.rows[0].price ? parseFloat(String(rateNameRes.rows[0].price)) : null;
      }
      rateClient.release();
    } catch(rateError) {
      console.error(`[assignRoomAndCheckIn] Error fetching rate details post-commit for TxID ${transactionId}:`, rateError);
    }
  }

  try {
    await logActivity({
      tenant_id: tenantId,
      branch_id: branchId,
      actor_user_id: staffUserId,
      action_type: 'STAFF_ASSIGNED_ROOM_AND_CHECKED_IN',
      description: `Staff (ID: ${staffUserId}) assigned room '${updatedRoomDbRow.room_name}' (${updatedRoomDbRow.room_code}) to client '${updatedTransactionRow.client_name}' (Tx ID: ${transactionId}) and checked them in from reservation. Rate: ${rateNameFromDb || 'N/A'}.`,
      target_entity_type: 'Transaction',
      target_entity_id: transactionId.toString(),
      details: {
        client_name: updatedTransactionRow.client_name,
        room_id: roomId,
        room_name: updatedRoomDbRow.room_name,
        rate_id: updatedTransactionRow.hotel_rate_id,
        rate_name: rateNameFromDb,
        new_transaction_status: NEW_TRANSACTION_LIFECYCLE_STATUS_INT,
        new_room_availability_status: ROOM_NOW_OCCUPIED_STATUS_INT,
        new_room_cleaning_status: ROOM_NEEDS_INSPECTION_STATUS_INT,
        checked_in_staff_id: staffUserId
      }
    });
    console.log(`[assignRoomAndCheckIn] Activity logged post-commit for TxID ${transactionId}.`);
  } catch (logError) {
      console.error(`[assignRoomAndCheckIn] Failed to log activity post-commit for TxID ${transactionId}:`, logError);
  }
  
  let parsedRoomRateIds: number[] = [];
  try {
      const rawRateIdJson = updatedRoomDbRow.room_hotel_rate_ids_json;
      if (rawRateIdJson) {
          if (Array.isArray(rawRateIdJson)) {
              parsedRoomRateIds = rawRateIdJson.map((id: any) => Number(id));
          } else if (typeof rawRateIdJson === 'string') {
              const parsed = JSON.parse(rawRateIdJson);
              if (Array.isArray(parsed)) {
                  parsedRoomRateIds = parsed.map((id: any) => Number(id));
              }
          }
      }
  } catch (e) {
      console.error(`[assignRoomAndCheckIn] Failed to parse room_hotel_rate_ids_json for room ${roomId}: ${updatedRoomDbRow.room_hotel_rate_ids_json}`, e);
  }

  const finalUpdatedTransaction: Transaction = {
    id: Number(updatedTransactionRow.id),
    tenant_id: Number(updatedTransactionRow.tenant_id),
    branch_id: Number(updatedTransactionRow.branch_id),
    hotel_room_id: updatedTransactionRow.hotel_room_id ? Number(updatedTransactionRow.hotel_room_id) : null,
    hotel_rate_id: updatedTransactionRow.hotel_rate_id ? Number(updatedTransactionRow.hotel_rate_id) : null,
    client_name: String(updatedTransactionRow.client_name),
    client_payment_method: updatedTransactionRow.client_payment_method,
    notes: updatedTransactionRow.notes,
    check_in_time: String(checkInTimeForReturn),
    check_out_time: updatedTransactionRow.check_out_time ? String(updatedTransactionRow.check_out_time) : null,
    hours_used: updatedTransactionRow.hours_used ? Number(updatedTransactionRow.hours_used) : null,
    total_amount: updatedTransactionRow.total_amount !== null ? parseFloat(String(updatedTransactionRow.total_amount)) : null,
    tender_amount: updatedTransactionRow.tender_amount !== null ? parseFloat(String(updatedTransactionRow.tender_amount)) : null,
    is_paid: Number(updatedTransactionRow.is_paid),
    created_by_user_id: Number(updatedTransactionRow.created_by_user_id),
    check_out_by_user_id: updatedTransactionRow.check_out_by_user_id ? Number(updatedTransactionRow.check_out_by_user_id) : null,
    accepted_by_user_id: updatedTransactionRow.accepted_by_user_id ? Number(updatedTransactionRow.accepted_by_user_id) : null,
    declined_by_user_id: updatedTransactionRow.declined_by_user_id ? Number(updatedTransactionRow.declined_by_user_id) : null,
    status: Number(updatedTransactionRow.status),
    created_at: String(updatedTransactionRow.created_at),
    updated_at: String(updatedTransactionRow.updated_at),
    reserved_check_in_datetime: updatedTransactionRow.reserved_check_in_datetime ? String(updatedTransactionRow.reserved_check_in_datetime) : null,
    reserved_check_out_datetime: updatedTransactionRow.reserved_check_out_datetime ? String(updatedTransactionRow.reserved_check_out_datetime) : null,
    is_admin_created: updatedTransactionRow.is_admin_created !== null ? Number(updatedTransactionRow.is_admin_created) : null,
    is_accepted: Number(updatedTransactionRow.is_accepted),
    rate_name: rateNameFromDb,
    room_name: updatedRoomDbRow.room_name,
    rate__price: fetchedRatePrice,
    rate_hours: rateHoursFromDb,
    rate_excess_hour_price: rateExcessHourPriceFromDb,
  };

  const updatedRoomDataForClient: Partial<HotelRoom> & { id: number } = {
    id: roomId,
    is_available: ROOM_NOW_OCCUPIED_STATUS_INT,
    transaction_id: transactionId,
    active_transaction_id: transactionId,
    active_transaction_client_name: finalUpdatedTransaction.client_name,
    active_transaction_check_in_time: finalUpdatedTransaction.check_in_time,
    active_transaction_rate_name: finalUpdatedTransaction.rate_name,
    active_transaction_rate_hours: finalUpdatedTransaction.rate_hours,
    active_transaction_lifecycle_status: finalUpdatedTransaction.status,
    cleaning_status: Number(updatedRoomDbRow.cleaning_status),
    cleaning_notes: updatedRoomDbRow.cleaning_notes,
    hotel_rate_id: parsedRoomRateIds,
  };

  return {
    success: true,
    message: `Room '${updatedRoomDbRow.room_name}' assigned and client '${updatedTransactionRow.client_name}' checked in. Room set to ${ROOM_CLEANING_STATUS_TEXT[ROOM_NEEDS_INSPECTION_STATUS_INT]}.`,
    updatedRoomData: updatedRoomDataForClient,
    updatedTransaction: finalUpdatedTransaction,
  };
}

    