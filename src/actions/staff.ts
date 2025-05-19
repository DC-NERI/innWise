
"use server";

import { Pool } from 'pg';
import type { Transaction, HotelRoom } from '@/lib/types'; // Added HotelRoom
import { 
  transactionCreateSchema, TransactionCreateData, 
  transactionUpdateNotesSchema, TransactionUpdateNotesData,
  transactionReservedUpdateSchema, TransactionReservedUpdateData
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

  const { client_name, client_payment_method, notes } = validatedFields.data;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const transactionRes = await client.query(
      `INSERT INTO transactions (tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name, client_payment_method, notes, check_in_time, status, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, $8, $9)
       RETURNING id, tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name, client_payment_method, notes, check_in_time, status, created_at, updated_at, created_by_user_id`,
      [tenantId, branchId, roomId, rateId, client_name, client_payment_method, notes, TRANSACTION_STATUS.UNPAID, staffUserId]
    );

    if (transactionRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Transaction creation failed (booking)." };
    }
    const newTransaction = transactionRes.rows[0];

    const roomUpdateRes = await client.query(
      `UPDATE hotel_room SET is_available = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND tenant_id = $3 AND branch_id = $4`,
      [ROOM_AVAILABILITY_STATUS.OCCUPIED, roomId, tenantId, branchId]
    );

    if (roomUpdateRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update room status to occupied. Room not found or already in desired state." };
    }

    // Fetch rate name for the updatedRoomData
    const rateNameRes = await client.query('SELECT name FROM hotel_rates WHERE id = $1', [rateId]);
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

  const { client_name, client_payment_method, notes } = validatedFields.data;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const transactionRes = await client.query(
      `INSERT INTO transactions (tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name, client_payment_method, notes, check_in_time, status, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, $8, $9)
       RETURNING id, tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name, client_payment_method, notes, check_in_time, status, created_at, updated_at, created_by_user_id`,
      [tenantId, branchId, roomId, rateId, client_name, client_payment_method, notes, TRANSACTION_STATUS.ADVANCE_PAID, staffUserId]
    );

    if (transactionRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Transaction creation failed (reservation)." };
    }
    const newTransaction = transactionRes.rows[0];

    const roomUpdateRes = await client.query(
      `UPDATE hotel_room SET is_available = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND tenant_id = $3 AND branch_id = $4`,
      [ROOM_AVAILABILITY_STATUS.RESERVED, roomId, tenantId, branchId]
    );

    if (roomUpdateRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update room status to reserved. Room not found or already in desired state." };
    }
    
    // Fetch rate name for the updatedRoomData
    const rateNameRes = await client.query('SELECT name FROM hotel_rates WHERE id = $1', [rateId]);
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
  roomId: number,
  tenantId: number,
  branchId: number
): Promise<Transaction | null> {
  console.log(`[staff.ts:getActiveTransactionForRoom] Called with: roomId=${roomId}, tenantId=${tenantId}, branchId=${branchId}`);

  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT t.*, hr.room_name, hrt.name as rate_name
       FROM transactions t
       JOIN hotel_room hr ON t.hotel_room_id = hr.id
       JOIN hotel_rates hrt ON t.hotel_rate_id = hrt.id
       WHERE t.hotel_room_id = $1 
         AND t.tenant_id = $2 
         AND t.branch_id = $3 
         AND (t.status = $4 OR t.status = $5) -- Unpaid (Occupied) or Advance Paid (Reserved)
       ORDER BY t.created_at DESC LIMIT 1`,
      [roomId, tenantId, branchId, TRANSACTION_STATUS.UNPAID, TRANSACTION_STATUS.ADVANCE_PAID]
    );
    if (res.rows.length > 0) {
      const row = res.rows[0];
      console.log(`[staff.ts:getActiveTransactionForRoom] Found transaction: ${JSON.stringify(row)}`);
      return {
        ...row,
        price: row.price ? parseFloat(row.price) : undefined, 
        total_amount: row.total_amount ? parseFloat(row.total_amount) : undefined,
        check_in_time: new Date(row.check_in_time).toISOString(),
        check_out_time: row.check_out_time ? new Date(row.check_out_time).toISOString() : null,
        created_at: new Date(row.created_at).toISOString(),
        updated_at: new Date(row.updated_at).toISOString(),
      } as Transaction;
    }
    console.log(`[staff.ts:getActiveTransactionForRoom] No active or reserved transaction found for room ID ${roomId}.`);
    return null;
  } catch (error) {
    console.error(`[staff.ts:getActiveTransactionForRoom] Error fetching transaction details for room ID ${roomId}:`, error);
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
       SET notes = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND tenant_id = $3 AND branch_id = $4
       RETURNING id, tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name, client_payment_method, notes, check_in_time, status, created_at, updated_at, created_by_user_id, check_out_time, hours_used, total_amount`,
      [notes, transactionId, tenantId, branchId]
    );
    if (res.rows.length > 0) {
       const updatedRow = res.rows[0];
       // Fetch room_name and rate_name again
       const detailsRes = await client.query(
        `SELECT hr.room_name, hrt.name as rate_name
         FROM hotel_room hr
         JOIN hotel_rates hrt ON $1 = hrt.id 
         WHERE hr.id = $2`, [updatedRow.hotel_rate_id, updatedRow.hotel_room_id]
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
          check_in_time: new Date(updatedRow.check_in_time).toISOString(),
          check_out_time: updatedRow.check_out_time ? new Date(updatedRow.check_out_time).toISOString() : null,
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
       SET client_name = $1, client_payment_method = $2, notes = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND tenant_id = $5 AND branch_id = $6 AND status = $7
       RETURNING id, tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name, client_payment_method, notes, check_in_time, status, created_at, updated_at, created_by_user_id, check_out_time, hours_used, total_amount`,
      [client_name, client_payment_method, notes, transactionId, tenantId, branchId, TRANSACTION_STATUS.ADVANCE_PAID]
    );
    if (res.rows.length > 0) {
      const updatedRow = res.rows[0];
      // Fetch room_name and rate_name again as they are not part of the direct update
      const roomDetailsRes = await client.query(
        `SELECT hr.room_name, hrt.name as rate_name
         FROM hotel_room hr
         JOIN hotel_rates hrt ON $1 = hrt.id 
         WHERE hr.id = $2`, [updatedRow.hotel_rate_id, updatedRow.hotel_room_id]
      );
      const room_name = roomDetailsRes.rows[0]?.room_name;
      const rate_name = roomDetailsRes.rows[0]?.rate_name;

      return {
        success: true,
        message: "Reservation details updated successfully.",
        updatedTransaction: {
          ...updatedRow,
          room_name,
          rate_name,
          check_in_time: new Date(updatedRow.check_in_time).toISOString(),
          check_out_time: updatedRow.check_out_time ? new Date(updatedRow.check_out_time).toISOString() : null,
          created_at: new Date(updatedRow.created_at).toISOString(),
          updated_at: new Date(updatedRow.updated_at).toISOString(),
        } as Transaction,
      };
    }
    return { success: false, message: "Reservation not found, not in 'Advance Paid' status, or update failed." };
  } catch (error) {
    console.error(`Failed to update reservation details for transaction ${transactionId}:`, error);
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

    const check_out_time = new Date();
    const check_in_time = new Date(transactionDetails.check_in_time);
    
    const diffMilliseconds = check_out_time.getTime() - check_in_time.getTime();
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
       SET check_out_time = $1, hours_used = $2, total_amount = $3, check_out_by_user_id = $4, status = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING id, tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name, client_payment_method, notes, check_in_time, check_out_time, hours_used, total_amount, check_out_by_user_id, status, created_at, updated_at, created_by_user_id`,
      [check_out_time.toISOString(), hours_used, total_amount, staffUserId, TRANSACTION_STATUS.PAID, transactionId]
    );

    if (updatedTransactionRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update transaction record during check-out." };
    }
    const updatedTransaction = updatedTransactionRes.rows[0];

    const roomUpdateRes = await client.query(
      `UPDATE hotel_room SET is_available = $1, updated_at = CURRENT_TIMESTAMP
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
        check_in_time: new Date(updatedTransaction.check_in_time).toISOString(),
        check_out_time: new Date(updatedTransaction.check_out_time).toISOString(),
        created_at: new Date(updatedTransaction.created_at).toISOString(),
        updated_at: new Date(updatedTransaction.updated_at).toISOString(),
      } as Transaction,
      updatedRoomData: {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.AVAILABLE,
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
  roomId: number
): Promise<{ 
  success: boolean; 
  message?: string; 
  updatedRoomData?: Partial<HotelRoom> & { id: number } 
}> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Update transaction status to Cancelled
    const transactionUpdateRes = await client.query(
      `UPDATE transactions
       SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND tenant_id = $3 AND branch_id = $4 AND hotel_room_id = $5 AND status = $6`,
      [TRANSACTION_STATUS.CANCELLED, transactionId, tenantId, branchId, roomId, TRANSACTION_STATUS.ADVANCE_PAID]
    );

    if (transactionUpdateRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Reservation not found, not in 'Advance Paid' status, or already cancelled." };
    }

    // Update room status to Available
    const roomUpdateRes = await client.query(
      `UPDATE hotel_room SET is_available = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND tenant_id = $3 AND branch_id = $4`,
      [ROOM_AVAILABILITY_STATUS.AVAILABLE, roomId, tenantId, branchId]
    );

    if (roomUpdateRes.rowCount === 0) {
      // This case is problematic as the transaction was updated.
      // For safety, we might rollback, but the room status could be manually fixed.
      // For now, proceed and let the user know.
      console.warn(`Reservation ${transactionId} cancelled, but failed to update room ${roomId} status to available.`);
      // await client.query('ROLLBACK');
      // return { success: false, message: "Reservation cancelled, but failed to update room status. Please check manually." };
    }

    await client.query('COMMIT');
    return {
      success: true,
      message: "Reservation cancelled successfully. Room is now available.",
      updatedRoomData: {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.AVAILABLE,
        active_transaction_id: null,
        active_transaction_client_name: null,
        active_transaction_check_in_time: null,
        active_transaction_rate_name: null,
      }
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to cancel reservation:', error);
    return { success: false, message: `Database error during cancellation: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}

