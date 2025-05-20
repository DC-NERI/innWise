
"use server";

import { Pool } from 'pg';
import type { Transaction, HotelRoom, SimpleRate } from '@/lib/types';
import {
  transactionCreateSchema, TransactionCreateData,
  transactionUpdateNotesSchema, TransactionUpdateNotesData,
  transactionReservedUpdateSchema, TransactionReservedUpdateData,
  transactionUnassignedUpdateSchema, TransactionUnassignedUpdateData,
  assignRoomAndCheckInSchema, AssignRoomAndCheckInData,
} from '@/lib/schemas';
import { ROOM_AVAILABILITY_STATUS, TRANSACTION_STATUS } from '@/lib/constants';

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
    return { success: false, message: `Invalid data: ${JSON.stringify(validatedFields.error.flatten().fieldErrors)}` };
  }

  const { client_name, client_payment_method, notes, selected_rate_id } = validatedFields.data;
  const effectiveRateId = selected_rate_id || rateId;
  if (!effectiveRateId) {
    return { success: false, message: "A rate must be selected for booking."};
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // updated_at will use DB default (Asia/Manila) for transaction
    const transactionRes = await client.query(
      `INSERT INTO transactions (tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name, client_payment_method, notes, check_in_time, status, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), $8, $9)
       RETURNING id, tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name, client_payment_method, notes, check_in_time, status, created_at, updated_at, created_by_user_id, reserved_check_in_datetime, reserved_check_out_datetime`,
      [tenantId, branchId, roomId, effectiveRateId, client_name, client_payment_method, notes, TRANSACTION_STATUS.UNPAID, staffUserId]
    );

    if (transactionRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Transaction creation failed (booking)." };
    }
    const newTransaction = transactionRes.rows[0];

    const roomUpdateRes = await client.query(
      `UPDATE hotel_room SET is_available = $1, transaction_id = $2, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $3 AND tenant_id = $4 AND branch_id = $5`,
      [ROOM_AVAILABILITY_STATUS.OCCUPIED, newTransaction.id, roomId, tenantId, branchId]
    );

    if (roomUpdateRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update room status to occupied. Room not found or already in desired state." };
    }

    const rateNameRes = await client.query('SELECT name FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [effectiveRateId, tenantId, branchId]);
    const rate_name = rateNameRes.rows.length > 0 ? rateNameRes.rows[0].name : null;

    await client.query('COMMIT');
    return {
      success: true,
      message: "Guest checked in successfully and room occupied.",
      transaction: {
        ...newTransaction,
        check_in_time: new Date(newTransaction.check_in_time).toISOString(),
        created_at: new Date(newTransaction.created_at).toISOString(),
        updated_at: new Date(newTransaction.updated_at).toISOString(),
      } as Transaction,
      updatedRoomData: {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.OCCUPIED,
        transaction_id: newTransaction.id,
        active_transaction_id: newTransaction.id,
        active_transaction_client_name: newTransaction.client_name,
        active_transaction_check_in_time: new Date(newTransaction.check_in_time).toISOString(),
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

  const { client_name, client_payment_method, notes, selected_rate_id } = validatedFields.data;
  const effectiveRateId = selected_rate_id || rateId; 
  if (!effectiveRateId) {
    return { success: false, message: "A rate must be selected for reservation."};
  }
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    // updated_at will use DB default (Asia/Manila) for transaction
    const transactionRes = await client.query(
      `INSERT INTO transactions (tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name, client_payment_method, notes, check_in_time, status, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), $8, $9)
       RETURNING id, tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name, client_payment_method, notes, check_in_time, status, created_at, updated_at, created_by_user_id, reserved_check_in_datetime, reserved_check_out_datetime`,
      [tenantId, branchId, roomId, effectiveRateId, client_name, client_payment_method, notes, TRANSACTION_STATUS.ADVANCE_PAID, staffUserId]
    );

    if (transactionRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Transaction creation failed (reservation)." };
    }
    const newTransaction = transactionRes.rows[0];

    const roomUpdateRes = await client.query(
      `UPDATE hotel_room SET is_available = $1, transaction_id = $2, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $3 AND tenant_id = $4 AND branch_id = $5`,
      [ROOM_AVAILABILITY_STATUS.RESERVED, newTransaction.id, roomId, tenantId, branchId]
    );

    if (roomUpdateRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update room status to reserved. Room not found or already in desired state." };
    }

    const rateNameRes = await client.query('SELECT name FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [effectiveRateId, tenantId, branchId]);
    const rate_name = rateNameRes.rows.length > 0 ? rateNameRes.rows[0].name : null;

    await client.query('COMMIT');
    return {
      success: true,
      message: "Room reserved successfully.",
      transaction: {
        ...newTransaction,
        check_in_time: new Date(newTransaction.check_in_time).toISOString(),
        created_at: new Date(newTransaction.created_at).toISOString(),
        updated_at: new Date(newTransaction.updated_at).toISOString(),
      } as Transaction,
      updatedRoomData: {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.RESERVED,
        transaction_id: newTransaction.id, 
        active_transaction_id: newTransaction.id,
        active_transaction_client_name: newTransaction.client_name,
        active_transaction_check_in_time: new Date(newTransaction.check_in_time).toISOString(), 
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
       LEFT JOIN hotel_room hr_room ON t.hotel_room_id = hr_room.id 
       LEFT JOIN hotel_rates hrt ON t.hotel_rate_id = hrt.id AND hrt.tenant_id = t.tenant_id AND hrt.branch_id = t.branch_id
       WHERE t.id = $1
         AND t.tenant_id = $2
         AND t.branch_id = $3
         AND (t.status = $4 OR t.status = $5) -- Unpaid (Occupied) or Advance Paid (Assigned Reserved)
       ORDER BY t.created_at DESC LIMIT 1`, 
      [transactionId, tenantId, branchId, TRANSACTION_STATUS.UNPAID, TRANSACTION_STATUS.ADVANCE_PAID]
    );
    if (res.rows.length > 0) {
      const row = res.rows[0];
      console.log(`[staff.ts:getActiveTransactionForRoom] Found transaction ID ${transactionId}: ${JSON.stringify(row)}`);
      return {
        ...row,
        hotel_rate_id: row.hotel_rate_id ? Number(row.hotel_rate_id) : null,
        client_payment_method: row.client_payment_method,
        check_in_time: new Date(row.check_in_time).toISOString(),
        check_out_time: row.check_out_time ? new Date(row.check_out_time).toISOString() : null,
        reserved_check_in_datetime: row.reserved_check_in_datetime ? new Date(row.reserved_check_in_datetime).toISOString() : null,
        reserved_check_out_datetime: row.reserved_check_out_datetime ? new Date(row.reserved_check_out_datetime).toISOString() : null,
        created_at: new Date(row.created_at).toISOString(),
        updated_at: new Date(row.updated_at).toISOString(),
      } as Transaction;
    }
    console.log(`[staff.ts:getActiveTransactionForRoom] No active or assigned reserved transaction found for transaction ID ${transactionId}.`);
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
      const room_name = detailsRes.rows[0]?.room_name;
      const rate_name = detailsRes.rows[0]?.rate_name;

      return {
        success: true,
        message: "Transaction notes updated successfully.",
        updatedTransaction: {
          ...updatedRow,
          room_name,
          rate_name,
          hotel_rate_id: updatedRow.hotel_rate_id ? Number(updatedRow.hotel_rate_id) : null,
          client_payment_method: updatedRow.client_payment_method,
          check_in_time: new Date(updatedRow.check_in_time).toISOString(),
          check_out_time: updatedRow.check_out_time ? new Date(updatedRow.check_out_time).toISOString() : null,
          reserved_check_in_datetime: updatedRow.reserved_check_in_datetime ? new Date(updatedRow.reserved_check_in_datetime).toISOString() : null,
          reserved_check_out_datetime: updatedRow.reserved_check_out_datetime ? new Date(updatedRow.reserved_check_out_datetime).toISOString() : null,
          created_at: new Date(updatedRow.created_at).toISOString(),
          updated_at: new Date(updatedRow.updated_at).toISOString(),
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
       WHERE id = $4 AND tenant_id = $5 AND branch_id = $6 AND (status = $7 OR status = $8) 
       RETURNING *`,
      [client_name, client_payment_method, notes, transactionId, tenantId, branchId, TRANSACTION_STATUS.ADVANCE_PAID, TRANSACTION_STATUS.UNPAID]
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
          hotel_rate_id: updatedRow.hotel_rate_id ? Number(updatedRow.hotel_rate_id) : null,
          client_payment_method: updatedRow.client_payment_method,
          check_in_time: new Date(updatedRow.check_in_time).toISOString(),
          check_out_time: updatedRow.check_out_time ? new Date(updatedRow.check_out_time).toISOString() : null,
          reserved_check_in_datetime: updatedRow.reserved_check_in_datetime ? new Date(updatedRow.reserved_check_in_datetime).toISOString() : null,
          reserved_check_out_datetime: updatedRow.reserved_check_out_datetime ? new Date(updatedRow.reserved_check_out_datetime).toISOString() : null,
          created_at: new Date(updatedRow.created_at).toISOString(),
          updated_at: new Date(updatedRow.updated_at).toISOString(),
        } as Transaction,
      };
    }
    return { success: false, message: "Transaction not found, not in 'Advance Paid' or 'Unpaid' status, or update failed." };
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

    const check_out_time_obj = new Date(); // JS Date object
    const check_in_time = new Date(transactionDetails.check_in_time);

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
       SET check_out_time = ($1 AT TIME ZONE 'Asia/Manila'), hours_used = $2, total_amount = $3, check_out_by_user_id = $4, status = $5, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $6
       RETURNING *`,
      [check_out_time_obj.toISOString(), hours_used, total_amount, staffUserId, TRANSACTION_STATUS.PAID, transactionId]
    );

    if (updatedTransactionRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update transaction record during check-out." };
    }
    const updatedTransaction = updatedTransactionRes.rows[0];

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
        hotel_rate_id: updatedTransaction.hotel_rate_id ? Number(updatedTransaction.hotel_rate_id) : null,
        client_payment_method: updatedTransaction.client_payment_method,
        check_in_time: new Date(updatedTransaction.check_in_time).toISOString(),
        check_out_time: new Date(updatedTransaction.check_out_time).toISOString(),
        reserved_check_in_datetime: updatedTransaction.reserved_check_in_datetime ? new Date(updatedTransaction.reserved_check_in_datetime).toISOString() : null,
        reserved_check_out_datetime: updatedTransaction.reserved_check_out_datetime ? new Date(updatedTransaction.reserved_check_out_datetime).toISOString() : null,
        created_at: new Date(updatedTransaction.created_at).toISOString(),
        updated_at: new Date(updatedTransaction.updated_at).toISOString(),
      } as Transaction,
      updatedRoomData: {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.AVAILABLE,
        transaction_id: null,
        active_transaction_id: null,
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
  roomId: number | null 
): Promise<{
  success: boolean;
  message?: string;
  updatedRoomData?: Partial<HotelRoom> & { id: number }
}> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const transactionUpdateRes = await client.query(
      `UPDATE transactions
       SET status = $1, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $2 AND tenant_id = $3 AND branch_id = $4 AND (status = $5 OR status = $6)`, 
      [TRANSACTION_STATUS.CANCELLED, transactionId, tenantId, branchId, TRANSACTION_STATUS.ADVANCE_PAID, TRANSACTION_STATUS.ADVANCE_RESERVATION]
    );

    if (transactionUpdateRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Reservation not found, not in a cancellable status, or already cancelled." };
    }

    let updatedRoomData: (Partial<HotelRoom> & { id: number }) | undefined = undefined;

    if (roomId) { 
      const roomUpdateRes = await client.query(
        `UPDATE hotel_room SET is_available = $1, transaction_id = NULL, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
         WHERE id = $2 AND tenant_id = $3 AND branch_id = $4 AND transaction_id = $5`, 
        [ROOM_AVAILABILITY_STATUS.AVAILABLE, roomId, tenantId, branchId, transactionId]
      );

      if (roomUpdateRes.rowCount === 0) {
        console.warn(`Reservation ${transactionId} cancelled, but room ${roomId} was not updated (it might not have been linked to this transaction or was already updated).`);
      }
      updatedRoomData = {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.AVAILABLE,
        transaction_id: null,
        active_transaction_id: null,
        active_transaction_client_name: null,
        active_transaction_check_in_time: null,
        active_transaction_rate_name: null,
      };
    }


    await client.query('COMMIT');
    return {
      success: true,
      message: "Reservation cancelled successfully." + (roomId ? " Room is now available." : ""),
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
}> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const transactionCheckRes = await client.query(
      `SELECT client_name, hotel_rate_id, reserved_check_in_datetime, status as current_status
       FROM transactions
       WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND hotel_room_id = $4 
       AND (status = $5 OR status = $6)`, 
      [transactionId, tenantId, branchId, roomId, TRANSACTION_STATUS.ADVANCE_PAID, TRANSACTION_STATUS.ADVANCE_RESERVATION]
    );

    if (transactionCheckRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Reservation not found for this room, already checked in, or not in a reservable status." };
    }
    const { client_name, hotel_rate_id, reserved_check_in_datetime, current_status } = transactionCheckRes.rows[0];

    
    const newCheckInTime = (current_status === TRANSACTION_STATUS.ADVANCE_RESERVATION && reserved_check_in_datetime) 
                           ? new Date(reserved_check_in_datetime).toISOString()
                           : `(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')`;

    const updateTransactionRes = await client.query(
      `UPDATE transactions
       SET status = $1, check_in_time = ${current_status === TRANSACTION_STATUS.ADVANCE_RESERVATION && reserved_check_in_datetime ? '$2' : newCheckInTime}, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $3`,
      current_status === TRANSACTION_STATUS.ADVANCE_RESERVATION && reserved_check_in_datetime 
        ? [TRANSACTION_STATUS.UNPAID, newCheckInTime, transactionId]
        : [TRANSACTION_STATUS.UNPAID, transactionId]
    );


    if (updateTransactionRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update transaction status for check-in." };
    }

    const roomUpdateRes = await client.query(
      `UPDATE hotel_room
       SET is_available = $1, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $2 AND tenant_id = $3 AND branch_id = $4 AND transaction_id = $5`,
      [ROOM_AVAILABILITY_STATUS.OCCUPIED, roomId, tenantId, branchId, transactionId]
    );

    if (roomUpdateRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update room status to occupied. The room may no longer be linked to this reservation." };
    }
    
    const rateNameRes = await client.query('SELECT name FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [hotel_rate_id, tenantId, branchId]);
    const rate_name = rateNameRes.rows.length > 0 ? rateNameRes.rows[0].name : null;
    
    const finalCheckInTime = current_status === TRANSACTION_STATUS.ADVANCE_RESERVATION && reserved_check_in_datetime 
                            ? new Date(reserved_check_in_datetime).toISOString()
                            : new Date().toISOString(); // Fallback if CURRENT_TIMESTAMP was used

    await client.query('COMMIT');
    return {
      success: true,
      message: "Reserved guest checked in successfully.",
      updatedRoomData: {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.OCCUPIED,
        transaction_id: transactionId, 
        active_transaction_id: transactionId, 
        active_transaction_client_name: client_name, 
        active_transaction_check_in_time: finalCheckInTime, 
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

// For "Reservations" tab: listing unassigned reservations (status 2 or 4)
export async function listUnassignedReservations(tenantId: number, branchId: number): Promise<Transaction[]> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT t.*, hr.name as rate_name
       FROM transactions t
       LEFT JOIN hotel_rates hr ON t.hotel_rate_id = hr.id AND hr.tenant_id = t.tenant_id AND hr.branch_id = t.branch_id
       WHERE t.tenant_id = $1 AND t.branch_id = $2 AND (t.status = $3 OR t.status = $4) AND t.hotel_room_id IS NULL
       ORDER BY t.created_at DESC`,
      [tenantId, branchId, TRANSACTION_STATUS.ADVANCE_PAID, TRANSACTION_STATUS.ADVANCE_RESERVATION]
    );
    return res.rows.map(row => ({
      ...row,
      hotel_rate_id: row.hotel_rate_id ? Number(row.hotel_rate_id) : null,
      client_payment_method: row.client_payment_method,
      check_in_time: new Date(row.check_in_time).toISOString(), 
      reserved_check_in_datetime: row.reserved_check_in_datetime ? new Date(row.reserved_check_in_datetime).toISOString() : null,
      reserved_check_out_datetime: row.reserved_check_out_datetime ? new Date(row.reserved_check_out_datetime).toISOString() : null,
      created_at: new Date(row.created_at).toISOString(),
      updated_at: new Date(row.updated_at).toISOString(),
    })) as Transaction[];
  } catch (error) {
    console.error('Failed to fetch unassigned reservations:', error);
    throw new Error(`Database error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}

// For "Reservations" tab: creating an unassigned reservation
export async function createUnassignedReservation(
  data: TransactionCreateData,
  tenantId: number,
  branchId: number,
  staffUserId: number
): Promise<{ success: boolean; message?: string; transaction?: Transaction }> {
  const validatedFields = transactionCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    return { success: false, message: `Invalid data: ${JSON.stringify(validatedFields.error.flatten().fieldErrors)}` };
  }
  const { client_name, selected_rate_id, client_payment_method, notes, is_advance_reservation, reserved_check_in_datetime, reserved_check_out_datetime } = validatedFields.data;
  const client = await pool.connect();
  try {
    const transactionStatus = is_advance_reservation ? TRANSACTION_STATUS.ADVANCE_RESERVATION : TRANSACTION_STATUS.ADVANCE_PAID;
    // created_at, updated_at will use DB defaults (Asia/Manila)
    // check_in_time for unassigned reservation is set to when reservation record is made
    const res = await client.query(
      `INSERT INTO transactions (tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name, client_payment_method, notes, check_in_time, status, created_by_user_id, reserved_check_in_datetime, reserved_check_out_datetime)
       VALUES ($1, $2, NULL, $3, $4, $5, $6, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), $7, $8, $9, $10)
       RETURNING *`,
      [tenantId, branchId, selected_rate_id, client_name, client_payment_method, notes, transactionStatus, staffUserId, 
       is_advance_reservation ? reserved_check_in_datetime : null, 
       is_advance_reservation ? reserved_check_out_datetime : null]
    );
    if (res.rows.length > 0) {
      const newTransaction = res.rows[0];
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
          hotel_rate_id: newTransaction.hotel_rate_id ? Number(newTransaction.hotel_rate_id) : null,
          client_payment_method: newTransaction.client_payment_method,
          check_in_time: new Date(newTransaction.check_in_time).toISOString(),
          reserved_check_in_datetime: newTransaction.reserved_check_in_datetime ? new Date(newTransaction.reserved_check_in_datetime).toISOString() : null,
          reserved_check_out_datetime: newTransaction.reserved_check_out_datetime ? new Date(newTransaction.reserved_check_out_datetime).toISOString() : null,
          created_at: new Date(newTransaction.created_at).toISOString(),
          updated_at: new Date(newTransaction.updated_at).toISOString(),
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

// For "Reservations" tab: listing available rooms to assign
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


// For "Reservations" tab: assigning a room to an unassigned reservation and checking them in
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
}> {
  console.log(`[staff.ts:assignRoomAndCheckIn] Called with: transactionId=${transactionId}, roomId=${roomId}, staffUserId=${staffUserId}`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const roomCheckRes = await client.query(
      `SELECT is_available FROM hotel_room WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND status = '1'`,
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

    const transactionCheckRes = await client.query(
      `SELECT client_name, hotel_rate_id, reserved_check_in_datetime, status as current_status
       FROM transactions
       WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND hotel_room_id IS NULL AND (status = $4 OR status = $5)`,
      [transactionId, tenantId, branchId, TRANSACTION_STATUS.ADVANCE_PAID, TRANSACTION_STATUS.ADVANCE_RESERVATION]
    );

    if (transactionCheckRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Reservation not found, already assigned, or not in a valid unassigned status." };
    }
    const { client_name, hotel_rate_id, reserved_check_in_datetime, current_status } = transactionCheckRes.rows[0];

    const newCheckInTime = (current_status === TRANSACTION_STATUS.ADVANCE_RESERVATION && reserved_check_in_datetime) 
                           ? new Date(reserved_check_in_datetime).toISOString()
                           : `(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')`;
                           
    const updateTransactionRes = await client.query(
      `UPDATE transactions
       SET status = $1, check_in_time = ${current_status === TRANSACTION_STATUS.ADVANCE_RESERVATION && reserved_check_in_datetime ? '$2' : newCheckInTime}, hotel_room_id = $3, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $4`,
       current_status === TRANSACTION_STATUS.ADVANCE_RESERVATION && reserved_check_in_datetime 
        ? [TRANSACTION_STATUS.UNPAID, newCheckInTime, roomId, transactionId]
        : [TRANSACTION_STATUS.UNPAID, roomId, transactionId]
    );


    if (updateTransactionRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update transaction for check-in." };
    }

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
    
    const finalCheckInTime = current_status === TRANSACTION_STATUS.ADVANCE_RESERVATION && reserved_check_in_datetime 
                            ? new Date(reserved_check_in_datetime).toISOString()
                            : new Date().toISOString(); 


    await client.query('COMMIT');
    return {
      success: true,
      message: "Guest from reservation checked in successfully.",
      updatedRoomData: {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.OCCUPIED,
        transaction_id: transactionId,
        active_transaction_id: transactionId,
        active_transaction_client_name: client_name,
        active_transaction_check_in_time: finalCheckInTime,
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
    const newStatus = is_advance_reservation ? TRANSACTION_STATUS.ADVANCE_RESERVATION : TRANSACTION_STATUS.ADVANCE_PAID;

    const res = await client.query(
      `UPDATE transactions
       SET client_name = $1, hotel_rate_id = $2, client_payment_method = $3, notes = $4, 
           status = $5, 
           reserved_check_in_datetime = $6, 
           reserved_check_out_datetime = $7, 
           updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $8 AND tenant_id = $9 AND branch_id = $10 AND hotel_room_id IS NULL AND (status = $11 OR status = $12)
       RETURNING *`,
      [
        client_name, selected_rate_id, client_payment_method, notes, 
        newStatus,
        is_advance_reservation ? reserved_check_in_datetime : null,
        is_advance_reservation ? reserved_check_out_datetime : null,
        transactionId, tenantId, branchId, 
        TRANSACTION_STATUS.ADVANCE_PAID, TRANSACTION_STATUS.ADVANCE_RESERVATION
      ]
    );

    if (res.rows.length > 0) {
      const updatedRow = res.rows[0];
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
          hotel_rate_id: updatedRow.hotel_rate_id ? Number(updatedRow.hotel_rate_id) : null,
          client_payment_method: updatedRow.client_payment_method,
          check_in_time: new Date(updatedRow.check_in_time).toISOString(),
          reserved_check_in_datetime: updatedRow.reserved_check_in_datetime ? new Date(updatedRow.reserved_check_in_datetime).toISOString() : null,
          reserved_check_out_datetime: updatedRow.reserved_check_out_datetime ? new Date(updatedRow.reserved_check_out_datetime).toISOString() : null,
          created_at: new Date(updatedRow.created_at).toISOString(),
          updated_at: new Date(updatedRow.updated_at).toISOString(),
        } as Transaction,
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

    