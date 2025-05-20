
"use server";

import pg from 'pg';
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE
pg.types.setTypeParser(20, (stringValue) => parseInt(stringValue, 10)); // BIGINT to number
pg.types.setTypeParser(1700, (stringValue) => parseFloat(stringValue)); // NUMERIC to float


import { Pool } from 'pg';
import type { Transaction, HotelRoom, SimpleRate } from '@/lib/types';
import {
  transactionCreateSchema, TransactionCreateData,
  transactionUpdateNotesSchema, TransactionUpdateNotesData,
  transactionReservedUpdateSchema, TransactionReservedUpdateData,
  assignRoomAndCheckInSchema, AssignRoomAndCheckInData,
  transactionUnassignedUpdateSchema, TransactionUnassignedUpdateData
} from '@/lib/schemas';
import { ROOM_AVAILABILITY_STATUS, TRANSACTION_STATUS, TRANSACTION_IS_ACCEPTED_STATUS } from '@/lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in staff actions', err);
});

export async function createTransactionAndOccupyRoom(
  data: TransactionCreateData,
  tenantId: number,
  branchId: number,
  roomId: number,
  rateId: number, // This is data.selected_rate_id
  staffUserId: number
): Promise<{
  success: boolean;
  message?: string;
  transaction?: Transaction;
  updatedRoomData?: Partial<HotelRoom> & { id: number }
}> {
  const validatedFields = transactionCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    return { success: false, message: `Invalid data: ${JSON.stringify(validatedFields.error.flatten().fieldErrors)}` };
  }

  const { client_name, client_payment_method, notes } = validatedFields.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const transactionRes = await client.query(
      `INSERT INTO transactions (tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name, client_payment_method, notes, check_in_time, status, created_by_user_id, updated_at, is_admin_created, is_accepted)
       VALUES ($1, $2, $3, $4, $5, $6, $7, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), $8, $9, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), 0, ${TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED})
       RETURNING *`,
      [tenantId, branchId, roomId, rateId, client_name, client_payment_method, notes, TRANSACTION_STATUS.UNPAID, staffUserId]
    );

    if (transactionRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Transaction creation failed (booking)." };
    }
    const newTransaction = transactionRes.rows[0] as Transaction;

    const roomUpdateRes = await client.query(
      `UPDATE hotel_room SET is_available = $1, transaction_id = $2, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $3 AND tenant_id = $4 AND branch_id = $5`,
      [ROOM_AVAILABILITY_STATUS.OCCUPIED, newTransaction.id, roomId, tenantId, branchId]
    );

    if (roomUpdateRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update room status to occupied. Room not found or already in desired state." };
    }

    let rate_name = null;
    if (newTransaction.hotel_rate_id) {
        const rateNameRes = await client.query('SELECT name FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [newTransaction.hotel_rate_id, tenantId, branchId]);
        rate_name = rateNameRes.rows.length > 0 ? rateNameRes.rows[0].name : null;
    }
    

    await client.query('COMMIT');
    return {
      success: true,
      message: "Guest checked in successfully and room occupied.",
      transaction: {
        ...newTransaction,
        room_name: (await client.query('SELECT room_name FROM hotel_room WHERE id = $1', [roomId])).rows[0]?.room_name,
        rate_name,
      },
      updatedRoomData: {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.OCCUPIED,
        transaction_id: newTransaction.id,
        active_transaction_client_name: newTransaction.client_name,
        active_transaction_check_in_time: newTransaction.check_in_time,
        active_transaction_rate_name: rate_name,
      }
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to create transaction and occupy room:', error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}

export async function createReservation(
  data: TransactionCreateData,
  tenantId: number,
  branchId: number,
  roomId: number,
  rateId: number, 
  staffUserId: number
): Promise<{
  success: boolean;
  message?: string;
  transaction?: Transaction;
  updatedRoomData?: Partial<HotelRoom> & { id: number }
}> {
  const validatedFields = transactionCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    return { success: false, message: `Invalid data for reservation: ${JSON.stringify(validatedFields.error.flatten().fieldErrors)}` };
  }

  const { client_name, client_payment_method, notes } = validatedFields.data;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const transactionRes = await client.query(
      `INSERT INTO transactions (tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name, client_payment_method, notes, check_in_time, status, created_by_user_id, updated_at, is_admin_created, is_accepted)
       VALUES ($1, $2, $3, $4, $5, $6, $7, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), $8, $9, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), 0, ${TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED})
       RETURNING *`,
      [tenantId, branchId, roomId, rateId, client_name, client_payment_method, notes, TRANSACTION_STATUS.ADVANCE_PAID, staffUserId]
    );

    if (transactionRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Transaction creation failed (reservation)." };
    }
    const newTransaction = transactionRes.rows[0] as Transaction;

    const roomUpdateRes = await client.query(
      `UPDATE hotel_room SET is_available = $1, transaction_id = $2, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $3 AND tenant_id = $4 AND branch_id = $5`,
      [ROOM_AVAILABILITY_STATUS.RESERVED, newTransaction.id, roomId, tenantId, branchId]
    );

    if (roomUpdateRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update room status to reserved. Room not found or already in desired state." };
    }
    
    let rate_name = null;
    if (newTransaction.hotel_rate_id) {
        const rateNameRes = await client.query('SELECT name FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [newTransaction.hotel_rate_id, tenantId, branchId]);
        rate_name = rateNameRes.rows.length > 0 ? rateNameRes.rows[0].name : null;
    }

    await client.query('COMMIT');
    return {
      success: true,
      message: "Room reserved successfully.",
      transaction: {
        ...newTransaction,
        room_name: (await client.query('SELECT room_name FROM hotel_room WHERE id = $1', [roomId])).rows[0]?.room_name,
        rate_name,
      },
      updatedRoomData: {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.RESERVED,
        transaction_id: newTransaction.id,
        active_transaction_client_name: newTransaction.client_name,
        active_transaction_check_in_time: newTransaction.check_in_time,
        active_transaction_rate_name: rate_name,
      }
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to create reservation:', error);
    return { success: false, message: `Database error during reservation: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}


export async function getActiveTransactionForRoom(
  transactionId: number,
  tenantId: number,
  branchId: number
): Promise<Transaction | null> {
  console.log(`[staff.ts:getActiveTransactionForRoom] Called with: transactionId=${transactionId}, tenantId=${tenantId}, branchId=${branchId}`);
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT t.*, hr_room.room_name, hrt.name as rate_name
       FROM transactions t
       LEFT JOIN hotel_room hr_room ON t.hotel_room_id = hr_room.id AND hr_room.tenant_id = t.tenant_id AND hr_room.branch_id = t.branch_id
       LEFT JOIN hotel_rates hrt ON t.hotel_rate_id = hrt.id AND hrt.tenant_id = t.tenant_id AND hrt.branch_id = t.branch_id
       WHERE t.id = $1
         AND t.tenant_id = $2
         AND t.branch_id = $3
         AND (t.status = $4 OR t.status = $5 OR t.status = $6) -- Unpaid (Occupied), Advance Paid/Reserved, PENDING_BRANCH_ACCEPTANCE
       ORDER BY t.created_at DESC LIMIT 1`,
      [transactionId, tenantId, branchId, TRANSACTION_STATUS.UNPAID, TRANSACTION_STATUS.ADVANCE_PAID, TRANSACTION_STATUS.PENDING_BRANCH_ACCEPTANCE]
    );
    if (res.rows.length > 0) {
      const row = res.rows[0];
      console.log(`[staff.ts:getActiveTransactionForRoom] Found transaction ID ${transactionId}: ${JSON.stringify(row)}`);
      return row as Transaction;
    }
    console.log(`[staff.ts:getActiveTransactionForRoom] No active, reserved or pending transaction found for transaction ID ${transactionId}.`);
    return null;
  } catch (error) {
    console.error(`[staff.ts:getActiveTransactionForRoom] Error fetching transaction details for transaction ID ${transactionId}:`, error);
    throw new Error(`Database error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}

export async function updateTransactionNotes(
  transactionId: number,
  notes: string | null | undefined,
  tenantId: number,
  branchId: number
): Promise<{ success: boolean; message?: string; updatedTransaction?: Transaction }> {
  console.log(`[staff.ts:updateTransactionNotes] Called with: transactionId=${transactionId}, notes=${notes === undefined ? 'undefined' : notes === null ? 'null' : `"${notes}"`}`);
  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE transactions
       SET notes = $1, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $2 AND tenant_id = $3 AND branch_id = $4
       RETURNING *`,
      [notes, transactionId, tenantId, branchId]
    );
    if (res.rows.length > 0) {
       const updatedRow = res.rows[0];
       const detailsRes = await client.query(
        `SELECT hr.room_name, hrt.name as rate_name
         FROM transactions t
         LEFT JOIN hotel_room hr ON t.hotel_room_id = hr.id AND hr.tenant_id = t.tenant_id AND hr.branch_id = t.branch_id
         LEFT JOIN hotel_rates hrt ON t.hotel_rate_id = hrt.id AND hrt.tenant_id = t.tenant_id AND hrt.branch_id = t.branch_id
         WHERE t.id = $1`,
         [updatedRow.id]
      );
      const room_name = detailsRes.rows.length > 0 ? detailsRes.rows[0].room_name : null;
      const rate_name = detailsRes.rows.length > 0 ? detailsRes.rows[0].rate_name : null;

      return {
        success: true,
        message: "Transaction notes updated successfully.",
        updatedTransaction: {
          ...updatedRow,
          room_name,
          rate_name,
        } as Transaction,
      };
    }
    return { success: false, message: "Transaction not found or notes update failed." };
  } catch (error) {
    console.error(`Failed to update notes for transaction ${transactionId}:`, error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}

export async function updateReservedTransactionDetails(
  transactionId: number,
  data: TransactionReservedUpdateData,
  tenantId: number,
  branchId: number
): Promise<{ success: boolean; message?: string; updatedTransaction?: Transaction }> {
  const validatedFields = transactionReservedUpdateSchema.safeParse(data);
  if (!validatedFields.success) {
    return { success: false, message: `Invalid data for updating reservation: ${JSON.stringify(validatedFields.error.flatten().fieldErrors)}` };
  }
  const { client_name, client_payment_method, notes } = validatedFields.data;
  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE transactions
       SET client_name = $1, client_payment_method = $2, notes = $3, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $4 AND tenant_id = $5 AND branch_id = $6 AND (status = $7 OR status = $8 OR status = $9) -- Allow edit for AdvancePaid, AdvanceReservation, PendingBranchAcceptance
       RETURNING *`,
      [client_name, client_payment_method, notes, transactionId, tenantId, branchId, TRANSACTION_STATUS.ADVANCE_PAID, TRANSACTION_STATUS.ADVANCE_RESERVATION, TRANSACTION_STATUS.PENDING_BRANCH_ACCEPTANCE]
    );
    if (res.rows.length > 0) {
      const updatedRow = res.rows[0];
      const detailsRes = await client.query(
        `SELECT hr.room_name, hrt.name as rate_name
         FROM transactions t
         LEFT JOIN hotel_room hr ON t.hotel_room_id = hr.id AND hr.tenant_id = t.tenant_id AND hr.branch_id = t.branch_id
         LEFT JOIN hotel_rates hrt ON t.hotel_rate_id = hrt.id AND hrt.tenant_id = t.tenant_id AND hrt.branch_id = t.branch_id
         WHERE t.id = $1`,
         [updatedRow.id]
      );
      const room_name = detailsRes.rows[0]?.room_name;
      const rate_name = detailsRes.rows[0]?.rate_name;

      return {
        success: true,
        message: "Transaction details updated successfully.",
        updatedTransaction: {
          ...updatedRow,
          room_name,
          rate_name,
        } as Transaction,
      };
    }
    return { success: false, message: "Transaction not found, not in an editable reservation status, or update failed." };
  } catch (error) {
    console.error(`Failed to update transaction details for transaction ${transactionId}:`, error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}


export async function checkOutGuestAndFreeRoom(
  transactionId: number,
  staffUserId: number,
  tenantId: number,
  branchId: number,
  roomId: number
): Promise<{
  success: boolean;
  message?: string;
  transaction?: Transaction;
  updatedRoomData?: Partial<HotelRoom> & { id: number }
}> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const transactionAndRateRes = await client.query(
      `SELECT t.*, h_rates.price as rate_price, h_rates.hours as rate_hours, h_rates.excess_hour_price as rate_excess_hour_price
       FROM transactions t
       JOIN hotel_rates h_rates ON t.hotel_rate_id = h_rates.id
       WHERE t.id = $1 AND t.tenant_id = $2 AND t.branch_id = $3 AND t.hotel_room_id = $4
       AND t.status = $5 AND t.check_out_time IS NULL`,
      [transactionId, tenantId, branchId, roomId, TRANSACTION_STATUS.UNPAID]
    );

    if (transactionAndRateRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Active transaction for this room not found, already checked out, or not in 'Unpaid' state." };
    }
    const transactionDetails = transactionAndRateRes.rows[0];
    const check_in_time_str = transactionDetails.check_in_time;
    const check_in_time = new Date(check_in_time_str.replace(' ', 'T'));
    
    const checkOutTimeRes = await client.query("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') as db_check_out_time");
    const db_check_out_time_str = checkOutTimeRes.rows[0].db_check_out_time;
    const check_out_time_obj = new Date(db_check_out_time_str.replace(' ', 'T'));

    const diffMilliseconds = check_out_time_obj.getTime() - check_in_time.getTime();
    let hours_used = Math.ceil(diffMilliseconds / (1000 * 60 * 60));
    if (hours_used <= 0) hours_used = 1;

    let total_amount = parseFloat(transactionDetails.rate_price);
    const rate_hours = parseInt(transactionDetails.rate_hours, 10);
    const rate_excess_hour_price = transactionDetails.rate_excess_hour_price ? parseFloat(transactionDetails.rate_excess_hour_price) : null;

    if (hours_used > rate_hours) {
      const excess_hours = hours_used - rate_hours;
      if (rate_excess_hour_price && rate_excess_hour_price > 0) {
        total_amount += excess_hours * rate_excess_hour_price;
      }
    }

    if (hours_used > 0 && total_amount < parseFloat(transactionDetails.rate_price)) {
        total_amount = parseFloat(transactionDetails.rate_price);
    }

    const updatedTransactionRes = await client.query(
      `UPDATE transactions
       SET check_out_time = ($1::TEXT::TIMESTAMP WITHOUT TIME ZONE AT TIME ZONE 'Asia/Manila'), hours_used = $2, total_amount = $3, check_out_by_user_id = $4, status = $5, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $6
       RETURNING *`,
      [db_check_out_time_str, hours_used, total_amount, staffUserId, TRANSACTION_STATUS.PAID, transactionId]
    );

    if (updatedTransactionRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update transaction record during check-out." };
    }
    const updatedTransaction = updatedTransactionRes.rows[0] as Transaction;

    const roomUpdateRes = await client.query(
      `UPDATE hotel_room SET is_available = $1, transaction_id = NULL, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $2 AND tenant_id = $3 AND branch_id = $4`,
      [ROOM_AVAILABILITY_STATUS.AVAILABLE, roomId, tenantId, branchId]
    );

    if (roomUpdateRes.rowCount === 0) {
      console.warn(`Check-out successful for transaction ${transactionId}, but failed to update room ${roomId} status.`);
      await client.query('ROLLBACK');
      return { success: false, message: "Check-out processed for transaction, but failed to update room status. Please check manually." };
    }

    await client.query('COMMIT');
    return {
      success: true,
      message: "Guest checked out successfully and room is now available.",
      transaction: {
        ...updatedTransaction,
        room_name: (await client.query('SELECT room_name FROM hotel_room WHERE id = $1', [roomId])).rows[0]?.room_name,
        rate_name: (await client.query('SELECT name FROM hotel_rates WHERE id = $1', [updatedTransaction.hotel_rate_id])).rows[0]?.name,
      },
      updatedRoomData: {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.AVAILABLE,
        transaction_id: null,
        active_transaction_client_name: null,
        active_transaction_check_in_time: null,
        active_transaction_rate_name: null,
      }
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to check out guest:', error);
    return { success: false, message: `Database error during check-out: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}

export async function cancelReservation(
  transactionId: number,
  tenantId: number,
  branchId: number,
  roomId: number | null // roomId is NULL if cancelling an unassigned reservation
): Promise<{
  success: boolean;
  message?: string;
  updatedRoomData?: Partial<HotelRoom> & { id: number }
}> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Update the transaction status to 'Cancelled'
    const transactionUpdateRes = await client.query(
      `UPDATE transactions
       SET status = $1, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $2 AND tenant_id = $3 AND branch_id = $4 
       AND (status = $5 OR status = $6 OR status = $7 OR status = $8) -- Can cancel Unpaid, AdvancePaid, AdvanceReservation, PendingBranchAcceptance
       RETURNING hotel_room_id`, 
      [TRANSACTION_STATUS.CANCELLED, transactionId, tenantId, branchId, TRANSACTION_STATUS.ADVANCE_PAID, TRANSACTION_STATUS.UNPAID, TRANSACTION_STATUS.ADVANCE_RESERVATION, TRANSACTION_STATUS.PENDING_BRANCH_ACCEPTANCE]
    );

    if (transactionUpdateRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Reservation not found, not in a cancellable status, or already cancelled." };
    }

    const actualRoomId = roomId ?? transactionUpdateRes.rows[0].hotel_room_id;
    let updatedRoomData: (Partial<HotelRoom> & { id: number }) | undefined = undefined;

    // If the transaction was linked to a room, make the room available
    if (actualRoomId) {
      const roomUpdateRes = await client.query(
        `UPDATE hotel_room SET is_available = $1, transaction_id = NULL, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
         WHERE id = $2 AND tenant_id = $3 AND branch_id = $4 AND transaction_id = $5`, // Ensure we only update room if it's still linked to this transaction
        [ROOM_AVAILABILITY_STATUS.AVAILABLE, actualRoomId, tenantId, branchId, transactionId]
      );

      if (roomUpdateRes.rowCount === 0) {
        // This might happen if the room was already unlinked or is linked to a different transaction.
        // The transaction cancellation itself is still successful.
        console.warn(`Reservation ${transactionId} cancelled, but room ${actualRoomId} was not updated (it might not have been linked to this transaction or was already updated).`);
      }
      updatedRoomData = {
        id: actualRoomId,
        is_available: ROOM_AVAILABILITY_STATUS.AVAILABLE,
        transaction_id: null,
        active_transaction_client_name: null,
        active_transaction_check_in_time: null,
        active_transaction_rate_name: null,
      };
    }


    await client.query('COMMIT');
    return {
      success: true,
      message: "Reservation cancelled successfully." + (actualRoomId ? " Room is now available." : ""),
      updatedRoomData
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to cancel reservation:', error);
    return { success: false, message: `Database error during cancellation: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}


export async function checkInReservedGuest(
  transactionId: number,
  roomId: number,
  tenantId: number,
  branchId: number,
  staffUserId: number
): Promise<{
  success: boolean;
  message?: string;
  updatedRoomData?: Partial<HotelRoom> & { id: number };
  transaction?: Transaction;
}> {
  if (!transactionId) {
    return { success: false, message: "Invalid Transaction ID for check-in." };
  }
  if (!roomId) {
    return { success: false, message: "Invalid Room ID for check-in." };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check the current transaction status
    const transactionCheckRes = await client.query(
      `SELECT client_name, hotel_rate_id, reserved_check_in_datetime, status as current_status
       FROM transactions
       WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND hotel_room_id = $4
       AND (status = $5 OR status = $6)`, // Can check-in Advance Paid or Advance Reservation
      [transactionId, tenantId, branchId, roomId, TRANSACTION_STATUS.ADVANCE_PAID, TRANSACTION_STATUS.ADVANCE_RESERVATION]
    );

    if (transactionCheckRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Reservation not found for this room, already checked in, or not in a reservable status." };
    }
    const { client_name, hotel_rate_id, reserved_check_in_datetime, current_status } = transactionCheckRes.rows[0];

    let actualCheckInTime: string;
    let queryParamsForTxUpdate: any[] = [];
    let checkInTimeQueryPart: string;

    if (current_status === TRANSACTION_STATUS.ADVANCE_RESERVATION && reserved_check_in_datetime) {
      actualCheckInTime = reserved_check_in_datetime; // This is already a string from DB
      checkInTimeQueryPart = `$${queryParamsForTxUpdate.length + 2}`; // Status will be $1
      queryParamsForTxUpdate.push(actualCheckInTime);
    } else {
      // For ADVANCE_PAID or if ADVANCE_RESERVATION has no specific check-in time, use current time
      const nowRes = await client.query(`SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') as now_val`);
      actualCheckInTime = nowRes.rows[0].now_val;
      checkInTimeQueryPart = `$${queryParamsForTxUpdate.length + 2}`;
      queryParamsForTxUpdate.push(actualCheckInTime);
    }
    
    queryParamsForTxUpdate.unshift(TRANSACTION_STATUS.UNPAID); // status is $1
    queryParamsForTxUpdate.push(transactionId); // id is $last

    const updateTransactionRes = await client.query(
      `UPDATE transactions
       SET status = $1,
           check_in_time = (${checkInTimeQueryPart}::TEXT::TIMESTAMP WITHOUT TIME ZONE),
           updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $${queryParamsForTxUpdate.length}
       RETURNING *`,
       queryParamsForTxUpdate
    );


    if (updateTransactionRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update transaction status for check-in." };
    }
    const updatedTransaction = updateTransactionRes.rows[0] as Transaction;


    const roomUpdateRes = await client.query(
      `UPDATE hotel_room
       SET is_available = $1, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $2 AND tenant_id = $3 AND branch_id = $4 AND transaction_id = $5`,
      [ROOM_AVAILABILITY_STATUS.OCCUPIED, roomId, tenantId, branchId, transactionId]
    );

    if (roomUpdateRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update room status to occupied. The room may no longer be linked to this reservation or is occupied by another transaction." };
    }

    let rate_name = null;
    if (hotel_rate_id) {
        const rateNameRes = await client.query('SELECT name FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [hotel_rate_id, tenantId, branchId]);
        rate_name = rateNameRes.rows.length > 0 ? rateNameRes.rows[0].name : null;
    }

    await client.query('COMMIT');
    return {
      success: true,
      message: "Reserved guest checked in successfully.",
      transaction: {
        ...updatedTransaction,
        room_name: (await client.query('SELECT room_name FROM hotel_room WHERE id = $1', [roomId])).rows[0]?.room_name,
        rate_name,
      },
      updatedRoomData: {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.OCCUPIED,
        transaction_id: transactionId, // Stays the same
        active_transaction_client_name: client_name, // from original reservation
        active_transaction_check_in_time: actualCheckInTime, // The actual check-in time
        active_transaction_rate_name: rate_name,
      }
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to check in reserved guest:', error);
    return { success: false, message: `Database error during reserved check-in: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}

export async function listUnassignedReservations(tenantId: number, branchId: number): Promise<Transaction[]> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT t.*, hr.name as rate_name
       FROM transactions t
       LEFT JOIN hotel_rates hr ON t.hotel_rate_id = hr.id AND hr.tenant_id = t.tenant_id AND hr.branch_id = t.branch_id
       WHERE t.tenant_id = $1 AND t.branch_id = $2 
       AND (t.status = $3 OR t.status = $4) -- Only ADVANCE_PAID or ADVANCE_RESERVATION
       AND t.hotel_room_id IS NULL
       ORDER BY t.reserved_check_in_datetime ASC, t.created_at DESC`,
      [tenantId, branchId, TRANSACTION_STATUS.ADVANCE_PAID, TRANSACTION_STATUS.ADVANCE_RESERVATION]
    );
    return res.rows as Transaction[];
  } catch (error) {
    console.error('Failed to fetch unassigned reservations:', error);
    throw new Error(`Database error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}

export async function createUnassignedReservation(
  data: TransactionCreateData,
  tenantId: number,
  branchId: number,
  staffUserId: number,
  is_admin_created_flag?: boolean
): Promise<{ success: boolean; message?: string; transaction?: Transaction }> {
  const validatedFields = transactionCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    return { success: false, message: `Invalid data: ${JSON.stringify(validatedFields.error.flatten().fieldErrors)}` };
  }
  const { client_name, selected_rate_id, client_payment_method, notes, is_advance_reservation, reserved_check_in_datetime, reserved_check_out_datetime } = validatedFields.data;
  const client = await pool.connect();
  try {
    
    let transactionStatus: string;
    let acceptedStatus: number;

    if (is_admin_created_flag) {
        transactionStatus = TRANSACTION_STATUS.PENDING_BRANCH_ACCEPTANCE; // '5'
        acceptedStatus = TRANSACTION_IS_ACCEPTED_STATUS.PENDING; // 3
    } else {
        transactionStatus = is_advance_reservation ? TRANSACTION_STATUS.ADVANCE_RESERVATION : TRANSACTION_STATUS.ADVANCE_PAID;
        acceptedStatus = TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED; // 2 (Staff created for their branch is auto-accepted by branch)
    }
    
    const r_check_in = (is_advance_reservation && reserved_check_in_datetime) ? reserved_check_in_datetime : null;
    const r_check_out = (is_advance_reservation && reserved_check_out_datetime) ? reserved_check_out_datetime : null;
    const isAdminCreatedValue = is_admin_created_flag ? 1 : 0;


    const res = await client.query(
      `INSERT INTO transactions (
         tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name, client_payment_method, 
         notes, check_in_time, status, created_by_user_id, reserved_check_in_datetime, 
         reserved_check_out_datetime, updated_at, is_admin_created, is_accepted
       )
       VALUES ($1, $2, NULL, $3, $4, $5, $6, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), $7, $8, $9, $10, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), $11, $12)
       RETURNING *`,
      [
        tenantId, branchId, selected_rate_id, client_name, client_payment_method, notes, 
        transactionStatus, staffUserId,
        r_check_in, r_check_out, isAdminCreatedValue, acceptedStatus
      ]
    );
    if (res.rows.length > 0) {
      const newTransaction = res.rows[0] as Transaction;
      let rate_name = null;
      if (newTransaction.hotel_rate_id) {
        const rateNameRes = await client.query('SELECT name FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [newTransaction.hotel_rate_id, tenantId, branchId]);
        rate_name = rateNameRes.rows.length > 0 ? rateNameRes.rows[0].name : null;
      }

      return {
        success: true,
        message: "Unassigned reservation created successfully.",
        transaction: {
          ...newTransaction,
          rate_name,
        } as Transaction,
      };
    }
    return { success: false, message: "Failed to create unassigned reservation." };
  } catch (error) {
    console.error('Failed to create unassigned reservation:', error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}

export async function listAvailableRoomsForBranch(tenantId: number, branchId: number): Promise<Array<Pick<HotelRoom, 'id' | 'room_name' | 'room_code'>>> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT id, room_name, room_code FROM hotel_room
       WHERE tenant_id = $1 AND branch_id = $2 AND is_available = $3 AND status = '1'
       ORDER BY floor ASC, room_code ASC`,
      [tenantId, branchId, ROOM_AVAILABILITY_STATUS.AVAILABLE]
    );
    return res.rows;
  } catch (error) {
    console.error('Failed to fetch available rooms for branch:', error);
    throw new Error(`Database error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}


export async function assignRoomAndCheckIn(
  transactionId: number,
  roomId: number,
  staffUserId: number,
  tenantId: number,
  branchId: number
): Promise<{
  success: boolean;
  message?: string;
  updatedRoomData?: Partial<HotelRoom> & { id: number };
  transaction?: Transaction;
}> {
  if (!transactionId) {
    return { success: false, message: "Invalid Transaction ID for assignment." };
  }
   if (!roomId) {
    return { success: false, message: "Invalid Room ID for assignment." };
  }
  console.log(`[staff.ts:assignRoomAndCheckIn] Called with: transactionId=${transactionId}, roomId=${roomId}, staffUserId=${staffUserId}`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Check if the selected room is available
    const roomCheckRes = await client.query(
      `SELECT is_available, room_name FROM hotel_room WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND status = '1'`,
      [roomId, tenantId, branchId]
    );
    if (roomCheckRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Selected room not found or is inactive." };
    }
    if (roomCheckRes.rows[0].is_available !== ROOM_AVAILABILITY_STATUS.AVAILABLE) {
      await client.query('ROLLBACK');
      return { success: false, message: "Selected room is not available for check-in." };
    }
    const roomName = roomCheckRes.rows[0].room_name;

    // 2. Check the transaction to be assigned
    const transactionCheckRes = await client.query(
      `SELECT client_name, hotel_rate_id, reserved_check_in_datetime, status as current_status
       FROM transactions
       WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND hotel_room_id IS NULL 
       AND (status = $4 OR status = $5) -- Can assign ADVANCE_PAID or ADVANCE_RESERVATION
       `, 
      [transactionId, tenantId, branchId, TRANSACTION_STATUS.ADVANCE_PAID, TRANSACTION_STATUS.ADVANCE_RESERVATION]
    );

    if (transactionCheckRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Reservation not found, already assigned, or not in a valid unassigned status." };
    }
    const { client_name, hotel_rate_id, reserved_check_in_datetime, current_status } = transactionCheckRes.rows[0];

    // 3. Determine actual check-in time
    let actualCheckInTime: string;
    let queryParamsForTxUpdate: any[] = [];
    let checkInTimeQueryPart: string;

    if (current_status === TRANSACTION_STATUS.ADVANCE_RESERVATION && reserved_check_in_datetime) {
      actualCheckInTime = reserved_check_in_datetime;
      checkInTimeQueryPart = `$${queryParamsForTxUpdate.length + 3}`; // Status $1, hotel_room_id $2
      queryParamsForTxUpdate.push(actualCheckInTime);
    } else {
      const nowRes = await client.query(`SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') as now_val`);
      actualCheckInTime = nowRes.rows[0].now_val;
      checkInTimeQueryPart = `$${queryParamsForTxUpdate.length + 3}`;
      queryParamsForTxUpdate.push(actualCheckInTime);
    }
    
    // 4. Update Transaction
    queryParamsForTxUpdate.unshift(TRANSACTION_STATUS.UNPAID); // status $1
    queryParamsForTxUpdate.unshift(roomId); // hotel_room_id $2 (actually index 1 now, but $2 in query)
    queryParamsForTxUpdate.push(transactionId); // id is $last (index 3, but $4 in query)

    const updateTransactionRes = await client.query(
      `UPDATE transactions
       SET status = $1,
           hotel_room_id = $2,
           check_in_time = (${checkInTimeQueryPart}::TEXT::TIMESTAMP WITHOUT TIME ZONE), 
           is_accepted = ${TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED}, -- Assigning implies branch accepts it
           updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $${queryParamsForTxUpdate.length}
       RETURNING *`,
       queryParamsForTxUpdate
    );


    if (updateTransactionRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update transaction for check-in." };
    }
    const updatedTransaction = updateTransactionRes.rows[0] as Transaction;

    // 5. Update Room
    const roomUpdateRes = await client.query(
      `UPDATE hotel_room
       SET is_available = $1, transaction_id = $2, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $3 AND tenant_id = $4 AND branch_id = $5`,
      [ROOM_AVAILABILITY_STATUS.OCCUPIED, transactionId, roomId, tenantId, branchId]
    );

    if (roomUpdateRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update room status to occupied." };
    }

    let rate_name = null;
    if (hotel_rate_id) {
        const rateNameRes = await client.query('SELECT name FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [hotel_rate_id, tenantId, branchId]);
        rate_name = rateNameRes.rows.length > 0 ? rateNameRes.rows[0].name : null;
    }

    await client.query('COMMIT');
    return {
      success: true,
      message: "Guest from reservation checked in successfully.",
      transaction: {
        ...updatedTransaction,
        room_name: roomName,
        rate_name,
      },
      updatedRoomData: {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.OCCUPIED,
        transaction_id: transactionId,
        active_transaction_client_name: client_name,
        active_transaction_check_in_time: actualCheckInTime,
        active_transaction_rate_name: rate_name,
      }
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[staff.ts:assignRoomAndCheckIn] Error:', error);
    return { success: false, message: `Database error during assignment and check-in: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}

export async function updateUnassignedReservation(
  transactionId: number,
  data: TransactionUnassignedUpdateData,
  tenantId: number,
  branchId: number
): Promise<{ success: boolean; message?: string; updatedTransaction?: Transaction }> {
  const validatedFields = transactionUnassignedUpdateSchema.safeParse(data);
  if (!validatedFields.success) {
    return { success: false, message: `Invalid data: ${JSON.stringify(validatedFields.error.flatten().fieldErrors)}` };
  }
  const {
    client_name,
    selected_rate_id,
    client_payment_method,
    notes,
    is_advance_reservation,
    reserved_check_in_datetime,
    reserved_check_out_datetime
  } = validatedFields.data;

  const client = await pool.connect();
  try {
    // Determine new status based on is_advance_reservation.
    // If it's an admin-created one (status 5), it remains 5 unless branch explicitly accepts/rejects.
    // This function is called by staff, so if they edit, it might imply branch acceptance IF it was status 5.
    // For now, let's assume editing keeps status 5 if it was 5, otherwise toggles between 2 and 4.
    // A dedicated "accept reservation" action would be cleaner for status 5 transitions.

    const currentTransactionRes = await client.query('SELECT status FROM transactions WHERE id = $1', [transactionId]);
    if (currentTransactionRes.rows.length === 0) {
      return { success: false, message: "Transaction not found." };
    }
    const currentStatus = currentTransactionRes.rows[0].status;

    let newStatus = currentStatus;
    if (currentStatus !== TRANSACTION_STATUS.PENDING_BRANCH_ACCEPTANCE) { // Only allow staff to change between 2 and 4
        newStatus = is_advance_reservation ? TRANSACTION_STATUS.ADVANCE_RESERVATION : TRANSACTION_STATUS.ADVANCE_PAID;
    }

    const r_check_in = (is_advance_reservation && reserved_check_in_datetime) ? reserved_check_in_datetime : null;
    const r_check_out = (is_advance_reservation && reserved_check_out_datetime) ? reserved_check_out_datetime : null;

    const res = await client.query(
      `UPDATE transactions
       SET client_name = $1, hotel_rate_id = $2, client_payment_method = $3, notes = $4,
           status = $5,
           reserved_check_in_datetime = $6,
           reserved_check_out_datetime = $7,
           updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $8 AND tenant_id = $9 AND branch_id = $10 AND hotel_room_id IS NULL 
       AND (status = $11 OR status = $12 OR status = $13) -- Can edit AdvancePaid, AdvanceReservation, or PendingAcceptance
       RETURNING *`,
      [
        client_name, selected_rate_id, client_payment_method, notes,
        newStatus,
        r_check_in,
        r_check_out,
        transactionId, tenantId, branchId,
        TRANSACTION_STATUS.ADVANCE_PAID, TRANSACTION_STATUS.ADVANCE_RESERVATION, TRANSACTION_STATUS.PENDING_BRANCH_ACCEPTANCE
      ]
    );

    if (res.rows.length > 0) {
      const updatedRow = res.rows[0] as Transaction;
      let rate_name = null;
      if (updatedRow.hotel_rate_id) {
        const rateNameRes = await client.query('SELECT name FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [updatedRow.hotel_rate_id, tenantId, branchId]);
        rate_name = rateNameRes.rows.length > 0 ? rateNameRes.rows[0].name : null;
      }
      return {
        success: true,
        message: "Unassigned reservation updated successfully.",
        updatedTransaction: {
          ...updatedRow,
          rate_name,
        },
      };
    }
    return { success: false, message: "Unassigned reservation not found or update failed." };
  } catch (error) {
    console.error(`Failed to update unassigned reservation ${transactionId}:`, error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}
