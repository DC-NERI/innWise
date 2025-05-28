
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

import { Pool } from 'pg';
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
  TRANSACTION_PAYMENT_STATUS // Added missing import
} from '../../../lib/constants';
import { logActivity } from '../../activityLogger';

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
    AND status::INTEGER = $4
    AND is_accepted = $5
  FOR UPDATE;
`;

const ROOM_CHECK_FOR_ASSIGNMENT_SQL = `
  SELECT is_available, cleaning_status, room_name
  FROM hotel_room
  WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND status = $4
  FOR UPDATE;
`;

const UPDATE_TRANSACTION_FOR_ASSIGNMENT_SQL = `
  UPDATE transactions
  SET hotel_room_id = $1,
      status = $2,
      check_in_time = $3,
      is_paid = $4,
      tender_amount = $5,
      total_amount = $6,
      updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
  WHERE id = $7 AND tenant_id = $8 AND branch_id = $9
  RETURNING *, check_in_time as effective_check_in_time;
`;

const UPDATE_ROOM_FOR_ASSIGNMENT_SQL = `
  UPDATE hotel_room
  SET is_available = $1,
      transaction_id = $2,
      cleaning_status = $3,
      cleaning_notes = $4,
      updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
  WHERE id = $5 AND tenant_id = $6 AND branch_id = $7
  RETURNING id, is_available, transaction_id, cleaning_status, hotel_rate_id, room_name, room_code, cleaning_notes;
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

  const EXPECTED_RESERVATION_LIFECYCLE_STATUS_INT = TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM;
  const EXPECTED_IS_ACCEPTED_STATUS_INT = TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED;
  const NEW_TRANSACTION_LIFECYCLE_STATUS_INT = TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN;
  const ROOM_NOW_OCCUPIED_STATUS_INT = ROOM_AVAILABILITY_STATUS.OCCUPIED;
  const ROOM_DEFINITION_ACTIVE_STATUS_STR = HOTEL_ENTITY_STATUS.ACTIVE;
  const ROOM_CLEANING_STATUS_CLEAN_INT = ROOM_CLEANING_STATUS.CLEAN;
  const ROOM_NEEDS_INSPECTION_STATUS_INT = ROOM_CLEANING_STATUS.INSPECTION;

  if (
    EXPECTED_RESERVATION_LIFECYCLE_STATUS_INT === undefined ||
    EXPECTED_IS_ACCEPTED_STATUS_INT === undefined ||
    NEW_TRANSACTION_LIFECYCLE_STATUS_INT === undefined ||
    ROOM_NOW_OCCUPIED_STATUS_INT === undefined ||
    ROOM_DEFINITION_ACTIVE_STATUS_STR === undefined ||
    ROOM_CLEANING_STATUS_CLEAN_INT === undefined ||
    ROOM_NEEDS_INSPECTION_STATUS_INT === undefined ||
    TRANSACTION_PAYMENT_STATUS?.PAID === undefined || // Added check for TRANSACTION_PAYMENT_STATUS
    TRANSACTION_PAYMENT_STATUS?.UNPAID === undefined
  ) {
    const errorMessage = "Server configuration error: Critical status constants are missing or undefined in assignRoomAndCheckIn.";
    console.error('[assignRoomAndCheckIn] CRITICAL ERROR:', errorMessage);
    return { success: false, message: errorMessage };
  }

  if (!transactionId || transactionId <= 0) return { success: false, message: "Invalid Transaction ID." };
  if (!roomId || roomId <= 0) return { success: false, message: "Invalid Room ID." };
  if (!staffUserId || staffUserId <= 0) return { success: false, message: "Invalid Staff User ID." };
  if (!tenantId || tenantId <= 0) return { success: false, message: "Invalid Tenant ID." };
  if (!branchId || branchId <= 0) return { success: false, message: "Invalid Branch ID." };

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    // Log received parameters
    console.log(`[assignRoomAndCheckIn] Action started. TxID: ${transactionId}, RoomID: ${roomId}, StaffID: ${staffUserId}, TenantID: ${tenantId}, BranchID: ${branchId}`);
    console.log(`[assignRoomAndCheckIn] Expected reservation status: ${EXPECTED_RESERVATION_LIFECYCLE_STATUS_INT}, Expected acceptance: ${EXPECTED_IS_ACCEPTED_STATUS_INT}`);

    const reservationRes = await client.query(SELECT_RESERVATION_FOR_ASSIGNMENT_SQL, [
      transactionId,
      tenantId,
      branchId,
      EXPECTED_RESERVATION_LIFECYCLE_STATUS_INT, // This should be 3
      EXPECTED_IS_ACCEPTED_STATUS_INT // This should be 2
    ]);

    if (reservationRes.rows.length === 0) {
      await client.query('ROLLBACK');
      // Query current state for debugging
      const debugTxRes = await client.query('SELECT id, status, is_accepted, hotel_room_id, branch_id FROM transactions WHERE id = $1 AND tenant_id = $2', [transactionId, tenantId]);
      const currentTxState = debugTxRes.rows[0];
      const errorMessage = `Reservation (ID: ${transactionId}) not found, already assigned, or not in a valid state for assignment. Current state (if found): Status ${currentTxState?.status}, Accepted ${currentTxState?.is_accepted}, Room ${currentTxState?.hotel_room_id}, Branch ${currentTxState?.branch_id}. Expected status '${EXPECTED_RESERVATION_LIFECYCLE_STATUS_INT}' and accepted '${EXPECTED_IS_ACCEPTED_STATUS_INT}'.`;
      console.warn(`[assignRoomAndCheckIn] ROLLBACK (Pre-check): ${errorMessage}`);
      return { success: false, message: errorMessage };
    }
    const reservation = reservationRes.rows[0];
    console.log('[assignRoomAndCheckIn] Found reservation for assignment:', reservation);

    const roomRes = await client.query(ROOM_CHECK_FOR_ASSIGNMENT_SQL, [roomId, tenantId, branchId, ROOM_DEFINITION_ACTIVE_STATUS_STR]);

    if (roomRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Selected room not found or is not active." };
    }
    const room = roomRes.rows[0];
    console.log('[assignRoomAndCheckIn] Found room for assignment:', room);

    if (Number(room.is_available) !== ROOM_AVAILABILITY_STATUS.AVAILABLE) {
      await client.query('ROLLBACK');
      return { success: false, message: `Selected room is not available. Current status: ${ROOM_AVAILABILITY_STATUS_TEXT[Number(room.is_available)]}` };
    }
    if (Number(room.cleaning_status) !== ROOM_CLEANING_STATUS_CLEAN_INT) {
      await client.query('ROLLBACK');
      return { success: false, message: `Selected room is not clean (Current status: ${ROOM_CLEANING_STATUS_TEXT[Number(room.cleaning_status)] || 'Unknown'}). Cannot assign.` };
    }

    let actualCheckInTime: string;
    let checkInQueryPart: string;
    let checkInTimeForReturn: string;

    if (reservation.reserved_check_in_datetime) {
        actualCheckInTime = reservation.reserved_check_in_datetime;
        checkInQueryPart = `check_in_time = $1`;
    } else {
        actualCheckInTime = `(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')`; // This is an SQL expression string
        checkInQueryPart = `check_in_time = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')`;
    }

    let ratePrice: number | null = null;
    if (reservation.hotel_rate_id) {
        const rateRes = await client.query(
            'SELECT price FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND status = $4',
            [reservation.hotel_rate_id, tenantId, branchId, HOTEL_ENTITY_STATUS.ACTIVE]
        );
        if (rateRes.rows.length > 0) {
            ratePrice = parseFloat(rateRes.rows[0].price);
        } else {
            await client.query('ROLLBACK');
            return { success: false, message: "Selected rate for reservation not found or inactive. Cannot proceed with check-in." };
        }
    } else {
        await client.query('ROLLBACK');
        return { success: false, message: "Reservation does not have an associated rate. Cannot proceed with check-in." };
    }

    // totalAmountForTransaction can use existing total_amount if it's already paid (status 2)
    // or use ratePrice if it's just a reservation (status 3/4).
    // is_paid and tender_amount from reservation should be honored.
    const finalIsPaidStatus = Number(reservation.is_paid);
    const finalTenderAmount = reservation.tender_amount !== null ? parseFloat(reservation.tender_amount) : null;
    const totalAmountForTransaction = reservation.total_amount !== null ? parseFloat(reservation.total_amount) : ratePrice;


    const updateTransactionParams: any[] = [
      roomId,
      NEW_TRANSACTION_LIFECYCLE_STATUS_INT.toString(), // '0' for CHECKED_IN
      // For check_in_time, if we used an SQL expression, it's handled in checkInQueryPart
      // If actualCheckInTime is a date string, it's pushed next
    ];
    if (reservation.reserved_check_in_datetime) {
        updateTransactionParams.push(actualCheckInTime); // The date string
    }
    // Add remaining params, adjusting indices based on whether actualCheckInTime was pushed
    let paramIndexOffset = reservation.reserved_check_in_datetime ? 1 : 0;
    updateTransactionParams.push(
        finalIsPaidStatus,                                    // is_paid
        finalTenderAmount,                                    // tender_amount
        totalAmountForTransaction,                            // total_amount
        transactionId,
        tenantId,
        branchId
    );

    const updateTransactionQueryFinal = `
      UPDATE transactions
      SET hotel_room_id = $1,
          status = $2,
          ${checkInQueryPart.replace('$1', `$${3 + paramIndexOffset}`)},
          is_paid = $${4 + paramIndexOffset},
          tender_amount = $${5 + paramIndexOffset},
          total_amount = $${6 + paramIndexOffset},
          updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $${7 + paramIndexOffset} AND tenant_id = $${8 + paramIndexOffset} AND branch_id = $${9 + paramIndexOffset}
      RETURNING *, check_in_time as effective_check_in_time;
    `;

    console.log('[assignRoomAndCheckIn] Update Tx Query:', updateTransactionQueryFinal);
    console.log('[assignRoomAndCheckIn] Update Tx Params:', updateTransactionParams);

    const transactionUpdateResult = await client.query(updateTransactionQueryFinal, updateTransactionParams);

    if (transactionUpdateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update transaction details for check-in." };
    }
    const updatedTransactionRow = transactionUpdateResult.rows[0];
    checkInTimeForReturn = updatedTransactionRow.effective_check_in_time; // This comes directly from RETURNING

    const roomUpdateResult = await client.query(UPDATE_ROOM_FOR_ASSIGNMENT_SQL, [
      ROOM_NOW_OCCUPIED_STATUS_INT,
      transactionId,
      ROOM_NEEDS_INSPECTION_STATUS_INT,
      `Checked-in guest: ${updatedTransactionRow.client_name}. Room needs post-stay inspection.`,
      roomId,
      tenantId,
      branchId
    ]);

    if (roomUpdateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update room status." };
    }
    const updatedRoomDbRow = roomUpdateResult.rows[0];

    await client.query(LOG_CLEANING_SQL, [
      roomId,
      tenantId,
      branchId,
      ROOM_NEEDS_INSPECTION_STATUS_INT,
      `Room set to '${ROOM_CLEANING_STATUS_TEXT[ROOM_NEEDS_INSPECTION_STATUS_INT]}' after guest ${updatedTransactionRow.client_name} checked in.`,
      staffUserId
    ]);

    let rateNameFromDb: string | null = null;
    let rateHoursFromDb: number | null = null;
    let rateExcessHourPriceFromDb: number | null = null;

    if (updatedTransactionRow.hotel_rate_id) {
      const rateNameRes = await client.query(
        'SELECT name, hours, excess_hour_price FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3',
        [updatedTransactionRow.hotel_rate_id, tenantId, branchId]
      );
      if (rateNameRes.rows.length > 0) {
          rateNameFromDb = rateNameRes.rows[0].name;
          rateHoursFromDb = rateNameRes.rows[0].hours ? parseInt(rateNameRes.rows[0].hours, 10) : null;
          rateExcessHourPriceFromDb = rateNameRes.rows[0].excess_hour_price ? parseFloat(rateNameRes.rows[0].excess_hour_price) : null;
      }
    }

    await logActivity({
      tenant_id: tenantId,
      branch_id: branchId,
      actor_user_id: staffUserId,
      action_type: 'STAFF_ASSIGNED_ROOM_AND_CHECKED_IN',
      description: `Staff (ID: ${staffUserId}) assigned room '${updatedRoomDbRow.room_name}' (${updatedRoomDbRow.room_code}) to client '${updatedTransactionRow.client_name}' (Tx ID: ${transactionId}) and checked them in. Rate: ${rateNameFromDb || 'N/A'}.`,
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
    }, client);

    await client.query('COMMIT');

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
      total_amount: updatedTransactionRow.total_amount ? parseFloat(updatedTransactionRow.total_amount) : null,
      tender_amount: updatedTransactionRow.tender_amount !== null ? parseFloat(updatedTransactionRow.tender_amount) : null,
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
      rate_price: ratePrice,
      rate_hours: rateHoursFromDb,
      rate_excess_hour_price: rateExcessHourPriceFromDb,
    };

    const updatedRoomData: Partial<HotelRoom> & { id: number } = {
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
      hotel_rate_id: Array.isArray(updatedRoomDbRow.hotel_rate_id)
        ? updatedRoomDbRow.hotel_rate_id.map((id: any) => Number(id))
        : (updatedRoomDbRow.hotel_rate_id ? [Number(updatedRoomDbRow.hotel_rate_id)] : []),
    };

    return {
      success: true,
      message: `Room '${updatedRoomDbRow.room_name}' assigned and client '${updatedTransactionRow.client_name}' checked in. Room set to ${ROOM_CLEANING_STATUS_TEXT[ROOM_NEEDS_INSPECTION_STATUS_INT]}.`,
      updatedRoomData,
      updatedTransaction: finalUpdatedTransaction,
    };

  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
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
    }
  }
}

    
    