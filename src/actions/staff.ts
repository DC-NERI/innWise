
"use server";

import { Pool } from 'pg';
import type { Transaction } from '@/lib/types';
import { transactionCreateSchema, TransactionCreateData } from '@/lib/schemas';

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
  staffUserId: number // Assuming staffUserId is the ID of the user performing the check-in
): Promise<{ success: boolean; message?: string; transaction?: Transaction; room?: any }> {
  const validatedFields = transactionCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    return { success: false, message: `Invalid data: ${JSON.stringify(validatedFields.error.flatten().fieldErrors)}` };
  }

  const { client_name, client_payment_method, notes } = validatedFields.data;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Create the transaction
    const transactionRes = await client.query(
      `INSERT INTO transactions (tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name, client_payment_method, notes, check_in_time, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, '0')
       RETURNING id, tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name, client_payment_method, notes, check_in_time, status, created_at, updated_at`,
      [tenantId, branchId, roomId, rateId, client_name, client_payment_method, notes]
    );

    if (transactionRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Transaction creation failed." };
    }
    const newTransaction = transactionRes.rows[0];

    // Update the room to be unavailable
    const roomUpdateRes = await client.query(
      `UPDATE hotel_room SET is_available = FALSE, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND tenant_id = $2 AND branch_id = $3
       RETURNING id, is_available`,
      [roomId, tenantId, branchId]
    );

    if (roomUpdateRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update room status. Room not found or already in desired state." };
    }

    await client.query('COMMIT');
    return {
      success: true,
      message: "Guest checked in successfully.",
      transaction: {
        ...newTransaction,
        check_in_time: new Date(newTransaction.check_in_time).toISOString(),
        created_at: new Date(newTransaction.created_at).toISOString(),
        updated_at: new Date(newTransaction.updated_at).toISOString(),
      } as Transaction,
      room: roomUpdateRes.rows[0],
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to create transaction and occupy room:', error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}

export async function getActiveTransactionDetails(
  transactionId: number,
  tenantId: number,
  branchId: number
): Promise<Transaction | null> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT t.*, hr.room_name, hrt.name as rate_name 
       FROM transactions t
       JOIN hotel_room hr ON t.hotel_room_id = hr.id
       JOIN hotel_rates hrt ON t.hotel_rate_id = hrt.id
       WHERE t.id = $1 AND t.tenant_id = $2 AND t.branch_id = $3 AND t.status = '0'`,
      [transactionId, tenantId, branchId]
    );
    if (res.rows.length > 0) {
      const row = res.rows[0];
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
    return null;
  } catch (error) {
    console.error(`Failed to fetch transaction details for ID ${transactionId}:`, error);
    throw new Error(`Database error: ${error instanceof Error ? error.message : String(error)}`);
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
): Promise<{ success: boolean; message?: string; transaction?: Transaction }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Fetch the transaction and its associated rate details
    const transactionAndRateRes = await client.query(
      `SELECT t.*, hr.price as rate_price, hr.hours as rate_hours, hr.excess_hour_price as rate_excess_hour_price
       FROM transactions t
       JOIN hotel_rates hr ON t.hotel_rate_id = hr.id
       WHERE t.id = $1 AND t.tenant_id = $2 AND t.branch_id = $3 AND t.hotel_room_id = $4 AND t.status = '0' AND t.check_out_time IS NULL`,
      [transactionId, tenantId, branchId, roomId]
    );

    if (transactionAndRateRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Active transaction for this room not found or already checked out." };
    }
    const transactionDetails = transactionAndRateRes.rows[0];

    // 2. Calculate check_out_time, hours_used, total_amount
    const check_out_time = new Date();
    const check_in_time = new Date(transactionDetails.check_in_time);
    
    // Calculate hours_used (rounded up to the nearest hour for simplicity in charges)
    const diffMilliseconds = check_out_time.getTime() - check_in_time.getTime();
    const hours_used_decimal = diffMilliseconds / (1000 * 60 * 60);
    const hours_used = Math.ceil(hours_used_decimal); // Round up to ensure minimum charge for any part of an hour

    let total_amount = parseFloat(transactionDetails.rate_price);
    const rate_hours = parseInt(transactionDetails.rate_hours, 10);
    const rate_excess_hour_price = transactionDetails.rate_excess_hour_price ? parseFloat(transactionDetails.rate_excess_hour_price) : null;

    if (hours_used > rate_hours) {
      const excess_hours = hours_used - rate_hours;
      if (rate_excess_hour_price && rate_excess_hour_price > 0) {
        total_amount += excess_hours * rate_excess_hour_price;
      }
      // If no excess_hour_price, total_amount remains base price as per previous logic
    }
    
    // Ensure total_amount is not less than the base rate price if hours_used is very small but not zero
    if (hours_used > 0 && total_amount < parseFloat(transactionDetails.rate_price)) {
        total_amount = parseFloat(transactionDetails.rate_price);
    }


    // 3. Update the transaction
    const updatedTransactionRes = await client.query(
      `UPDATE transactions
       SET check_out_time = $1, hours_used = $2, total_amount = $3, check_out_by_user_id = $4, status = '1', updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING id, tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name, client_payment_method, notes, check_in_time, check_out_time, hours_used, total_amount, check_out_by_user_id, status, created_at, updated_at`,
      [check_out_time.toISOString(), hours_used, total_amount, staffUserId, transactionId]
    );

    if (updatedTransactionRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update transaction record during check-out." };
    }
    const updatedTransaction = updatedTransactionRes.rows[0];

    // 4. Update the room to be available
    const roomUpdateRes = await client.query(
      `UPDATE hotel_room SET is_available = TRUE, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND tenant_id = $2 AND branch_id = $3`,
      [roomId, tenantId, branchId]
    );

    if (roomUpdateRes.rowCount === 0) {
      // This is less critical, so we might log it but still consider checkout successful if transaction updated.
      // For now, we'll rollback if room update fails to maintain consistency.
      console.warn(`Check-out successful for transaction ${transactionId}, but failed to update room ${roomId} status.`);
      await client.query('ROLLBACK');
      return { success: false, message: "Check-out processed for transaction, but failed to update room status. Please check manually." };
    }

    await client.query('COMMIT');
    return {
      success: true,
      message: "Guest checked out successfully.",
      transaction: {
        ...updatedTransaction,
        check_in_time: new Date(updatedTransaction.check_in_time).toISOString(),
        check_out_time: new Date(updatedTransaction.check_out_time).toISOString(),
        created_at: new Date(updatedTransaction.created_at).toISOString(),
        updated_at: new Date(updatedTransaction.updated_at).toISOString(),
      } as Transaction,
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to check out guest:', error);
    return { success: false, message: `Database error during check-out: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}
