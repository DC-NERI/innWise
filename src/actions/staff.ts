
"use server";

import pg from 'pg';
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE
pg.types.setTypeParser(20, (stringValue) => parseInt(stringValue, 10));
pg.types.setTypeParser(1700, (stringValue) => parseFloat(stringValue));


import { Pool } from 'pg';
import type { Transaction, HotelRoom, SimpleRate, Notification, GroupedRooms, LostAndFoundLog } from '@/lib/types';
import {
  transactionCreateSchema,
  transactionUpdateNotesSchema, TransactionUpdateNotesData,
  transactionReservedUpdateSchema,
  assignRoomAndCheckInSchema, AssignRoomAndCheckInData,
  transactionUnassignedUpdateSchema, TransactionUnassignedUpdateData,
  roomCleaningStatusAndNotesUpdateSchema, RoomCleaningStatusUpdateData,
  checkoutFormSchema, CheckoutFormData,
  lostAndFoundCreateSchema, LostAndFoundCreateData,
  lostAndFoundUpdateStatusSchema, LostAndFoundUpdateStatusData,
} from '@/lib/schemas';
import {
  ROOM_AVAILABILITY_STATUS,
  TRANSACTION_LIFECYCLE_STATUS,
  NOTIFICATION_STATUS,
  TRANSACTION_IS_ACCEPTED_STATUS,
  ROOM_CLEANING_STATUS,
  ROOM_CLEANING_STATUS_TEXT,
  NOTIFICATION_STATUS_TEXT,
  TRANSACTION_LIFECYCLE_STATUS_TEXT,
  TRANSACTION_IS_ACCEPTED_STATUS_TEXT,
  TRANSACTION_PAYMENT_STATUS,
  TRANSACTION_PAYMENT_STATUS_TEXT,
  HOTEL_ENTITY_STATUS,
  LOST_AND_FOUND_STATUS
} from '@/lib/constants';
import type { z } from 'zod';
import { format as formatDateTime, parseISO, addHours as dateFnsAddHours, differenceInMilliseconds } from 'date-fns';


const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in staff actions', err);
});

export async function createTransactionAndOccupyRoom(
  data: z.infer<typeof transactionCreateSchema>, // Use the base schema type
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
    const errorMessage = "Invalid data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
    return { success: false, message: errorMessage };
  }
  if (!rateId) {
    return { success: false, message: "Rate ID is required for booking." };
  }

  const { client_name, client_payment_method, notes, is_paid, tender_amount_at_checkin } = validatedFields.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const finalTransactionLifecycleStatus = TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN;
    const finalPaymentStatus = data.is_paid ? TRANSACTION_PAYMENT_STATUS.PAID : TRANSACTION_PAYMENT_STATUS.UNPAID;

    let finalTotalAmount = null;
    let finalTenderAmount = null;
    let rate_name = null;
    let rate_hours_val = null;
    let check_out_time_val = null; // Will be set if paid upfront for fixed duration
    let hours_used_val = null;     // Will be set if paid upfront for fixed duration

    const rateDetailsRes = await client.query(
        'SELECT name, price, hours FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND status::INTEGER = $4',
        [rateId, tenantId, branchId, Number(HOTEL_ENTITY_STATUS.ACTIVE)]
    );
    if (rateDetailsRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, message: "Selected rate not found or inactive." };
    }
    const rateDetails = rateDetailsRes.rows[0];
    rate_name = rateDetails.name;
    rate_hours_val = parseInt(rateDetails.hours, 10);

    if (data.is_paid) {
      finalTotalAmount = parseFloat(rateDetails.price);
      finalTenderAmount = tender_amount_at_checkin;
      // If paid upfront, it might imply the transaction covers the full initial rate duration
      // However, the lifecycle status remains CHECKED_IN. Checkout time and hours_used are only set at actual checkout.
    }

    const transactionRes = await client.query(
      `INSERT INTO transactions (
         tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name, client_payment_method, notes,
         check_in_time, status, created_by_user_id, updated_at, created_at, is_accepted,
         is_paid, tender_amount, total_amount, check_out_time, hours_used
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), $8, $9, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        tenantId, branchId, roomId, rateId, client_name, client_payment_method, notes,
        finalTransactionLifecycleStatus.toString(),
        staffUserId,
        TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED, // Staff bookings are auto-accepted by branch
        finalPaymentStatus,
        finalTenderAmount,
        finalTotalAmount,
        check_out_time_val, // NULL unless logic changes to pre-set it
        hours_used_val,     // NULL unless logic changes to pre-set it
      ]
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

    await client.query('COMMIT');
    return {
      success: true,
      message: "Guest checked in successfully and room occupied.",
      transaction: {
        ...newTransaction,
        status: Number(newTransaction.status),
        is_paid: Number(newTransaction.is_paid),
        is_accepted: Number(newTransaction.is_accepted),
        is_admin_created: Number(newTransaction.is_admin_created),
        check_in_time: newTransaction.check_in_time, // Will be string from DB
        room_name: (await client.query('SELECT room_name FROM hotel_room WHERE id = $1', [roomId])).rows[0]?.room_name,
        rate_name,
      } as Transaction,
      updatedRoomData: {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.OCCUPIED,
        transaction_id: newTransaction.id,
        active_transaction_id: newTransaction.id,
        active_transaction_client_name: newTransaction.client_name,
        active_transaction_check_in_time: newTransaction.check_in_time,
        active_transaction_rate_name: rate_name,
        active_transaction_rate_hours: rate_hours_val,
        active_transaction_status: Number(newTransaction.status),
      }
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[createTransactionAndOccupyRoom DB Error]', error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}


export async function updateRoomCleaningStatus(
    roomId: number,
    tenantId: number,
    branchId: number,
    newCleaningStatus: number,
    newNotes: string | null | undefined,
    staffUserId: number
): Promise<{ success: boolean; message?: string; updatedRoom?: Pick<HotelRoom, 'id' | 'cleaning_status' | 'cleaning_notes'> }> {
    const validatedSchema = roomCleaningStatusAndNotesUpdateSchema.safeParse({ cleaning_status: newCleaningStatus, cleaning_notes: newNotes });
    if (!validatedSchema.success) {
        const errorMessage = "Invalid data: " + JSON.stringify(validatedSchema.error.flatten().fieldErrors);
        return { success: false, message: errorMessage };
    }
    const { cleaning_status: validatedStatus, cleaning_notes: validatedNotes } = validatedSchema.data;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const updateRoomRes = await client.query(
            `UPDATE hotel_room
             SET cleaning_status = $1, cleaning_notes = $2, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
             WHERE id = $3 AND tenant_id = $4 AND branch_id = $5
             RETURNING id, cleaning_status, cleaning_notes`,
            [validatedStatus, validatedNotes, roomId, tenantId, branchId]
        );

        if (updateRoomRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return { success: false, message: "Room not found or no change made to cleaning status/notes." };
        }

        await client.query(
            `INSERT INTO room_cleaning_logs (room_id, room_cleaning_status, notes, user_id, created_at)
             VALUES ($1, $2, $3, $4, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'))`,
            [roomId, validatedStatus.toString(), validatedNotes, staffUserId]
        );

        await client.query('COMMIT');
        return {
            success: true,
            message: "Room cleaning status and notes updated and logged successfully.",
            updatedRoom: {
                id: Number(updateRoomRes.rows[0].id),
                cleaning_status: Number(updateRoomRes.rows[0].cleaning_status),
                cleaning_notes: updateRoomRes.rows[0].cleaning_notes,
            }
        };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`[updateRoomCleaningStatus DB Error] Failed to update cleaning status for room ${roomId}:`, error);
        const displayError = `Database error: ${error instanceof Error ? error.message : String(error)}`;
        return { success: false, message: displayError };
    } finally {
        client.release();
    }
}


