
"use server";

import pg from 'pg';
pg.types.setTypeParser(1114, (stringValue) => stringValue); 
pg.types.setTypeParser(1184, (stringValue) => stringValue); 
pg.types.setTypeParser(20, (stringValue) => parseInt(stringValue, 10));
pg.types.setTypeParser(1700, (stringValue) => parseFloat(stringValue));


import { Pool } from 'pg';
import type { Transaction, HotelRoom, SimpleRate, Notification, RoomCleaningStatusUpdateData, TransactionUnassignedUpdateData, CheckoutFormData } from '@/lib/types';
import {
  transactionCreateSchema, TransactionCreateData,
  transactionUpdateNotesSchema, TransactionUpdateNotesData,
  transactionReservedUpdateSchema,
  assignRoomAndCheckInSchema, AssignRoomAndCheckInData,
  transactionUnassignedUpdateSchema,
  roomCleaningStatusUpdateSchema,
  checkoutFormSchema,
} from '@/lib/schemas';
import { ROOM_AVAILABILITY_STATUS, TRANSACTION_STATUS, NOTIFICATION_STATUS, TRANSACTION_IS_ACCEPTED_STATUS, TRANSACTION_STATUS_TEXT, ROOM_CLEANING_STATUS, ROOM_CLEANING_STATUS_TEXT, ROOM_CLEANING_STATUS_OPTIONS } from '@/lib/constants'; 
import type { z } from 'zod';


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
  if (!rateId) {
    return { success: false, message: "Rate ID is required for booking." };
  }

  const { client_name, client_payment_method, notes } = validatedFields.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const transactionRes = await client.query(
      `INSERT INTO transactions (tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name, client_payment_method, notes, check_in_time, status, created_by_user_id, updated_at, created_at, is_admin_created, is_accepted)
       VALUES ($1, $2, $3, $4, $5, $6, $7, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), $8, $9, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), 0, ${TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED})
       RETURNING *`,
      [tenantId, branchId, roomId, rateId, client_name, client_payment_method, notes, TRANSACTION_STATUS.UNPAID, staffUserId]
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

    let rate_name = null;
    let rate_hours = null;
    if (newTransaction.hotel_rate_id) {
        const rateDetailsRes = await client.query('SELECT name, hours FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [newTransaction.hotel_rate_id, tenantId, branchId]);
        if (rateDetailsRes.rows.length > 0) {
            rate_name = rateDetailsRes.rows[0].name;
            rate_hours = parseInt(rateDetailsRes.rows[0].hours, 10);
        }
    }

    await client.query('COMMIT');
    return {
      success: true,
      message: "Guest checked in successfully and room occupied.",
      transaction: {
        ...newTransaction,
        room_name: (await client.query('SELECT room_name FROM hotel_room WHERE id = $1', [roomId])).rows[0]?.room_name,
        rate_name,
      } as Transaction,
      updatedRoomData: {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.OCCUPIED,
        transaction_id: newTransaction.id,
        active_transaction_client_name: newTransaction.client_name,
        active_transaction_check_in_time: newTransaction.check_in_time,
        active_transaction_rate_name: rate_name,
        active_transaction_rate_hours: rate_hours,
        active_transaction_status: newTransaction.status,
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

export async function updateRoomCleaningNotes(
    roomId: number,
    notes: string | null | undefined,
    tenantId: number,
    branchId: number,
    staffUserId: number
): Promise<{ success: boolean; message?: string; updatedRoom?: Pick<HotelRoom, 'id' | 'cleaning_notes'> }> {
    console.log(`[staff.ts:updateRoomCleaningNotes] Called with: roomId=${roomId}, notes=${notes === undefined ? 'undefined' : notes === null ? 'null' : `"${notes}"`}`);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const roomRes = await client.query(
            `UPDATE hotel_room
             SET cleaning_notes = $1, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
             WHERE id = $2 AND tenant_id = $3 AND branch_id = $4
             RETURNING id, cleaning_notes, cleaning_status`, 
            [notes, roomId, tenantId, branchId]
        );

        if (roomRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return { success: false, message: "Room not found or notes update failed." };
        }
        const updatedRoom = roomRes.rows[0];

        await client.query(
            `INSERT INTO room_cleaning_logs (room_id, room_cleaning_status, notes, user_id) VALUES ($1, $2, $3, $4)`,
            [roomId, updatedRoom.cleaning_status || ROOM_CLEANING_STATUS.CLEAN, notes, staffUserId]
        );

        await client.query('COMMIT');
        return {
            success: true,
            message: "Room cleaning notes updated successfully and logged.",
            updatedRoom: { 
                id: updatedRoom.id,
                cleaning_notes: updatedRoom.cleaning_notes,
            },
        };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Failed to update cleaning notes for room ${roomId}:`, error);
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
  if (!rateId) {
    return { success: false, message: "Rate ID is required for reservation." };
  }

  const { client_name, client_payment_method, notes } = validatedFields.data;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const transactionStatus = TRANSACTION_STATUS.ADVANCE_PAID; 

    const transactionRes = await client.query(
      `INSERT INTO transactions (tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name, client_payment_method, notes, check_in_time, status, created_by_user_id, updated_at, created_at, is_admin_created, is_accepted)
       VALUES ($1, $2, $3, $4, $5, $6, $7, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), $8, $9, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), 0, ${TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED})
       RETURNING *`,
      [tenantId, branchId, roomId, rateId, client_name, client_payment_method, notes, transactionStatus, staffUserId]
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

    let rate_name = null;
    let rate_hours = null;
    if (newTransaction.hotel_rate_id) {
        const rateDetailsRes = await client.query('SELECT name, hours FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [newTransaction.hotel_rate_id, tenantId, branchId]);
         if (rateDetailsRes.rows.length > 0) {
            rate_name = rateDetailsRes.rows[0].name;
            rate_hours = parseInt(rateDetailsRes.rows[0].hours, 10);
        }
    }

    await client.query('COMMIT');
    return {
      success: true,
      message: "Room reserved successfully.",
      transaction: {
        ...newTransaction,
        room_name: (await client.query('SELECT room_name FROM hotel_room WHERE id = $1', [roomId])).rows[0]?.room_name,
        rate_name,
      } as Transaction,
      updatedRoomData: {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.RESERVED,
        transaction_id: newTransaction.id,
        active_transaction_client_name: newTransaction.client_name,
        active_transaction_check_in_time: newTransaction.check_in_time,
        active_transaction_rate_name: rate_name,
        active_transaction_rate_hours: rate_hours,
        active_transaction_status: newTransaction.status,
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
      `SELECT t.*, 
              hr_room.room_name, 
              hrt.name as rate_name,
              hrt.price as rate_price,
              hrt.hours as rate_hours,
              hrt.excess_hour_price as rate_excess_hour_price
       FROM transactions t
       LEFT JOIN hotel_room hr_room ON t.hotel_room_id = hr_room.id AND hr_room.tenant_id = t.tenant_id AND hr_room.branch_id = t.branch_id
       LEFT JOIN hotel_rates hrt ON t.hotel_rate_id = hrt.id AND hrt.tenant_id = t.tenant_id AND hrt.branch_id = t.branch_id
       WHERE t.id = $1
         AND t.tenant_id = $2
         AND t.branch_id = $3
         AND (t.status = $4 OR t.status = $5 OR t.status = $6 OR t.status = $7) 
       ORDER BY t.created_at DESC LIMIT 1`,
      [transactionId, tenantId, branchId, TRANSACTION_STATUS.UNPAID, TRANSACTION_STATUS.ADVANCE_PAID, TRANSACTION_STATUS.ADVANCE_RESERVATION, TRANSACTION_STATUS.PENDING_BRANCH_ACCEPTANCE]
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
        `SELECT hr.room_name, hrt.name as rate_name, hrt.price as rate_price, hrt.hours as rate_hours, hrt.excess_hour_price as rate_excess_hour_price
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
          rate_price: detailsRes.rows.length > 0 ? parseFloat(detailsRes.rows[0].rate_price) : null,
          rate_hours: detailsRes.rows.length > 0 ? parseInt(detailsRes.rows[0].rate_hours, 10) : null,
          rate_excess_hour_price: detailsRes.rows.length > 0 && detailsRes.rows[0].rate_excess_hour_price ? parseFloat(detailsRes.rows[0].rate_excess_hour_price) : null,
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
  data: z.infer<typeof transactionReservedUpdateSchema>,
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
       WHERE id = $4 AND tenant_id = $5 AND branch_id = $6 AND (status = $7 OR status = $8 OR status = $9)
       RETURNING *`,
      [client_name, client_payment_method, notes, transactionId, tenantId, branchId, TRANSACTION_STATUS.ADVANCE_PAID, TRANSACTION_STATUS.ADVANCE_RESERVATION, TRANSACTION_STATUS.PENDING_BRANCH_ACCEPTANCE]
    );
    if (res.rows.length > 0) {
      const updatedRow = res.rows[0];
      const detailsRes = await client.query(
        `SELECT hr.room_name, hrt.name as rate_name, hrt.price as rate_price, hrt.hours as rate_hours, hrt.excess_hour_price as rate_excess_hour_price
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
          rate_price: detailsRes.rows.length > 0 ? parseFloat(detailsRes.rows[0].rate_price) : null,
          rate_hours: detailsRes.rows.length > 0 ? parseInt(detailsRes.rows[0].rate_hours, 10) : null,
          rate_excess_hour_price: detailsRes.rows.length > 0 && detailsRes.rows[0].rate_excess_hour_price ? parseFloat(detailsRes.rows[0].rate_excess_hour_price) : null,
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
  roomId: number,
  tenderAmount: number
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
      `SELECT t.*, h_rates.price as rate_price, h_rates.hours as rate_hours, h_rates.excess_hour_price as rate_excess_hour_price, h_rates.name as rate_name
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
    
    const checkOutTimeRes = await client.query("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') as db_check_out_time_val");
    const db_check_out_time_str = checkOutTimeRes.rows[0].db_check_out_time_val;

    const check_in_time = new Date(check_in_time_str.replace(' ', 'T') + 'Z');
    const check_out_time_obj = new Date(db_check_out_time_str.replace(' ', 'T') + 'Z');

    const diffMilliseconds = check_out_time_obj.getTime() - check_in_time.getTime();
    let hours_used = Math.ceil(diffMilliseconds / (1000 * 60 * 60));
    if (hours_used <= 0) hours_used = 1;

    let total_amount_calculated = parseFloat(transactionDetails.rate_price);
    const rate_hours_val = parseInt(transactionDetails.rate_hours, 10);
    const rate_excess_hour_price_val = transactionDetails.rate_excess_hour_price ? parseFloat(transactionDetails.rate_excess_hour_price) : null;

    if (hours_used > rate_hours_val) {
      const excess_hours = hours_used - rate_hours_val;
      if (rate_excess_hour_price_val && rate_excess_hour_price_val > 0) {
        total_amount_calculated += excess_hours * rate_excess_hour_price_val;
      }
    }
    
    if (hours_used > 0 && total_amount_calculated < parseFloat(transactionDetails.rate_price)) {
        total_amount_calculated = parseFloat(transactionDetails.rate_price);
    }

    const updatedTransactionRes = await client.query(
      `UPDATE transactions
       SET check_out_time = ($1::TEXT::TIMESTAMP WITHOUT TIME ZONE AT TIME ZONE 'Asia/Manila'),
           hours_used = $2,
           total_amount = $3,
           tender_amount = $4,
           check_out_by_user_id = $5,
           status = $6,
           updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $7
       RETURNING *`,
      [db_check_out_time_str, hours_used, total_amount_calculated, tenderAmount, staffUserId, TRANSACTION_STATUS.PAID, transactionId]
    );

    if (updatedTransactionRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update transaction record during check-out." };
    }
    const updatedTransaction = updatedTransactionRes.rows[0];

    const roomUpdateRes = await client.query(
      `UPDATE hotel_room
       SET is_available = $1, transaction_id = NULL, cleaning_status = $2, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $3 AND tenant_id = $4 AND branch_id = $5`,
      [ROOM_AVAILABILITY_STATUS.AVAILABLE, ROOM_CLEANING_STATUS.INSPECTION, roomId, tenantId, branchId]
    );

    if (roomUpdateRes.rowCount === 0) {
      console.warn(`Check-out successful for transaction ${transactionId}, but failed to update room ${roomId} status.`);
      await client.query('ROLLBACK');
      return { success: false, message: "Check-out processed for transaction, but failed to update room status. Please check manually." };
    }
    
    await client.query(
        `INSERT INTO room_cleaning_logs (room_id, room_cleaning_status, notes, user_id) VALUES ($1, $2, $3, $4)`,
        [roomId, ROOM_CLEANING_STATUS.INSPECTION, 'Room status set to Needs Inspection after checkout.', staffUserId]
    );

    await client.query('COMMIT');
    return {
      success: true,
      message: "Guest checked out successfully. Room set to 'Needs Inspection'.",
      transaction: {
        ...updatedTransaction,
        check_in_time: updatedTransaction.check_in_time,
        check_out_time: updatedTransaction.check_out_time,
        reserved_check_in_datetime: updatedTransaction.reserved_check_in_datetime,
        reserved_check_out_datetime: updatedTransaction.reserved_check_out_datetime,
        created_at: updatedTransaction.created_at,
        updated_at: updatedTransaction.updated_at,
        rate_name: transactionDetails.rate_name,
      } as Transaction,
      updatedRoomData: {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.AVAILABLE,
        transaction_id: null,
        active_transaction_id: null,
        active_transaction_client_name: null,
        active_transaction_check_in_time: null,
        active_transaction_rate_name: null,
        active_transaction_status: null,
        active_transaction_rate_hours: null,
        cleaning_status: ROOM_CLEANING_STATUS.INSPECTION, 
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
       WHERE id = $2 AND tenant_id = $3 AND branch_id = $4
       AND (status = $5 OR status = $6 OR status = $7 OR status = $8) 
       RETURNING hotel_room_id`,
      [TRANSACTION_STATUS.CANCELLED, transactionId, tenantId, branchId, TRANSACTION_STATUS.UNPAID, TRANSACTION_STATUS.ADVANCE_PAID, TRANSACTION_STATUS.ADVANCE_RESERVATION, TRANSACTION_STATUS.PENDING_BRANCH_ACCEPTANCE]
    );

    if (transactionUpdateRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Reservation not found, not in a cancellable status, or already cancelled." };
    }

    const actualRoomId = roomId ?? transactionUpdateRes.rows[0].hotel_room_id;
    let updatedRoomData: (Partial<HotelRoom> & { id: number }) | undefined = undefined;

    if (actualRoomId) {
      const roomUpdateRes = await client.query(
        `UPDATE hotel_room SET is_available = $1, transaction_id = NULL, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
         WHERE id = $2 AND tenant_id = $3 AND branch_id = $4 AND transaction_id = $5`,
        [ROOM_AVAILABILITY_STATUS.AVAILABLE, actualRoomId, tenantId, branchId, transactionId]
      );

      if (roomUpdateRes.rowCount === 0) {
        console.warn(`Reservation ${transactionId} cancelled, but room ${actualRoomId} was not updated (it might not have been linked to this transaction or was already updated).`);
      }
      updatedRoomData = {
        id: actualRoomId,
        is_available: ROOM_AVAILABILITY_STATUS.AVAILABLE,
        transaction_id: null,
        active_transaction_id: null,
        active_transaction_client_name: null,
        active_transaction_check_in_time: null,
        active_transaction_rate_name: null,
        active_transaction_status: null,
        active_transaction_rate_hours: null,
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

    const transactionCheckRes = await client.query(
      `SELECT client_name, hotel_rate_id, reserved_check_in_datetime, status as current_status
       FROM transactions
       WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND hotel_room_id = $4
       AND (status = $5 OR status = $6) 
       `,
      [transactionId, tenantId, branchId, roomId, TRANSACTION_STATUS.ADVANCE_PAID, TRANSACTION_STATUS.ADVANCE_RESERVATION]
    );

    if (transactionCheckRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Reservation not found for this room, already checked in, or not in a reservable status." };
    }
    const { client_name, hotel_rate_id, reserved_check_in_datetime, current_status } = transactionCheckRes.rows[0];

    let actualCheckInTimeValue: string;
    let checkInTimeQueryPart: string;
    let queryParams: any[] = [];

    if ( (current_status === TRANSACTION_STATUS.ADVANCE_RESERVATION || current_status === TRANSACTION_STATUS.ADVANCE_PAID ) && reserved_check_in_datetime) {
      actualCheckInTimeValue = reserved_check_in_datetime; 
      checkInTimeQueryPart = `$1::TIMESTAMP WITHOUT TIME ZONE`;
      queryParams.push(actualCheckInTimeValue);
    } else {
      const nowRes = await client.query(`SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') as now_val`);
      actualCheckInTimeValue = nowRes.rows[0].now_val;
      checkInTimeQueryPart = `($1::TEXT::TIMESTAMP WITHOUT TIME ZONE AT TIME ZONE 'Asia/Manila')`;
      queryParams.push(actualCheckInTimeValue);
    }
    
    const updateTransactionRes = await client.query(
      `UPDATE transactions
       SET status = $${queryParams.length + 1},
           check_in_time = ${checkInTimeQueryPart},
           updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $${queryParams.length + 2}
       RETURNING *`,
       [...queryParams, TRANSACTION_STATUS.UNPAID, transactionId]
    );

    if (updateTransactionRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update transaction status for check-in." };
    }
    const updatedTransaction = updateTransactionRes.rows[0];

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
    let rate_hours = null;
    if (hotel_rate_id) {
        const rateDetailsRes = await client.query('SELECT name, hours FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [hotel_rate_id, tenantId, branchId]);
        if (rateDetailsRes.rows.length > 0) {
            rate_name = rateDetailsRes.rows[0].name;
            rate_hours = parseInt(rateDetailsRes.rows[0].hours, 10);
        }
    }

    await client.query('COMMIT');
    return {
      success: true,
      message: "Reserved guest checked in successfully.",
      transaction: {
        ...updatedTransaction,
        check_in_time: actualCheckInTimeValue, 
        room_name: (await client.query('SELECT room_name FROM hotel_room WHERE id = $1', [roomId])).rows[0]?.room_name,
        rate_name,
      } as Transaction,
      updatedRoomData: {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.OCCUPIED,
        transaction_id: transactionId,
        active_transaction_client_name: client_name,
        active_transaction_check_in_time: actualCheckInTimeValue, 
        active_transaction_rate_name: rate_name,
        active_transaction_rate_hours: rate_hours,
        active_transaction_status: updatedTransaction.status,
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
       AND (t.status = $3 OR t.status = $4) 
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
        transactionStatus = TRANSACTION_STATUS.PENDING_BRANCH_ACCEPTANCE; 
        acceptedStatus = TRANSACTION_IS_ACCEPTED_STATUS.PENDING; 
    } else { 
        transactionStatus = is_advance_reservation ? TRANSACTION_STATUS.ADVANCE_RESERVATION : TRANSACTION_STATUS.ADVANCE_PAID; 
        acceptedStatus = TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED; 
    }

    const r_check_in = (is_advance_reservation && reserved_check_in_datetime) ? reserved_check_in_datetime : null;
    const r_check_out = (is_advance_reservation && reserved_check_out_datetime) ? reserved_check_out_datetime : null;
    const isAdminCreatedValue = is_admin_created_flag ? 1 : 0;

    const res = await client.query(
      `INSERT INTO transactions (
         tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name, client_payment_method,
         notes, status, created_by_user_id, reserved_check_in_datetime,
         reserved_check_out_datetime, updated_at, is_admin_created, is_accepted, created_at,
         check_in_time 
       )
       VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), $11, $12, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'),
         CASE 
           WHEN $7 = $13 THEN NULL -- Pending, no check-in yet
           ELSE (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') -- Not pending, set check-in
         END
       )
       RETURNING *`,
      [
        tenantId, branchId, selected_rate_id, client_name, client_payment_method, notes,
        transactionStatus, staffUserId,
        r_check_in, r_check_out, isAdminCreatedValue, acceptedStatus,
        TRANSACTION_STATUS.PENDING_BRANCH_ACCEPTANCE 
      ]
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

export async function listAvailableRoomsForBranch(tenantId: number, branchId: number): Promise<Array<Pick<HotelRoom, 'id' | 'room_name' | 'room_code' | 'hotel_rate_id'>>> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT id, room_name, room_code, hotel_rate_id FROM hotel_room
       WHERE tenant_id = $1 AND branch_id = $2 AND is_available = $3 AND status = '1' AND cleaning_status = $4
       ORDER BY floor ASC, room_code ASC`,
      [tenantId, branchId, ROOM_AVAILABILITY_STATUS.AVAILABLE, ROOM_CLEANING_STATUS.CLEAN]
    );
    return res.rows.map(row => ({
        id: row.id,
        room_name: row.room_name,
        room_code: row.room_code,
        hotel_rate_id: typeof row.hotel_rate_id === 'string' ? JSON.parse(row.hotel_rate_id) : (Array.isArray(row.hotel_rate_id) ? row.hotel_rate_id : [])
    }));
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

    const roomCheckRes = await client.query(
      `SELECT is_available, room_name, cleaning_status FROM hotel_room WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND status = '1'`,
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
    if (roomCheckRes.rows[0].cleaning_status !== ROOM_CLEANING_STATUS.CLEAN) {
      await client.query('ROLLBACK');
      return { success: false, message: `Selected room is not clean. Current status: ${ROOM_CLEANING_STATUS_TEXT[roomCheckRes.rows[0].cleaning_status]}.` };
    }
    const roomName = roomCheckRes.rows[0].room_name;

    const transactionCheckRes = await client.query(
      `SELECT client_name, hotel_rate_id, reserved_check_in_datetime, status as current_status, is_accepted
       FROM transactions
       WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND hotel_room_id IS NULL
       AND (status = $4 OR status = $5 OR status = $6 OR status = $7) 
       `,
      [transactionId, tenantId, branchId, TRANSACTION_STATUS.ADVANCE_PAID, TRANSACTION_STATUS.ADVANCE_RESERVATION, TRANSACTION_STATUS.PENDING_BRANCH_ACCEPTANCE, TRANSACTION_STATUS.UNPAID]
    );

    if (transactionCheckRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Reservation not found, already assigned, or not in a valid unassigned status." };
    }
    const { client_name, hotel_rate_id, reserved_check_in_datetime, current_status, is_accepted } = transactionCheckRes.rows[0];

    if (current_status === TRANSACTION_STATUS.PENDING_BRANCH_ACCEPTANCE && is_accepted !== TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED) {
      await client.query('ROLLBACK');
      return { success: false, message: "This reservation must be accepted by the branch before assigning a room." };
    }

    let actualCheckInTimeValue: string | null = null;
    let checkInTimeQueryPart: string;
    const queryParamsUpdateTx: any[] = [];

    // If it's an advance reservation with a set time, use that. Otherwise, use current time.
    if ((current_status === TRANSACTION_STATUS.ADVANCE_RESERVATION || current_status === TRANSACTION_STATUS.UNPAID) && reserved_check_in_datetime) {
        actualCheckInTimeValue = reserved_check_in_datetime;
        checkInTimeQueryPart = `$${queryParamsUpdateTx.length + 1}::TIMESTAMP WITHOUT TIME ZONE`;
        queryParamsUpdateTx.push(actualCheckInTimeValue);
    } else {
        const nowRes = await client.query("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') as now_val");
        actualCheckInTimeValue = nowRes.rows[0].now_val;
        checkInTimeQueryPart = `($${queryParamsUpdateTx.length + 1}::TEXT::TIMESTAMP WITHOUT TIME ZONE AT TIME ZONE 'Asia/Manila')`;
        queryParamsUpdateTx.push(actualCheckInTimeValue);
    }


    const updateTransactionRes = await client.query(
      `UPDATE transactions
       SET status = $${queryParamsUpdateTx.length + 1},
           hotel_room_id = $${queryParamsUpdateTx.length + 2},
           check_in_time = ${checkInTimeQueryPart},
           is_accepted = $${queryParamsUpdateTx.length + 3}, 
           updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $${queryParamsUpdateTx.length + 4}
       RETURNING *`,
       [...queryParamsUpdateTx, TRANSACTION_STATUS.UNPAID, roomId, TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED, transactionId]
    );

    if (updateTransactionRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update transaction for check-in." };
    }
    const updatedTransaction = updateTransactionRes.rows[0];

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
    let rate_hours = null;
    if (hotel_rate_id) {
        const rateDetailsRes = await client.query('SELECT name, hours FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [hotel_rate_id, tenantId, branchId]);
        if (rateDetailsRes.rows.length > 0) {
          rate_name = rateDetailsRes.rows[0].name;
          rate_hours = parseInt(rateDetailsRes.rows[0].hours, 10);
        }
    }

    await client.query('COMMIT');
    return {
      success: true,
      message: "Guest from reservation checked in successfully.",
      transaction: {
        ...updatedTransaction,
        check_in_time: actualCheckInTimeValue, 
        room_name: roomName,
        rate_name,
      } as Transaction,
      updatedRoomData: {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.OCCUPIED,
        transaction_id: transactionId,
        active_transaction_client_name: client_name,
        active_transaction_check_in_time: actualCheckInTimeValue, 
        active_transaction_rate_name: rate_name,
        active_transaction_rate_hours: rate_hours,
        active_transaction_status: updatedTransaction.status,
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
    const currentTransactionRes = await client.query('SELECT status, is_admin_created FROM transactions WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [transactionId, tenantId, branchId]);
    if (currentTransactionRes.rows.length === 0) {
      return { success: false, message: "Transaction not found." };
    }
    const currentStatus = currentTransactionRes.rows[0].status;
    const isAdminCreated = currentTransactionRes.rows[0].is_admin_created === 1;

    let newStatus = currentStatus;
    
    if (!isAdminCreated || currentStatus !== TRANSACTION_STATUS.PENDING_BRANCH_ACCEPTANCE) { 
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
       AND (status = $11 OR status = $12 OR status = $13)
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
        } as Transaction,
      };
    }
    return { success: false, message: "Unassigned reservation not found, not in an editable status, or update failed." };
  } catch (error) {
    console.error(`Failed to update unassigned reservation ${transactionId}:`, error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}

export async function listNotificationsForBranch(tenantId: number, branchId: number): Promise<Notification[]> {
  if (isNaN(tenantId) || tenantId <= 0 || isNaN(branchId) || branchId <= 0) return [];
  const client = await pool.connect();
  try {
    const query = `
      SELECT
        n.id, n.tenant_id, n.message, n.status,
        n.target_branch_id, tb.branch_name as target_branch_name,
        n.creator_user_id, u.username as creator_username,
        n.transaction_id, t.is_accepted as transaction_is_accepted, t.status as linked_transaction_status,
        n.created_at, n.read_at, n.transaction_status
       FROM notification n
       LEFT JOIN tenant_branch tb ON n.target_branch_id = tb.id AND tb.tenant_id = n.tenant_id
       LEFT JOIN users u ON n.creator_user_id = u.id
       LEFT JOIN transactions t ON n.transaction_id = t.id AND t.tenant_id = n.tenant_id
       WHERE n.tenant_id = $1 AND (n.target_branch_id = $2 OR n.target_branch_id IS NULL)
       ORDER BY n.created_at DESC`;
    const res = await client.query(query, [tenantId, branchId]);
    return res.rows.map(row => ({
        ...row,
        status: Number(row.status),
        transaction_status: Number(row.transaction_status),
        transaction_is_accepted: row.transaction_is_accepted !== null ? Number(row.transaction_is_accepted) : null,
        linked_transaction_status: row.linked_transaction_status,
    })) as Notification[];
  } catch (error) {
    console.error(`Failed to fetch notifications for branch ${branchId} of tenant ${tenantId}:`, error);
    throw new Error(`Database error: Could not fetch notifications. ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}

export async function markStaffNotificationAsRead(notificationId: number, tenantId: number, branchId: number): Promise<{ success: boolean; message?: string; notification?: Notification }> {
  const client = await pool.connect();
  try {
    const checkRes = await client.query('SELECT target_branch_id FROM notification WHERE id = $1 AND tenant_id = $2', [notificationId, tenantId]);
    if (checkRes.rows.length === 0 || (checkRes.rows[0].target_branch_id !== null && checkRes.rows[0].target_branch_id !== branchId)) {
        return { success: false, message: "Notification not found or not targeted to this branch/tenant."};
    }

    const res = await client.query(
      `UPDATE notification
       SET status = $1, read_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $2 AND tenant_id = $3 AND (target_branch_id = $4 OR target_branch_id IS NULL)
       RETURNING id`,
      [NOTIFICATION_STATUS.READ, notificationId, tenantId, branchId]
    );
    if (res.rows.length > 0) {
      const fullNotificationRes = await client.query(
        `SELECT
          n.id, n.tenant_id, n.message, n.status,
          n.target_branch_id, tb.branch_name as target_branch_name,
          n.creator_user_id, u.username as creator_username,
          n.transaction_id, t.is_accepted as transaction_is_accepted, t.status as linked_transaction_status,
          n.created_at, n.read_at, n.transaction_status
         FROM notification n
         LEFT JOIN tenant_branch tb ON n.target_branch_id = tb.id AND tb.tenant_id = n.tenant_id
         LEFT JOIN users u ON n.creator_user_id = u.id
         LEFT JOIN transactions t ON n.transaction_id = t.id AND t.tenant_id = n.tenant_id
         WHERE n.id = $1`, [res.rows[0].id]
      );
      return {
        success: true,
        message: "Notification marked as read.",
        notification: {
            ...fullNotificationRes.rows[0],
            status: Number(fullNotificationRes.rows[0].status),
            transaction_status: Number(fullNotificationRes.rows[0].transaction_status),
            transaction_is_accepted: fullNotificationRes.rows[0].transaction_is_accepted !== null ? Number(fullNotificationRes.rows[0].transaction_is_accepted) : null,
            linked_transaction_status: fullNotificationRes.rows[0].linked_transaction_status,
        } as Notification
      };
    }
    return { success: false, message: "Notification not found or no change made." };
  } catch (error) {
    console.error(`Failed to mark notification ${notificationId} as read by staff:`, error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}

export async function acceptReservationByStaff(
    transactionId: number,
    data: TransactionUnassignedUpdateData,
    tenantId: number,
    branchId: number,
    staffUserId: number
): Promise<{ success: boolean; message?: string; updatedTransaction?: Transaction }> {
    const validatedFields = transactionUnassignedUpdateSchema.safeParse(data);
    if (!validatedFields.success) {
        return { success: false, message: `Invalid data for reservation acceptance: ${JSON.stringify(validatedFields.error.flatten().fieldErrors)}` };
    }
    const { client_name, selected_rate_id, client_payment_method, notes, is_advance_reservation, reserved_check_in_datetime, reserved_check_out_datetime } = validatedFields.data;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const transactionCheckRes = await client.query(
            `SELECT status FROM transactions WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND is_admin_created = 1`,
            [transactionId, tenantId, branchId]
        );

        if (transactionCheckRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return { success: false, message: "Admin-created reservation not found in this branch." };
        }
         if (transactionCheckRes.rows[0].status !== TRANSACTION_STATUS.PENDING_BRANCH_ACCEPTANCE) {
            await client.query('ROLLBACK');
            return { success: false, message: "This reservation is not pending branch acceptance." };
        }

        const newTransactionStatus = is_advance_reservation ? TRANSACTION_STATUS.ADVANCE_RESERVATION : TRANSACTION_STATUS.ADVANCE_PAID;


        const r_check_in = (is_advance_reservation && reserved_check_in_datetime) ? reserved_check_in_datetime : null;
        const r_check_out = (is_advance_reservation && reserved_check_out_datetime) ? reserved_check_out_datetime : null;

        const res = await client.query(
            `UPDATE transactions
             SET client_name = $1, hotel_rate_id = $2, client_payment_method = $3, notes = $4,
                 status = $5, reserved_check_in_datetime = $6, reserved_check_out_datetime = $7,
                 is_accepted = $8, accepted_by_user_id = $9, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
             WHERE id = $10 AND tenant_id = $11 AND branch_id = $12
             RETURNING *`,
            [
                client_name, selected_rate_id, client_payment_method, notes,
                newTransactionStatus, r_check_in, r_check_out,
                TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED, staffUserId,
                transactionId, tenantId, branchId
            ]
        );

        if (res.rows.length > 0) {
            await client.query('COMMIT');
            const updatedRow = res.rows[0];
            let rate_name = null;
            if (updatedRow.hotel_rate_id) {
                const rateNameRes = await client.query('SELECT name FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [updatedRow.hotel_rate_id, tenantId, branchId]);
                rate_name = rateNameRes.rows.length > 0 ? rateNameRes.rows[0].name : null;
            }
            return {
                success: true,
                message: "Reservation accepted and updated successfully.",
                updatedTransaction: {
                    ...updatedRow,
                    rate_name,
                 } as Transaction,
            };
        } else {
            await client.query('ROLLBACK');
            return { success: false, message: "Failed to accept reservation." };
        }
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Failed to accept reservation ${transactionId}:`, error);
        return { success: false, message: `Database error during acceptance: ${error instanceof Error ? error.message : String(error)}` };
    } finally {
        client.release();
    }
}

export async function declineReservationByStaff(
    transactionId: number,
    tenantId: number,
    branchId: number,
    staffUserId: number
): Promise<{ success: boolean; message?: string; updatedTransaction?: Transaction }> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const transactionCheckRes = await client.query(
            `SELECT status FROM transactions WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND is_admin_created = 1`,
            [transactionId, tenantId, branchId]
        );

        if (transactionCheckRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return { success: false, message: "Admin-created reservation not found in this branch." };
        }
         if (transactionCheckRes.rows[0].status !== TRANSACTION_STATUS.PENDING_BRANCH_ACCEPTANCE) {
            await client.query('ROLLBACK');
            return { success: false, message: "This reservation is not pending branch acceptance." };
        }

        const res = await client.query(
            `UPDATE transactions
             SET status = $1, is_accepted = $2, declined_by_user_id = $3, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
             WHERE id = $4 AND tenant_id = $5 AND branch_id = $6
             RETURNING *`,
            [
                TRANSACTION_STATUS.CANCELLED, TRANSACTION_IS_ACCEPTED_STATUS.NOT_ACCEPTED, staffUserId,
                transactionId, tenantId, branchId
            ]
        );

        if (res.rows.length > 0) {
            await client.query('COMMIT');
            const updatedRow = res.rows[0];
            return {
                success: true,
                message: "Reservation declined successfully.",
                updatedTransaction: { ...updatedRow } as Transaction,
            };
        } else {
            await client.query('ROLLBACK');
            return { success: false, message: "Failed to decline reservation." };
        }
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Failed to decline reservation ${transactionId}:`, error);
        return { success: false, message: `Database error during decline: ${error instanceof Error ? error.message : String(error)}` };
    } finally {
        client.release();
    }
}

export async function updateRoomCleaningStatus(
    roomId: number,
    tenantId: number,
    branchId: number,
    newCleaningStatus: string,
    staffUserId: number
): Promise<{ success: boolean; message?: string; updatedRoom?: Pick<HotelRoom, 'id' | 'cleaning_status'> }> {
    const validatedSchema = roomCleaningStatusUpdateSchema.safeParse({ cleaning_status: newCleaningStatus });
    if (!validatedSchema.success) {
        return { success: false, message: `Invalid cleaning status: ${JSON.stringify(validatedSchema.error.flatten().fieldErrors)}` };
    }
     const isValidStatus = ROOM_CLEANING_STATUS_OPTIONS.some(option => option.value === newCleaningStatus);
    if (!isValidStatus) {
        return { success: false, message: `Invalid cleaning status provided: ${newCleaningStatus}` };
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const updateRoomRes = await client.query(
            `UPDATE hotel_room
             SET cleaning_status = $1, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
             WHERE id = $2 AND tenant_id = $3 AND branch_id = $4
             RETURNING id, cleaning_status`,
            [newCleaningStatus, roomId, tenantId, branchId]
        );

        if (updateRoomRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return { success: false, message: "Room not found or no change made to cleaning status." };
        }
        
        const logNote = `Status set to ${ROOM_CLEANING_STATUS_TEXT[newCleaningStatus] || newCleaningStatus} by staff.`;

        await client.query(
            `INSERT INTO room_cleaning_logs (room_id, room_cleaning_status, notes, user_id) VALUES ($1, $2, $3, $4)`,
            [roomId, newCleaningStatus, logNote, staffUserId]
        );

        await client.query('COMMIT');
        return {
            success: true,
            message: "Room cleaning status updated and logged successfully.",
            updatedRoom: updateRoomRes.rows[0] as Pick<HotelRoom, 'id' | 'cleaning_status'>
        };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Failed to update cleaning status for room ${roomId}:`, error);
        const displayError = ROOM_CLEANING_STATUS_TEXT[newCleaningStatus] ? `Database error: ${error instanceof Error ? error.message : String(error)}` : `Database error (constants missing for ${newCleaningStatus}): ${error instanceof Error ? error.message : String(error)}`;
        return { success: false, message: displayError };
    } finally {
        client.release();
    }
}
    
