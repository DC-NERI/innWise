
"use server";

import pg from 'pg';
// Configure pg to return numeric types as numbers instead of strings
pg.types.setTypeParser(pg.types.builtins.INT2, (val: string) => parseInt(val, 10));
pg.types.setTypeParser(pg.types.builtins.INT4, (val: string) => parseInt(val, 10));
pg.types.setTypeParser(pg.types.builtins.INT8, (val: string) => parseInt(val, 10)); // bigint
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (val: string) => parseFloat(val));
// Configure pg to return timestamp without timezone as strings
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (stringValue: string) => stringValue);
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (stringValue: string) => stringValue);


import { Pool } from 'pg';
import type { Transaction, HotelRoom } from '@/lib/types';
import {
  TRANSACTION_LIFECYCLE_STATUS,
  ROOM_AVAILABILITY_STATUS,
  TRANSACTION_IS_ACCEPTED_STATUS,
  HOTEL_ENTITY_STATUS,
  ROOM_CLEANING_STATUS, // Added import
  ROOM_CLEANING_STATUS_TEXT // Added import for logging if needed
} from '../../../lib/constants';
import { logActivity } from '../../activityLogger';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('[assignRoomAndCheckIn Pool Error] Unexpected error on idle client:', err);
});

export async function assignRoomAndCheckIn(
  transactionId: number,
  roomId: number,
  staffUserId: number,
  tenantId: number,
  branchId: number
): Promise<{ success: boolean; message?: string; updatedRoomData?: Partial<HotelRoom> & { id: number }, updatedTransaction?: Transaction }> {
  // console.log(`[assignRoomAndCheckIn] Action started. TxID: ${transactionId}, RoomID: ${roomId}, StaffID: ${staffUserId}, TenantID: ${tenantId}, BranchID: ${branchId}`);

  // Critical constants check
  const EXPECTED_RESERVATION_STATUS = TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM;
  const EXPECTED_IS_ACCEPTED_STATUS = TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED;
  const NEW_TRANSACTION_LIFECYCLE_STATUS = TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN;
  const ROOM_NOW_OCCUPIED_STATUS = ROOM_AVAILABILITY_STATUS.OCCUPIED;
  const ROOM_DEFINITION_ACTIVE_STATUS = HOTEL_ENTITY_STATUS.ACTIVE;
  const ROOM_NEEDS_INSPECTION_STATUS = ROOM_CLEANING_STATUS.INSPECTION; // Added for clarity

  if (
    EXPECTED_RESERVATION_STATUS === undefined ||
    EXPECTED_IS_ACCEPTED_STATUS === undefined ||
    NEW_TRANSACTION_LIFECYCLE_STATUS === undefined ||
    ROOM_NOW_OCCUPIED_STATUS === undefined ||
    ROOM_DEFINITION_ACTIVE_STATUS === undefined ||
    ROOM_NEEDS_INSPECTION_STATUS === undefined // Check new constant
  ) {
    const errorMessage = "Server configuration error: Critical status constants are missing or undefined in assignRoomAndCheckIn.";
    console.error('[assignRoomAndCheckIn] CRITICAL ERROR:', errorMessage, {
        EXPECTED_RESERVATION_STATUS,
        EXPECTED_IS_ACCEPTED_STATUS,
        NEW_TRANSACTION_LIFECYCLE_STATUS,
        ROOM_NOW_OCCUPIED_STATUS,
        ROOM_DEFINITION_ACTIVE_STATUS,
        ROOM_NEEDS_INSPECTION_STATUS
    });
    return { success: false, message: errorMessage };
  }
  // console.log(`[assignRoomAndCheckIn] Expected Tx Status: ${EXPECTED_RESERVATION_STATUS}, Expected Is Accepted: ${EXPECTED_IS_ACCEPTED_STATUS}`);


  if (!transactionId || transactionId <= 0) return { success: false, message: "Invalid Transaction ID." };
  if (!roomId || roomId <= 0) return { success: false, message: "Invalid Room ID." };
  if (!staffUserId || staffUserId <= 0) return { success: false, message: "Invalid Staff User ID." };
  if (!tenantId || tenantId <= 0) return { success: false, message: "Invalid Tenant ID." };
  if (!branchId || branchId <= 0) return { success: false, message: "Invalid Branch ID." };


  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // console.log(`[assignRoomAndCheckIn] BEGIN transaction for TxID: ${transactionId}`);

    // Pre-check the reservation
    const SELECT_RESERVATION_SQL = `
      SELECT status, is_accepted, client_name, hotel_rate_id, reserved_check_in_datetime, is_paid
      FROM transactions
      WHERE id = $1 AND tenant_id = $2 AND branch_id = $3
        AND hotel_room_id IS NULL
        AND status::INTEGER = $4
        AND is_accepted = $5
      FOR UPDATE;
    `;
    // console.log(`[assignRoomAndCheckIn] Executing SELECT_RESERVATION_SQL with params: [${transactionId}, ${tenantId}, ${branchId}, ${EXPECTED_RESERVATION_STATUS}, ${EXPECTED_IS_ACCEPTED_STATUS}]`);

    const reservationRes = await client.query(SELECT_RESERVATION_SQL, [
      transactionId,
      tenantId,
      branchId,
      EXPECTED_RESERVATION_STATUS,
      EXPECTED_IS_ACCEPTED_STATUS
    ]);

    if (reservationRes.rows.length === 0) {
      await client.query('ROLLBACK');
      const debugTxRes = await client.query('SELECT id, status, is_accepted, hotel_room_id, branch_id FROM transactions WHERE id = $1 AND tenant_id = $2', [transactionId, tenantId]);
      // console.warn(`[assignRoomAndCheckIn] Debug - Transaction ${transactionId} current state: `, debugTxRes.rows[0]);
      // console.warn(`[assignRoomAndCheckIn] ROLLBACK (PRE_CHECK): Transaction ${transactionId} not found, already assigned, or not in a valid state for assignment. Expected status '${EXPECTED_RESERVATION_STATUS}' and accepted '${EXPECTED_IS_ACCEPTED_STATUS}'. Staff Branch ID: ${branchId}`);
      return { 
        success: false, 
        message: `Reservation (ID: ${transactionId}) not found, already assigned a room, or not in a valid state for room assignment. Current state (if found): Status ${debugTxRes.rows[0]?.status}, Accepted ${debugTxRes.rows[0]?.is_accepted}, Room ${debugTxRes.rows[0]?.hotel_room_id}. Expected status '${EXPECTED_RESERVATION_STATUS}' and accepted '${EXPECTED_IS_ACCEPTED_STATUS}'.`
      };
    }
    const reservation = reservationRes.rows[0];
    // console.log(`[assignRoomAndCheckIn] Found reservation to assign:`, reservation);

    // Check room availability and status
    const ROOM_CHECK_SQL = `
      SELECT is_available, cleaning_status, room_name
      FROM hotel_room
      WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND status = $4
      FOR UPDATE;
    `;
    // console.log(`[assignRoomAndCheckIn] Executing ROOM_CHECK_SQL with params: [${roomId}, ${tenantId}, ${branchId}, '${ROOM_DEFINITION_ACTIVE_STATUS}']`);
    const roomRes = await client.query(ROOM_CHECK_SQL, [roomId, tenantId, branchId, ROOM_DEFINITION_ACTIVE_STATUS]);

    if (roomRes.rows.length === 0) {
      await client.query('ROLLBACK');
      // console.warn(`[assignRoomAndCheckIn] ROLLBACK (ROOM_CHECK): Selected room ${roomId} not found or not active for tenant ${tenantId}, branch ${branchId}.`);
      return { success: false, message: "Selected room not found or is not active." };
    }
    const room = roomRes.rows[0];
    // console.log(`[assignRoomAndCheckIn] Selected room details:`, room);

    if (Number(room.is_available) !== ROOM_AVAILABILITY_STATUS.AVAILABLE) {
      await client.query('ROLLBACK');
      // console.warn(`[assignRoomAndCheckIn] ROLLBACK (ROOM_CHECK): Selected room ${roomId} is not available (current status: ${room.is_available}).`);
      return { success: false, message: "Selected room is not available." };
    }
    if (Number(room.cleaning_status) !== ROOM_CLEANING_STATUS.CLEAN) {
      await client.query('ROLLBACK');
      // console.warn(`[assignRoomAndCheckIn] ROLLBACK (ROOM_CHECK): Selected room ${roomId} is not clean (current status: ${room.cleaning_status}).`);
      return { success: false, message: "Selected room is not clean." };
    }

    let actualCheckInTime = reservation.reserved_check_in_datetime || `(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')`;
    let checkInTimeForReturn = actualCheckInTime;

    const UPDATE_TRANSACTION_SQL = `
      UPDATE transactions
      SET hotel_room_id = $1,
          status = $2,
          check_in_time = ${reservation.reserved_check_in_datetime ? '$3' : `(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')`},
          updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $${reservation.reserved_check_in_datetime ? '4' : '3'} AND tenant_id = $${reservation.reserved_check_in_datetime ? '5' : '4'} AND branch_id = $${reservation.reserved_check_in_datetime ? '6' : '5'}
      RETURNING *, check_in_time as effective_check_in_time;
    `;

    const updateTransactionParams: any[] = [
      roomId,
      NEW_TRANSACTION_LIFECYCLE_STATUS.toString(),
    ];
    if (reservation.reserved_check_in_datetime) {
      updateTransactionParams.push(reservation.reserved_check_in_datetime);
    }
    updateTransactionParams.push(transactionId, tenantId, branchId);

    // console.log(`[assignRoomAndCheckIn] Executing UPDATE_TRANSACTION_SQL with params:`, updateTransactionParams);
    const transactionUpdateResult = await client.query(UPDATE_TRANSACTION_SQL, updateTransactionParams);

    if (transactionUpdateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      // console.warn(`[assignRoomAndCheckIn] ROLLBACK (TX_UPDATE): Failed to update transaction ${transactionId}.`);
      return { success: false, message: "Failed to update transaction details for check-in." };
    }
    const updatedTransactionRow = transactionUpdateResult.rows[0];
    checkInTimeForReturn = updatedTransactionRow.effective_check_in_time;
    // console.log(`[assignRoomAndCheckIn] Transaction ${transactionId} updated:`, updatedTransactionRow);


    const UPDATE_ROOM_SQL = `
      UPDATE hotel_room
      SET is_available = $1,
          transaction_id = $2,
          updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $3 AND tenant_id = $4 AND branch_id = $5
      RETURNING id, is_available, transaction_id, cleaning_status, hotel_rate_id, room_name, room_code;
    `;
    // console.log(`[assignRoomAndCheckIn] Executing UPDATE_ROOM_SQL with params: [${ROOM_NOW_OCCUPIED_STATUS}, ${transactionId}, ${roomId}, ${tenantId}, ${branchId}]`);
    const roomUpdateResult = await client.query(UPDATE_ROOM_SQL, [
      ROOM_NOW_OCCUPIED_STATUS,
      transactionId,
      roomId,
      tenantId,
      branchId
    ]);

    if (roomUpdateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      // console.warn(`[assignRoomAndCheckIn] ROLLBACK (ROOM_UPDATE): Failed to update room ${roomId} status.`);
      return { success: false, message: "Failed to update room status." };
    }
    const updatedRoomDbRow = roomUpdateResult.rows[0];
    // console.log(`[assignRoomAndCheckIn] Room ${roomId} updated:`, updatedRoomDbRow);

    // Log activity
    const rateNameRes = await client.query('SELECT name FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [updatedTransactionRow.hotel_rate_id, tenantId, branchId]);
    const rateName = rateNameRes.rows.length > 0 ? rateNameRes.rows[0].name : 'N/A';

    // console.log(`[assignRoomAndCheckIn] Logging activity for TxID: ${transactionId}`);
    await logActivity({
      tenant_id: tenantId,
      branch_id: branchId,
      actor_user_id: staffUserId,
      action_type: 'STAFF_ASSIGNED_ROOM_AND_CHECKED_IN',
      description: `Staff (ID: ${staffUserId}) assigned room '${updatedRoomDbRow.room_name}' (${updatedRoomDbRow.room_code}) to client '${updatedTransactionRow.client_name}' (Tx ID: ${transactionId}) and checked them in. Rate: ${rateName}.`,
      target_entity_type: 'Transaction',
      target_entity_id: transactionId.toString(),
      details: {
        client_name: updatedTransactionRow.client_name,
        room_id: roomId,
        room_name: updatedRoomDbRow.room_name,
        rate_id: updatedTransactionRow.hotel_rate_id,
        rate_name: rateName,
        new_transaction_status: NEW_TRANSACTION_LIFECYCLE_STATUS,
        new_room_availability_status: ROOM_NOW_OCCUPIED_STATUS,
        checked_in_staff_id: staffUserId
      }
    }, client);
    // console.log(`[assignRoomAndCheckIn] Activity logged. Committing transaction for TxID: ${transactionId}`);

    await client.query('COMMIT');
    // console.log(`[assignRoomAndCheckIn] Transaction COMMITTED successfully for TxID: ${transactionId}.`);

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
      is_admin_created: Number(updatedTransactionRow.is_admin_created),
      is_accepted: Number(updatedTransactionRow.is_accepted),
      rate_name: rateName,
      room_name: updatedRoomDbRow.room_name,
      rate_price: updatedTransactionRow.hotel_rate_id ? (await client.query('SELECT price FROM hotel_rates WHERE id = $1', [updatedTransactionRow.hotel_rate_id])).rows[0]?.price : null,
      rate_hours: updatedTransactionRow.hotel_rate_id ? (await client.query('SELECT hours FROM hotel_rates WHERE id = $1', [updatedTransactionRow.hotel_rate_id])).rows[0]?.hours : null,
      rate_excess_hour_price: updatedTransactionRow.hotel_rate_id ? (await client.query('SELECT excess_hour_price FROM hotel_rates WHERE id = $1', [updatedTransactionRow.hotel_rate_id])).rows[0]?.excess_hour_price : null,
    };
    
    const updatedRoomData: Partial<HotelRoom> & { id: number } = {
      id: roomId,
      is_available: ROOM_NOW_OCCUPIED_STATUS,
      transaction_id: transactionId,
      active_transaction_id: transactionId,
      active_transaction_client_name: finalUpdatedTransaction.client_name,
      active_transaction_check_in_time: finalUpdatedTransaction.check_in_time,
      active_transaction_rate_name: finalUpdatedTransaction.rate_name,
      active_transaction_rate_hours: finalUpdatedTransaction.rate_hours,
      active_transaction_lifecycle_status: finalUpdatedTransaction.status,
      cleaning_status: Number(updatedRoomDbRow.cleaning_status), // Ensure this is current
      hotel_rate_id: updatedRoomDbRow.hotel_rate_id ? JSON.parse(updatedRoomDbRow.hotel_rate_id) : [], // Re-parse from DB if needed
    };

    return {
      success: true,
      message: `Room '${updatedRoomDbRow.room_name}' assigned and client '${updatedTransactionRow.client_name}' checked in.`,
      updatedRoomData,
      updatedTransaction: finalUpdatedTransaction,
    };

  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
        // console.warn(`[assignRoomAndCheckIn] Transaction ROLLED BACK for TxID: ${transactionId} due to error:`, error);
      } catch (rbError) {
        // console.error(`[assignRoomAndCheckIn] Error during rollback for TxID: ${transactionId}:`, rbError);
      }
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[assignRoomAndCheckIn DB Full Error]', error); // Keep this for detailed server-side error
    return { success: false, message: `Database error during room assignment and check-in: ${errorMessage}` };
  } finally {
    if (client) {
      client.release();
      // console.log(`[assignRoomAndCheckIn] Client released for TxID: ${transactionId}`);
    }
  }
}
    
    