export async function createReservation(
  data: z.infer<typeof transactionCreateSchema>, // Use the base schema type
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
    const errorMessage = "Invalid data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
    return { success: false, message: errorMessage };
  }
  if (!rateId) {
    return { success: false, message: "Rate ID is required for reservation." };
  }

  const { client_name, client_payment_method, notes, is_paid, tender_amount_at_checkin, is_advance_reservation, reserved_check_in_datetime, reserved_check_out_datetime } = validatedFields.data;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const transactionLifecycleStatus = TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM;
    const finalPaymentStatus = data.is_paid ? TRANSACTION_PAYMENT_STATUS.PAID : TRANSACTION_PAYMENT_STATUS.UNPAID;
    let finalTotalAmount = null;
    let finalTenderAmount = null;

    let rate_name = null;
    let rate_hours_val = null;

     const rateDetailsRes = await client.query(
        'SELECT name, price, hours FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND status::INTEGER = $4',
        [rateId, tenantId, branchId, Number(HOTEL_ENTITY_STATUS.ACTIVE)]
     );
      if (rateDetailsRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, message: "Selected rate not found or inactive for reservation." };
      }
      const rateDetails = rateDetailsRes.rows[0];
      rate_name = rateDetails.name;
      rate_hours_val = parseInt(rateDetails.hours, 10);

    if (data.is_paid) {
      finalTotalAmount = parseFloat(rateDetails.price);
      finalTenderAmount = tender_amount_at_checkin;
    }

    const transactionRes = await client.query(
      `INSERT INTO transactions (
         tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name, client_payment_method, notes,
         check_in_time, status, created_by_user_id, updated_at, created_at, is_accepted,
         is_paid, tender_amount, total_amount,
         reserved_check_in_datetime, reserved_check_out_datetime
        )
       VALUES ($1, $2, $3, $4, $5, $6, $7, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), $8, $9, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        tenantId, branchId, roomId, rateId, client_name, client_payment_method, notes,
        transactionLifecycleStatus.toString(),
        staffUserId,
        TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED,
        finalPaymentStatus,
        finalTenderAmount,
        finalTotalAmount,
        reserved_check_in_datetime,
        reserved_check_out_datetime
      ]
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

    await client.query('COMMIT');
    return {
      success: true,
      message: "Room reserved successfully.",
      transaction: {
        ...newTransaction,
        status: Number(newTransaction.status),
        is_paid: Number(newTransaction.is_paid),
        is_accepted: Number(newTransaction.is_accepted),
        is_admin_created: Number(newTransaction.is_admin_created),
        check_in_time: newTransaction.check_in_time,
        room_name: (await client.query('SELECT room_name FROM hotel_room WHERE id = $1', [roomId])).rows[0]?.room_name,
        rate_name,
      } as Transaction,
      updatedRoomData: {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.RESERVED,
        transaction_id: newTransaction.id,
        active_transaction_id: newTransaction.id,
        active_transaction_client_name: newTransaction.client_name,
        active_transaction_check_in_time: newTransaction.check_in_time,
        active_transaction_rate_name: rate_name,
        active_transaction_rate_hours: rate_hours_val,
        active_transaction_status: Number(newTransaction.status),
      }
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[createReservation DB Error]', error);
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
  const client = await pool.connect();
  try {
    const query = `
      SELECT t.*,
             hr_room.room_name,
             hrt.name as rate_name,
             hrt.price as rate_price,
             hrt.hours as rate_hours,
             hrt.excess_hour_price as rate_excess_hour_price,
             cb_user.username as created_by_username,
             co_user.username as checked_out_by_username,
             ac_user.username as accepted_by_username,
             dec_user.username as declined_by_username
      FROM transactions t
      LEFT JOIN hotel_room hr_room ON t.hotel_room_id = hr_room.id AND hr_room.tenant_id = t.tenant_id AND hr_room.branch_id = t.branch_id
      LEFT JOIN hotel_rates hrt ON t.hotel_rate_id = hrt.id AND hrt.tenant_id = t.tenant_id AND hrt.branch_id = t.branch_id
      LEFT JOIN users cb_user ON t.created_by_user_id = cb_user.id
      LEFT JOIN users co_user ON t.check_out_by_user_id = co_user.id
      LEFT JOIN users ac_user ON t.accepted_by_user_id = ac_user.id
      LEFT JOIN users dec_user ON t.declined_by_user_id = dec_user.id
      WHERE t.id = $1
        AND t.tenant_id = $2
        AND t.branch_id = $3
        AND (
          t.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN} OR
          t.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM} OR
          t.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM} OR
          t.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.RESERVATION_ADMIN_CREATED_PENDING_BRANCH_ACCEPTANCE}
        )
      ORDER BY t.created_at DESC LIMIT 1
    `; // Status check ensures we get currently active or pending reservations
    const res = await client.query(query, [transactionId, tenantId, branchId]);
    if (res.rows.length > 0) {
      const row = res.rows[0];
      return {
        ...row,
        status: Number(row.status),
        is_paid: row.is_paid !== null ? Number(row.is_paid) : null,
        is_accepted: row.is_accepted !== null ? Number(row.is_accepted) : null,
        is_admin_created: row.is_admin_created !== null ? Number(row.is_admin_created) : null,
      } as Transaction;
    }
    return null;
  } catch (error) {
    console.error(`[getActiveTransactionForRoom DB Error] Error fetching transaction details for transaction ID ${transactionId}:`, error);
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
          status: Number(updatedRow.status),
          is_paid: updatedRow.is_paid !== null ? Number(updatedRow.is_paid) : null,
          is_accepted: updatedRow.is_accepted !== null ? Number(updatedRow.is_accepted) : null,
          is_admin_created: updatedRow.is_admin_created !== null ? Number(updatedRow.is_admin_created) : null,
          room_name,
          rate_name,
          rate_price: detailsRes.rows.length > 0 && detailsRes.rows[0].rate_price ? parseFloat(detailsRes.rows[0].rate_price) : null,
          rate_hours: detailsRes.rows.length > 0 && detailsRes.rows[0].rate_hours ? parseInt(detailsRes.rows[0].rate_hours, 10) : null,
          rate_excess_hour_price: detailsRes.rows.length > 0 && detailsRes.rows[0].rate_excess_hour_price ? parseFloat(detailsRes.rows[0].rate_excess_hour_price) : null,
        } as Transaction,
      };
    }
    return { success: false, message: "Transaction not found or notes update failed." };
  } catch (error) {
    console.error(`[updateTransactionNotes DB Error] Failed to update notes for transaction ${transactionId}:`, error);
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
    const errorMessage = "Invalid data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
    return { success: false, message: errorMessage };
  }
  const { client_name, selected_rate_id, client_payment_method, notes } = validatedFields.data;
  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE transactions
       SET client_name = $1, client_payment_method = $2, notes = $3, hotel_rate_id = $4, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $5 AND tenant_id = $6 AND branch_id = $7 AND (status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM} OR status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM} OR status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.RESERVATION_ADMIN_CREATED_PENDING_BRANCH_ACCEPTANCE})
       RETURNING *`,
      [client_name, client_payment_method, notes, selected_rate_id, transactionId, tenantId, branchId]
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
          status: Number(updatedRow.status),
          is_paid: updatedRow.is_paid !== null ? Number(updatedRow.is_paid) : null,
          is_accepted: updatedRow.is_accepted !== null ? Number(updatedRow.is_accepted) : null,
          is_admin_created: updatedRow.is_admin_created !== null ? Number(updatedRow.is_admin_created) : null,
          room_name,
          rate_name,
          rate_price: detailsRes.rows.length > 0 && detailsRes.rows[0].rate_price ? parseFloat(detailsRes.rows[0].rate_price) : null,
          rate_hours: detailsRes.rows.length > 0 && detailsRes.rows[0].rate_hours ? parseInt(detailsRes.rows[0].rate_hours, 10) : null,
          rate_excess_hour_price: detailsRes.rows.length > 0 && detailsRes.rows[0].rate_excess_hour_price ? parseFloat(detailsRes.rows[0].rate_excess_hour_price) : null,
        } as Transaction,
      };
    }
    return { success: false, message: "Transaction not found, not in an editable reservation status, or update failed." };
  } catch (error) {
    console.error(`[updateReservedTransactionDetails DB Error] Failed to update transaction ${transactionId}:`, error);
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
  data: CheckoutFormData
): Promise<{
  success: boolean;
  message?: string;
  transaction?: Transaction;
  updatedRoomData?: Partial<HotelRoom> & { id: number }
}> {
   const validatedFields = checkoutFormSchema.safeParse(data);
    if (!validatedFields.success) {
        return { success: false, message: "Invalid checkout data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors) };
    }
    const { tender_amount, payment_method } = validatedFields.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const debugTxRes = await client.query('SELECT status, is_paid, total_amount, tender_amount as current_tender_amount FROM transactions WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [transactionId, tenantId, branchId]);
    if (debugTxRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, message: "Transaction not found or doesn't belong to this tenant/branch." };
    }
    const { status: currentStatus, is_paid: currentIsPaid, total_amount: currentTotalAmount, current_tender_amount: currentDbTenderAmount } = debugTxRes.rows[0];

    if (Number(currentStatus) !== TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN) {
         await client.query('ROLLBACK');
         return { success: false, message: `Transaction is not in 'Checked-In' state. Current status: ${TRANSACTION_LIFECYCLE_STATUS_TEXT[Number(currentStatus) as keyof typeof TRANSACTION_LIFECYCLE_STATUS_TEXT] || 'Unknown'}.` };
    }

    const transactionAndRateRes = await client.query(
      `SELECT t.*,
              h_rates.price as rate_price,
              h_rates.hours as rate_hours,
              h_rates.excess_hour_price as rate_excess_hour_price,
              h_rates.name as rate_name
       FROM transactions t
       JOIN hotel_rates h_rates ON t.hotel_rate_id = h_rates.id
       WHERE t.id = $1 AND t.tenant_id = $2 AND t.branch_id = $3 AND t.hotel_room_id = $4
       AND t.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN} AND t.check_out_time IS NULL`,
      [transactionId, tenantId, branchId, roomId]
    );

    if (transactionAndRateRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Active transaction for this room not found, already checked out, or not in 'Checked-In' state." };
    }
    const transactionDetails = transactionAndRateRes.rows[0];
    const check_in_time_str = transactionDetails.check_in_time;

    const now = new Date();
    const db_check_out_time_str = formatDateTime(now, "yyyy-MM-dd HH:mm:ss");

    const check_in_time_dt = parseISO(check_in_time_str.replace(' ', 'T')); // DB string is space separated
    const check_out_time_dt = parseISO(db_check_out_time_str.replace(' ', 'T'));

    const diffMillisecondsVal = differenceInMilliseconds(check_out_time_dt, check_in_time_dt);
    let hours_used_calc = Math.ceil(diffMillisecondsVal / (1000 * 60 * 60));
    if (hours_used_calc <= 0) hours_used_calc = 1;

    let final_total_amount_calculated = parseFloat(transactionDetails.rate_price);
    const rate_hours_val = parseInt(transactionDetails.rate_hours, 10);
    const rate_excess_hour_price_val = transactionDetails.rate_excess_hour_price ? parseFloat(transactionDetails.rate_excess_hour_price) : null;

    if (hours_used_calc > rate_hours_val && rate_excess_hour_price_val && rate_excess_hour_price_val > 0) {
        final_total_amount_calculated = parseFloat(transactionDetails.rate_price) + (hours_used_calc - rate_hours_val) * rate_excess_hour_price_val;
    } else {
        final_total_amount_calculated = parseFloat(transactionDetails.rate_price);
    }

    // Ensure total amount is at least the base rate price if any time was used
    if (hours_used_calc > 0 && final_total_amount_calculated < parseFloat(transactionDetails.rate_price)) {
        final_total_amount_calculated = parseFloat(transactionDetails.rate_price);
    }

    // The tender_amount for this update is the amount paid AT THIS CHECKOUT.
    // If a payment was made upfront, it should be considered.
    // For simplicity here, we assume tender_amount is for the remaining balance or full amount if not paid.
    // A more complex system would sum up payments.
    // We will update `client_payment_method` with the one used at checkout.

    const updatedTransactionRes = await client.query(
      `UPDATE transactions
       SET check_out_time = ($1::TEXT::TIMESTAMP WITHOUT TIME ZONE AT TIME ZONE 'Asia/Manila'),
           hours_used = $2,
           total_amount = $3,
           tender_amount = $4, -- This is the tender amount for this specific checkout operation
           client_payment_method = $5,
           check_out_by_user_id = $6,
           status = $7,
           is_paid = $8,
           updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $9
       RETURNING *`,
      [
        db_check_out_time_str,
        hours_used_calc,
        final_total_amount_calculated,
        tender_amount, // Amount tendered at checkout
        payment_method, // Payment method used at checkout
        staffUserId,
        TRANSACTION_LIFECYCLE_STATUS.CHECKED_OUT.toString(),
        TRANSACTION_PAYMENT_STATUS.PAID,
        transactionId
      ]
    );

    if (updatedTransactionRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Failed to update transaction record during check-out." };
    }
    const updatedTransaction = updatedTransactionRes.rows[0];

    const defaultCheckoutNote = "Please do a room inspection.";
    const roomUpdateRes = await client.query(
      `UPDATE hotel_room
       SET is_available = $1, transaction_id = NULL, cleaning_status = $2, cleaning_notes = $3, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $4 AND tenant_id = $5 AND branch_id = $6`,
      [ROOM_AVAILABILITY_STATUS.AVAILABLE, ROOM_CLEANING_STATUS.INSPECTION, defaultCheckoutNote, roomId, tenantId, branchId]
    );

    if (roomUpdateRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Check-out processed for transaction, but failed to update room status. Please check manually." };
    }

     await client.query(
        `INSERT INTO room_cleaning_logs (room_id, room_cleaning_status, notes, user_id, created_at)
         VALUES ($1, $2, $3, $4, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'))`,
        [roomId, ROOM_CLEANING_STATUS.INSPECTION.toString(), defaultCheckoutNote, staffUserId]
    );


    await client.query('COMMIT');
    return {
      success: true,
      message: "Guest checked out successfully. Room set to 'Needs Inspection'.",
      transaction: {
        ...updatedTransaction,
        status: Number(updatedTransaction.status),
        is_paid: Number(updatedTransaction.is_paid),
        is_accepted: Number(updatedTransaction.is_accepted),
        is_admin_created: Number(updatedTransaction.is_admin_created),
        check_in_time: updatedTransaction.check_in_time,
        check_out_time: updatedTransaction.check_out_time,
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
        cleaning_notes: defaultCheckoutNote,
      }
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[checkOutGuestAndFreeRoom DB Error]', error);
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
       SET status = $1,
           is_paid = $2, -- Typically, cancelled reservations are not marked as paid
           is_accepted = $3, -- Could be 'Not Accepted' or 'Default' depending on flow
           updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $4 AND tenant_id = $5 AND branch_id = $6
       AND (
            status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN} OR
            status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM} OR
            status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM} OR
            status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.RESERVATION_ADMIN_CREATED_PENDING_BRANCH_ACCEPTANCE} OR
            status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.CHECKED_OUT} -- Allow cancelling even if checked out for corrections
        )
       RETURNING hotel_room_id, status as old_status`, // Get old status to decide on room update
      [
        TRANSACTION_LIFECYCLE_STATUS.VOIDED_CANCELLED.toString(),
        TRANSACTION_PAYMENT_STATUS.UNPAID, // Set to unpaid upon cancellation
        TRANSACTION_IS_ACCEPTED_STATUS.NOT_ACCEPTED, // Mark as not accepted
        transactionId, tenantId, branchId,
      ]
    );

    if (transactionUpdateRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Reservation/Transaction not found, not in a cancellable status, or already cancelled." };
    }

    const actualRoomId = roomId ?? transactionUpdateRes.rows[0].hotel_room_id;
    const oldStatus = Number(transactionUpdateRes.rows[0].old_status);
    let updatedRoomData: (Partial<HotelRoom> & { id: number }) | undefined = undefined;

    // Only free up the room if it was linked to this specific transaction
    // and was in an occupied or reserved state due to THIS transaction.
    if (actualRoomId && (oldStatus === TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN || oldStatus === TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM)) {
      const roomUpdateRes = await client.query(
        `UPDATE hotel_room SET is_available = $1, transaction_id = NULL, cleaning_status = $2, cleaning_notes = $3, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
         WHERE id = $4 AND tenant_id = $5 AND branch_id = $6 AND transaction_id = $7`, // Ensure we only update if it's still linked
        [ROOM_AVAILABILITY_STATUS.AVAILABLE, ROOM_CLEANING_STATUS.CLEAN, 'Reservation cancelled, room available.', actualRoomId, tenantId, branchId, transactionId]
      );

      if (roomUpdateRes.rowCount > 0) {
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
          cleaning_status: ROOM_CLEANING_STATUS.CLEAN,
          cleaning_notes: 'Reservation cancelled, room available.',
        };
      }
    }

    await client.query('COMMIT');
    return {
      success: true,
      message: "Reservation cancelled successfully." + (actualRoomId && updatedRoomData ? " Room is now available." : ""),
      updatedRoomData
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[cancelReservation DB Error]', error);
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
      `SELECT client_name, hotel_rate_id, reserved_check_in_datetime, status, is_paid, total_amount, tender_amount
       FROM transactions
       WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND hotel_room_id = $4
       AND (status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM} OR status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.RESERVATION_ADMIN_CREATED_PENDING_BRANCH_ACCEPTANCE})
       `, // Only these two statuses are valid for this "check-in reserved guest" action
      [transactionId, tenantId, branchId, roomId]
    );

    if (transactionCheckRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Reservation not found for this room, already checked in, or not in a check-in ready status." };
    }
    const { client_name, hotel_rate_id, reserved_check_in_datetime, status: current_status_db, is_paid: currentIsPaid, total_amount: currentTotalAmount, tender_amount: currentTenderAmount } = transactionCheckRes.rows[0];

    const newTransactionLifecycleStatus = TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN;
    let actualCheckInTimeValue = formatDateTime(new Date(), "yyyy-MM-dd HH:mm:ss"); // Default to now

    // Use reserved time if it's in the future for an advance reservation, otherwise use current time
    if (reserved_check_in_datetime && new Date(reserved_check_in_datetime) > new Date()) {
        actualCheckInTimeValue = reserved_check_in_datetime;
    }

    const updateTransactionRes = await client.query(
      `UPDATE transactions
       SET status = $1,
           check_in_time = ($2::TEXT::TIMESTAMP WITHOUT TIME ZONE AT TIME ZONE 'Asia/Manila'),
           updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $3
       RETURNING *`,
      [newTransactionLifecycleStatus.toString(), actualCheckInTimeValue, transactionId]
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
    let rate_hours_val = null;
    if (hotel_rate_id) {
        const rateDetailsRes = await client.query(
          'SELECT name, hours FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3',
          [hotel_rate_id, tenantId, branchId]
        );
        if (rateDetailsRes.rows.length > 0) {
            rate_name = rateDetailsRes.rows[0].name;
            rate_hours_val = parseInt(rateDetailsRes.rows[0].hours, 10);
        }
    }

    await client.query('COMMIT');
    return {
      success: true,
      message: "Reserved guest checked in successfully.",
      transaction: {
        ...updatedTransaction,
        status: Number(updatedTransaction.status),
        is_paid: Number(updatedTransaction.is_paid),
        is_accepted: Number(updatedTransaction.is_accepted),
        is_admin_created: Number(updatedTransaction.is_admin_created),
        check_in_time: updatedTransaction.check_in_time,
        room_name: (await client.query('SELECT room_name FROM hotel_room WHERE id = $1', [roomId])).rows[0]?.room_name,
        rate_name,
      } as Transaction,
      updatedRoomData: {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.OCCUPIED,
        transaction_id: transactionId,
        active_transaction_id: transactionId,
        active_transaction_client_name: client_name,
        active_transaction_check_in_time: updatedTransaction.check_in_time,
        active_transaction_rate_name: rate_name,
        active_transaction_rate_hours: rate_hours_val,
        active_transaction_status: Number(updatedTransaction.status),
      }
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[checkInReservedGuest DB Error]', error);
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
       AND t.hotel_room_id IS NULL
       AND (t.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM} OR t.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM} OR t.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.RESERVATION_ADMIN_CREATED_PENDING_BRANCH_ACCEPTANCE})
       ORDER BY t.reserved_check_in_datetime ASC, t.created_at DESC`,
      [tenantId, branchId]
    );
     return res.rows.map(row => ({
        ...row,
        status: Number(row.status),
        is_paid: row.is_paid !== null ? Number(row.is_paid) : null,
        is_accepted: row.is_accepted !== null ? Number(row.is_accepted) : null,
        is_admin_created: row.is_admin_created !== null ? Number(row.is_admin_created) : null,
    })) as Transaction[];
  } catch (error) {
    console.error('Failed to fetch unassigned reservations:', error);
    throw new Error(`Database error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}

export async function createUnassignedReservation(
  data: z.infer<typeof transactionCreateSchema>,
  tenantId: number,
  branchId: number,
  staffUserId: number,
  is_admin_created_flag?: boolean
): Promise<{ success: boolean; message?: string; transaction?: Transaction }> {
  const validatedFields = transactionCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessage = "Invalid data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
    return { success: false, message: errorMessage };
  }
  const { client_name, selected_rate_id, client_payment_method, notes, is_advance_reservation, reserved_check_in_datetime, reserved_check_out_datetime, is_paid, tender_amount_at_checkin } = validatedFields.data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let transactionLifecycleStatus: number;
    let acceptedStatus: number;
    const finalPaymentStatus = data.is_paid ? TRANSACTION_PAYMENT_STATUS.PAID : TRANSACTION_PAYMENT_STATUS.UNPAID;
    let finalTenderAmount = (data.is_paid && tender_amount_at_checkin !== null && tender_amount_at_checkin !== undefined) ? tender_amount_at_checkin : null;
    let finalTotalAmount = null;

    if (is_admin_created_flag) {
        transactionLifecycleStatus = TRANSACTION_LIFECYCLE_STATUS.RESERVATION_ADMIN_CREATED_PENDING_BRANCH_ACCEPTANCE;
        acceptedStatus = TRANSACTION_IS_ACCEPTED_STATUS.PENDING;
    } else { // Staff creating for own branch
        transactionLifecycleStatus = is_advance_reservation ? TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM : TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM;
        acceptedStatus = TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED; // Auto-accepted if staff creates for own branch
    }

    if (data.is_paid && selected_rate_id) {
        const rateRes = await client.query(
          'SELECT price FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND status::INTEGER = $4',
          [selected_rate_id, tenantId, branchId, Number(HOTEL_ENTITY_STATUS.ACTIVE)]
        );
        if (rateRes.rows.length > 0) {
            finalTotalAmount = parseFloat(rateRes.rows[0].price);
        } else if (selected_rate_id) { // Only error if rate was selected but not found
            await client.query('ROLLBACK');
            return { success: false, message: "Selected rate not found or inactive for calculating total amount." };
        }
    }


    const r_check_in = (is_advance_reservation && reserved_check_in_datetime) ? reserved_check_in_datetime : null;
    const r_check_out = (is_advance_reservation && reserved_check_out_datetime) ? reserved_check_out_datetime : null;
    const isAdminCreatedValue = is_admin_created_flag ? 1 : 0;

    const res = await client.query(
      `INSERT INTO transactions (
         tenant_id, branch_id, hotel_room_id, hotel_rate_id, client_name, client_payment_method,
         notes, status, created_by_user_id, reserved_check_in_datetime,
         reserved_check_out_datetime, updated_at, is_admin_created, is_accepted, created_at,
         check_in_time, is_paid, tender_amount, total_amount
       )
       VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), $11, $12, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'),
         (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), $13, $14, $15
       )
       RETURNING *`,
      [
        tenantId, branchId, selected_rate_id, client_name, client_payment_method, notes,
        transactionLifecycleStatus.toString(), staffUserId,
        r_check_in, r_check_out, isAdminCreatedValue, acceptedStatus,
        finalPaymentStatus,
        finalTenderAmount,
        finalTotalAmount
      ]
    );
    if (res.rows.length > 0) {
      const newTransaction = res.rows[0];
      let rate_name = null;
      if (newTransaction.hotel_rate_id) {
        const rateNameRes = await client.query('SELECT name FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [newTransaction.hotel_rate_id, tenantId, branchId]);
        rate_name = rateNameRes.rows.length > 0 ? rateNameRes.rows[0].name : null;
      }

      await client.query('COMMIT');
      return {
        success: true,
        message: "Unassigned reservation created successfully.",
        transaction: {
          ...newTransaction,
          status: Number(newTransaction.status),
          is_paid: Number(newTransaction.is_paid),
          is_accepted: Number(newTransaction.is_accepted),
          is_admin_created: Number(newTransaction.is_admin_created),
          rate_name,
        } as Transaction,
      };
    }
    await client.query('ROLLBACK');
    return { success: false, message: "Failed to create unassigned reservation." };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[createUnassignedReservation DB Error]', error);
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
       WHERE tenant_id = $1 AND branch_id = $2 AND is_available = $3 AND status::INTEGER = $4 AND cleaning_status = $5
       ORDER BY floor ASC, room_code ASC`,
      [tenantId, branchId, ROOM_AVAILABILITY_STATUS.AVAILABLE, Number(HOTEL_ENTITY_STATUS.ACTIVE), ROOM_CLEANING_STATUS.CLEAN]
    );
    return res.rows.map(row => {
       let parsedRateIds: number[] = [];
        try {
            if (typeof row.hotel_rate_id === 'string') {
                parsedRateIds = JSON.parse(row.hotel_rate_id);
            } else if (Array.isArray(row.hotel_rate_id)) {
                parsedRateIds = row.hotel_rate_id;
            }
             if (!Array.isArray(parsedRateIds) || !parsedRateIds.every(id => typeof id === 'number')) {
                parsedRateIds = [];
            }
        } catch (e) {
            parsedRateIds = [];
        }
        return {
            id: Number(row.id),
            room_name: row.room_name,
            room_code: row.room_code,
            hotel_rate_id: parsedRateIds
        };
    });
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const roomCheckRes = await client.query(
      `SELECT is_available, room_name, cleaning_status FROM hotel_room WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND status::INTEGER = $4`,
      [roomId, tenantId, branchId, Number(HOTEL_ENTITY_STATUS.ACTIVE)]
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
      return { success: false, message: `Selected room is not clean. Current status: ${ROOM_CLEANING_STATUS_TEXT[roomCheckRes.rows[0].cleaning_status as keyof typeof ROOM_CLEANING_STATUS_TEXT]}.` };
    }
    const roomName = roomCheckRes.rows[0].room_name;

    const transactionCheckRes = await client.query(
      `SELECT client_name, hotel_rate_id, reserved_check_in_datetime, status, is_accepted, is_paid, total_amount, tender_amount
       FROM transactions
       WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND hotel_room_id IS NULL
       AND (
            status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM} OR
            status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM} OR /* Should not happen if hotel_room_id is NULL */
            status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.RESERVATION_ADMIN_CREATED_PENDING_BRANCH_ACCEPTANCE} OR
            status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN} /* If it was 'Unpaid' (0) due to prior acceptance */
        )
       `,
      [transactionId, tenantId, branchId]
    );

    if (transactionCheckRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: "Reservation not found, already assigned, or not in a valid unassigned status." };
    }
    const { client_name, hotel_rate_id, reserved_check_in_datetime, status: current_status_db, is_accepted, is_paid: currentIsPaid, total_amount: currentTotalAmount, tender_amount: currentTenderAmount } = transactionCheckRes.rows[0];
    const current_status = Number(current_status_db);

    if (current_status === TRANSACTION_LIFECYCLE_STATUS.RESERVATION_ADMIN_CREATED_PENDING_BRANCH_ACCEPTANCE && Number(is_accepted) !== TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED) {
      await client.query('ROLLBACK');
      return { success: false, message: "This reservation must be accepted by the branch before assigning a room." };
    }

    let checkInTimeForUpdate = formatDateTime(new Date(), "yyyy-MM-dd HH:mm:ss"); // Default to now
    if ( (current_status === TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM || current_status === TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM || current_status === TRANSACTION_LIFECYCLE_STATUS.RESERVATION_ADMIN_CREATED_PENDING_BRANCH_ACCEPTANCE) &&
         reserved_check_in_datetime && new Date(reserved_check_in_datetime) > new Date() ) {
        checkInTimeForUpdate = reserved_check_in_datetime; // Use future reserved time
    }

    const newTransactionLifecycleStatus = TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN;

    const updateTransactionRes = await client.query(
        `UPDATE transactions
        SET status = $1,
            hotel_room_id = $2,
            check_in_time = ($3::TEXT::TIMESTAMP WITHOUT TIME ZONE AT TIME ZONE 'Asia/Manila'),
            is_accepted = $4, -- Ensure it's marked as accepted if it was pending
            updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
        WHERE id = $5
        RETURNING *`,
        [
            newTransactionLifecycleStatus.toString(),
            roomId,
            checkInTimeForUpdate,
            TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED,
            transactionId
        ]
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
    let rate_hours_val = null;
    if (hotel_rate_id) {
        const rateDetailsRes = await client.query(
          'SELECT name, hours FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3',
          [hotel_rate_id, tenantId, branchId]
        );
        if (rateDetailsRes.rows.length > 0) {
          rate_name = rateDetailsRes.rows[0].name;
          rate_hours_val = parseInt(rateDetailsRes.rows[0].hours, 10);
        }
    }

    await client.query('COMMIT');
    return {
      success: true,
      message: "Guest from reservation checked in successfully.",
      transaction: {
        ...updatedTransaction,
        status: Number(updatedTransaction.status),
        is_paid: Number(updatedTransaction.is_paid),
        is_accepted: Number(updatedTransaction.is_accepted),
        is_admin_created: Number(updatedTransaction.is_admin_created),
        check_in_time: updatedTransaction.check_in_time,
        room_name: roomName,
        rate_name,
      } as Transaction,
      updatedRoomData: {
        id: roomId,
        is_available: ROOM_AVAILABILITY_STATUS.OCCUPIED,
        transaction_id: transactionId,
        active_transaction_id: transactionId,
        active_transaction_client_name: client_name,
        active_transaction_check_in_time: updatedTransaction.check_in_time,
        active_transaction_rate_name: rate_name,
        active_transaction_rate_hours: rate_hours_val,
        active_transaction_status: Number(updatedTransaction.status),
      }
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[assignRoomAndCheckIn DB Error]', error);
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
    tender_amount_at_checkin
  } = validatedFields.data;

  const client = await pool.connect();
  try {
    const currentTransactionRes = await client.query('SELECT status, is_admin_created FROM transactions WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [transactionId, tenantId, branchId]);
    if (currentTransactionRes.rows.length === 0) {
      return { success: false, message: "Transaction not found." };
    }
    const currentStatus = Number(currentTransactionRes.rows[0].status);
    const isAdminCreated = Number(currentTransactionRes.rows[0].is_admin_created) === 1;

    let newLifecycleStatus = currentStatus;
    const finalPaymentStatus = data.is_paid ? TRANSACTION_PAYMENT_STATUS.PAID : TRANSACTION_PAYMENT_STATUS.UNPAID;
    let finalTenderAmount = (data.is_paid && tender_amount_at_checkin !== null && tender_amount_at_checkin !== undefined) ? tender_amount_at_checkin : null;
    let finalTotalAmount = null;


    if (!isAdminCreated || currentStatus !== TRANSACTION_LIFECYCLE_STATUS.RESERVATION_ADMIN_CREATED_PENDING_BRANCH_ACCEPTANCE) { // If not an admin-pending, staff are managing their own
        newLifecycleStatus = is_advance_reservation ? TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM : TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM;
    } // Else, admin-pending status remains until explicitly accepted/declined by staff

    if (data.is_paid && selected_rate_id) {
        const rateRes = await client.query(
          'SELECT price FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND status::INTEGER = $4',
          [selected_rate_id, tenantId, branchId, Number(HOTEL_ENTITY_STATUS.ACTIVE)]
        );
        if (rateRes.rows.length > 0) {
            finalTotalAmount = parseFloat(rateRes.rows[0].price);
        } else if(selected_rate_id) {
             return { success: false, message: "Selected rate not found for calculating total amount." };
        }
    }


    const r_check_in = (is_advance_reservation && reserved_check_in_datetime) ? reserved_check_in_datetime : null;
    const r_check_out = (is_advance_reservation && reserved_check_out_datetime) ? reserved_check_out_datetime : null;

    const res = await client.query(
      `UPDATE transactions
       SET client_name = $1, hotel_rate_id = $2, client_payment_method = $3, notes = $4,
           status = $5,
           reserved_check_in_datetime = $6,
           reserved_check_out_datetime = $7,
           is_paid = $8,
           tender_amount = $9,
           total_amount = $10,
           updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $11 AND tenant_id = $12 AND branch_id = $13 AND hotel_room_id IS NULL
       AND (
            status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM} OR
            status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM} OR /* should not happen with hotel_room_id IS NULL */
            status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.RESERVATION_ADMIN_CREATED_PENDING_BRANCH_ACCEPTANCE}
        )
       RETURNING *`,
      [
        client_name, selected_rate_id, client_payment_method, notes,
        newLifecycleStatus.toString(),
        r_check_in,
        r_check_out,
        finalPaymentStatus,
        finalTenderAmount,
        finalTotalAmount,
        transactionId, tenantId, branchId,
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
          status: Number(updatedRow.status),
          is_paid: Number(updatedRow.is_paid),
          is_accepted: Number(updatedRow.is_accepted),
          is_admin_created: Number(updatedRow.is_admin_created),
          rate_name,
        } as Transaction,
      };
    }
    return { success: false, message: "Unassigned reservation not found, not in an editable status, or update failed." };
  } catch (error) {
    console.error(`[updateUnassignedReservation DB Error] Failed to update unassigned reservation ${transactionId}:`, error);
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
        id: Number(row.id),
        tenant_id: Number(row.tenant_id),
        message: row.message,
        status: Number(row.status),
        target_branch_id: row.target_branch_id ? Number(row.target_branch_id) : null,
        target_branch_name: row.target_branch_name,
        creator_user_id: row.creator_user_id ? Number(row.creator_user_id) : null,
        creator_username: row.creator_username,
        transaction_id: row.transaction_id ? Number(row.transaction_id) : null,
        created_at: row.created_at,
        read_at: row.read_at,
        transaction_status: Number(row.transaction_status),
        transaction_is_accepted: row.transaction_is_accepted !== null ? Number(row.transaction_is_accepted) : null,
        linked_transaction_status: row.linked_transaction_status ? Number(row.linked_transaction_status) : null,
    })) as Notification[];
  } catch (error) {
    console.error(`[listNotificationsForBranch DB Error] Failed to fetch notifications for branch ${branchId} of tenant ${tenantId}:`, error);
    throw new Error(`Database error: Could not fetch notifications. ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}

export async function markStaffNotificationAsRead(notificationId: number, tenantId: number, branchId: number): Promise<{ success: boolean; message?: string; notification?: Notification }> {
  const client = await pool.connect();
  try {
    const checkRes = await client.query('SELECT target_branch_id FROM notification WHERE id = $1 AND tenant_id = $2', [notificationId, tenantId]);
    if (checkRes.rows.length === 0 || (checkRes.rows[0].target_branch_id !== null && Number(checkRes.rows[0].target_branch_id) !== branchId)) {
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
      const fullNotif = fullNotificationRes.rows[0];
      return {
        success: true,
        message: "Notification marked as read.",
        notification: {
            id: Number(fullNotif.id),
            tenant_id: Number(fullNotif.tenant_id),
            message: fullNotif.message,
            status: Number(fullNotif.status),
            target_branch_id: fullNotif.target_branch_id ? Number(fullNotif.target_branch_id) : null,
            target_branch_name: fullNotif.target_branch_name,
            creator_user_id: fullNotif.creator_user_id ? Number(fullNotif.creator_user_id) : null,
            creator_username: fullNotif.creator_username,
            transaction_id: fullNotif.transaction_id ? Number(fullNotif.transaction_id) : null,
            created_at: fullNotif.created_at,
            read_at: fullNotif.read_at,
            transaction_status: Number(fullNotif.transaction_status),
            transaction_is_accepted: fullNotif.transaction_is_accepted !== null ? Number(fullNotif.transaction_is_accepted) : null,
            linked_transaction_status: fullNotif.linked_transaction_status ? Number(fullNotif.linked_transaction_status) : null,
        } as Notification
      };
    }
    return { success: false, message: "Notification not found or no change made." };
  } catch (error) {
    console.error(`[markStaffNotificationAsRead DB Error] Failed to mark notification ${notificationId} as read by staff:`, error);
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
        const errorMessage = "Invalid data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
        return { success: false, message: errorMessage };
    }
    const {
        client_name, selected_rate_id, client_payment_method, notes,
        is_advance_reservation, reserved_check_in_datetime, reserved_check_out_datetime,
        is_paid, tender_amount_at_checkin
    } = validatedFields.data;

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
         if (Number(transactionCheckRes.rows[0].status) !== TRANSACTION_LIFECYCLE_STATUS.RESERVATION_ADMIN_CREATED_PENDING_BRANCH_ACCEPTANCE) {
            await client.query('ROLLBACK');
            return { success: false, message: "This reservation is not pending branch acceptance." };
        }

        const newTransactionLifecycleStatus = is_advance_reservation ? TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM : TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM;
        const finalPaymentStatus = is_paid ? TRANSACTION_PAYMENT_STATUS.PAID : TRANSACTION_PAYMENT_STATUS.UNPAID;
        let finalTenderAmount = (is_paid && tender_amount_at_checkin !== null && tender_amount_at_checkin !== undefined) ? tender_amount_at_checkin : null;
        let finalTotalAmount = null;

        if (is_paid && selected_rate_id) {
            const rateRes = await client.query(
              'SELECT price FROM hotel_rates WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND status::INTEGER = $4',
              [selected_rate_id, tenantId, branchId, Number(HOTEL_ENTITY_STATUS.ACTIVE)]
            );
            if (rateRes.rows.length > 0) {
                finalTotalAmount = parseFloat(rateRes.rows[0].price);
            } else if(selected_rate_id) {
                 await client.query('ROLLBACK');
                 return { success: false, message: "Selected rate not found for calculating total amount." };
            }
        }


        const r_check_in = (is_advance_reservation && reserved_check_in_datetime) ? reserved_check_in_datetime : null;
        const r_check_out = (is_advance_reservation && reserved_check_out_datetime) ? reserved_check_out_datetime : null;

        const res = await client.query(
            `UPDATE transactions
             SET client_name = $1, hotel_rate_id = $2, client_payment_method = $3, notes = $4,
                 status = $5, reserved_check_in_datetime = $6, reserved_check_out_datetime = $7,
                 is_accepted = $8, accepted_by_user_id = $9,
                 is_paid = $10, tender_amount = $11, total_amount = $12,
                 updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
             WHERE id = $13 AND tenant_id = $14 AND branch_id = $15
             RETURNING *`,
            [
                client_name, selected_rate_id, client_payment_method, notes,
                newTransactionLifecycleStatus.toString(), r_check_in, r_check_out,
                TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED, staffUserId,
                finalPaymentStatus,
                finalTenderAmount,
                finalTotalAmount,
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
                    status: Number(updatedRow.status),
                    is_paid: Number(updatedRow.is_paid),
                    is_accepted: Number(updatedRow.is_accepted),
                    is_admin_created: Number(updatedRow.is_admin_created),
                    rate_name,
                 } as Transaction,
            };
        } else {
            await client.query('ROLLBACK');
            return { success: false, message: "Failed to accept reservation." };
        }
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`[acceptReservationByStaff DB Error] Failed to accept reservation ${transactionId}:`, error);
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
         if (Number(transactionCheckRes.rows[0].status) !== TRANSACTION_LIFECYCLE_STATUS.RESERVATION_ADMIN_CREATED_PENDING_BRANCH_ACCEPTANCE) {
            await client.query('ROLLBACK');
            return { success: false, message: "This reservation is not pending branch acceptance." };
        }

        const res = await client.query(
            `UPDATE transactions
             SET status = $1, is_accepted = $2, declined_by_user_id = $3,
                 is_paid = $4, -- Mark as unpaid if declined
                 updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
             WHERE id = $5 AND tenant_id = $6 AND branch_id = $7
             RETURNING *`,
            [
                TRANSACTION_LIFECYCLE_STATUS.RESERVATION_DECLINED_BY_BRANCH.toString(),
                TRANSACTION_IS_ACCEPTED_STATUS.NOT_ACCEPTED,
                staffUserId,
                TRANSACTION_PAYMENT_STATUS.UNPAID,
                transactionId, tenantId, branchId
            ]
        );

        if (res.rows.length > 0) {
            await client.query('COMMIT');
            const updatedRow = res.rows[0];
            return {
                success: true,
                message: "Reservation declined successfully.",
                updatedTransaction: {
                     ...updatedRow,
                    status: Number(updatedRow.status),
                    is_paid: Number(updatedRow.is_paid),
                    is_accepted: Number(updatedRow.is_accepted),
                    is_admin_created: Number(updatedRow.is_admin_created),
                 } as Transaction,
            };
        } else {
            await client.query('ROLLBACK');
            return { success: false, message: "Failed to decline reservation." };
        }
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`[declineReservationByStaff DB Error] Failed to decline reservation ${transactionId}:`, error);
        return { success: false, message: `Database error during decline: ${error instanceof Error ? error.message : String(error)}` };
    } finally {
        client.release();
    }
}

export async function listLostAndFoundItems(tenantId: number, branchId: number): Promise<LostAndFoundLog[]> {
  const client = await pool.connect();
  try {
    const query = `
      SELECT
        laf.id, laf.tenant_id, laf.branch_id,
        laf.item_name, laf.description, laf.found_location,
        laf.reported_by_user_id, u.username as reported_by_username,
        laf.status, laf.found_at, laf.updated_at, laf.claimed_at, laf.claimed_by_details, laf.disposed_details
      FROM lost_and_found_logs laf
      LEFT JOIN users u ON laf.reported_by_user_id = u.id
      WHERE laf.tenant_id = $1 AND laf.branch_id = $2
      ORDER BY laf.found_at DESC, laf.id DESC
    `;
    const res = await client.query(query, [tenantId, branchId]);
    return res.rows.map(row => ({
      ...row,
      id: Number(row.id),
      tenant_id: Number(row.tenant_id),
      branch_id: Number(row.branch_id),
      status: Number(row.status),
      reported_by_user_id: row.reported_by_user_id ? Number(row.reported_by_user_id) : null,
    })) as LostAndFoundLog[];
  } catch (error) {
    console.error('[listLostAndFoundItems DB Error]', error);
    throw new Error(`Database error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}

export async function addLostAndFoundItem(
  data: LostAndFoundCreateData,
  tenantId: number,
  branchId: number,
  reportedByUserId: number
): Promise<{ success: boolean; message?: string; item?: LostAndFoundLog }> {
  const validatedFields = lostAndFoundCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    return { success: false, message: "Invalid data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors) };
  }
  const { item_name, description, found_location } = validatedFields.data;
  const client = await pool.connect();
  try {
    const query = `
      INSERT INTO lost_and_found_logs (
        tenant_id, branch_id, item_name, description, found_location,
        reported_by_user_id, status, found_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'),
        (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      ) RETURNING id, tenant_id, branch_id, item_name, description, found_location, reported_by_user_id, status, found_at, updated_at, claimed_at, claimed_by_details, disposed_details
    `;
    const res = await client.query(query, [
      tenantId, branchId, item_name, description, found_location,
      reportedByUserId, LOST_AND_FOUND_STATUS.FOUND
    ]);

    if (res.rows.length > 0) {
      const newItem = res.rows[0];
      const userRes = await client.query('SELECT username FROM users WHERE id = $1', [reportedByUserId]);
      const reported_by_username = userRes.rows.length > 0 ? userRes.rows[0].username : null;
      return {
        success: true,
        message: "Lost item logged successfully.",
        item: {
          ...newItem,
          id: Number(newItem.id),
          status: Number(newItem.status),
          reported_by_username,
        } as LostAndFoundLog
      };
    }
    return { success: false, message: "Failed to log item." };
  } catch (error) {
    console.error('[addLostAndFoundItem DB Error]', error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}

export async function updateLostAndFoundItemStatus(
  itemId: number,
  data: LostAndFoundUpdateStatusData,
  tenantId: number,
  branchId: number,
  updatedByUserId: number // Can be used for logging who updated it, if needed
): Promise<{ success: boolean; message?: string; item?: LostAndFoundLog }> {
  const validatedFields = lostAndFoundUpdateStatusSchema.safeParse(data);
  if (!validatedFields.success) {
    return { success: false, message: "Invalid data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors) };
  }
  const { status, claimed_by_details, disposed_details } = validatedFields.data;
  const client = await pool.connect();
  try {
    let setClauses = ["status = $1", "updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')"];
    const queryParams: (number | string | null)[] = [status];

    if (status === LOST_AND_FOUND_STATUS.CLAIMED) {
      setClauses.push("claimed_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')");
      setClauses.push("claimed_by_details = $2");
      queryParams.push(claimed_by_details || null);
    } else {
      queryParams.push(null); // Placeholder for claimed_by_details
    }

    if (status === LOST_AND_FOUND_STATUS.DISPOSED) {
      // setClauses.push("disposed_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')"); // If you add disposed_at column
      setClauses.push("disposed_details = $3");
      queryParams.push(disposed_details || null);
    } else {
       queryParams.push(null); // Placeholder for disposed_details
    }

    queryParams.push(itemId, tenantId, branchId);
    const placeholderIndexOffset = status === LOST_AND_FOUND_STATUS.CLAIMED ? 3 : (status === LOST_AND_FOUND_STATUS.DISPOSED ? 3 : 2);


    const query = `
      UPDATE lost_and_found_logs
      SET ${setClauses.join(", ")}
      WHERE id = $${placeholderIndexOffset} AND tenant_id = $${placeholderIndexOffset+1} AND branch_id = $${placeholderIndexOffset+2}
      RETURNING id, tenant_id, branch_id, item_name, description, found_location, reported_by_user_id, status, found_at, updated_at, claimed_at, claimed_by_details, disposed_details
    `;

    const res = await client.query(query, queryParams);

    if (res.rows.length > 0) {
      const updatedItem = res.rows[0];
       const userRes = await client.query('SELECT username FROM users WHERE id = $1', [updatedItem.reported_by_user_id]);
      const reported_by_username = userRes.rows.length > 0 ? userRes.rows[0].username : null;
      return {
        success: true,
        message: "Item status updated successfully.",
        item: {
           ...updatedItem,
           id: Number(updatedItem.id),
           status: Number(updatedItem.status),
           reported_by_username,
        } as LostAndFoundLog
      };
    }
    return { success: false, message: "Item not found or update failed." };
  } catch (error) {
    console.error('[updateLostAndFoundItemStatus DB Error]', error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}
