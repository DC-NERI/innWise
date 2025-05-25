
"use server";

import pg from 'pg';
// Configure pg to return numeric types as numbers instead of strings
pg.types.setTypeParser(20, (val) => parseInt(val, 10)); // int8/bigint
pg.types.setTypeParser(21, (val) => parseInt(val, 10)); // int2/smallint
pg.types.setTypeParser(23, (val) => parseInt(val, 10)); // int4/integer
pg.types.setTypeParser(1700, (val) => parseFloat(val)); // numeric/decimal

// Configure pg to return timestamp without timezone as strings
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE

import { Pool } from 'pg';
import type { Notification } from '@/lib/types';
import { notificationCreateSchema, NotificationCreateData, TransactionCreateData } from '@/lib/schemas';
import { NOTIFICATION_STATUS, NOTIFICATION_TRANSACTION_LINK_STATUS } from '../../../lib/constants';
import { createUnassignedReservation } from '../../staff/reservations/createUnassignedReservation'; // Adjusted path

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/notifications/createNotification action', err);
});

export async function createNotification(
  data: NotificationCreateData,
  tenantId: number,
  adminUserId: number
): Promise<{ success: boolean; message?: string; notification?: Notification }> {
  if (!adminUserId || typeof adminUserId !== 'number' || adminUserId <= 0) {
    console.error("[createNotification] Invalid adminUserId:", adminUserId);
    return { success: false, message: "Invalid administrator identifier for creating notification." };
  }

  const validatedFields = notificationCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessage = "Invalid data for notification: " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
    return { success: false, message: errorMessage };
  }

  const {
    message,
    target_branch_id,
    do_reservation,
    reservation_client_name,
    reservation_selected_rate_id,
    reservation_client_payment_method,
    reservation_notes,
    reservation_is_advance,
    reservation_is_paid,
    reservation_tender_amount_at_checkin,
    reservation_check_in_datetime,
    reservation_check_out_datetime
  } = validatedFields.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let transactionIdForNotification: number | null = null;
    let finalTransactionLinkStatus = NOTIFICATION_TRANSACTION_LINK_STATUS.NO_TRANSACTION_LINK;

    if (do_reservation && target_branch_id) {
      const reservationData: TransactionCreateData = {
        client_name: reservation_client_name || `Reservation for: ${message.substring(0,30)}...`,
        selected_rate_id: reservation_selected_rate_id, // Can be null
        client_payment_method: reservation_client_payment_method, // Can be null
        notes: reservation_notes || `Linked to notification: ${message.substring(0,50)}...`,
        is_advance_reservation: reservation_is_advance,
        reserved_check_in_datetime: reservation_check_in_datetime,
        reserved_check_out_datetime: reservation_check_out_datetime,
        is_paid: reservation_is_paid,
        tender_amount_at_checkin: reservation_tender_amount_at_checkin,
      };

      const reservationResult = await createUnassignedReservation(
        reservationData,
        tenantId,
        target_branch_id,
        adminUserId, // Admin creating this acts as the 'staffUserId' for this reservation
        true // is_admin_created_flag
      );

      if (reservationResult.success && reservationResult.transaction) {
        transactionIdForNotification = reservationResult.transaction.id;
        finalTransactionLinkStatus = NOTIFICATION_TRANSACTION_LINK_STATUS.TRANSACTION_LINKED;
      } else {
        await client.query('ROLLBACK');
        return { success: false, message: `Failed to create linked reservation: ${reservationResult.message}` };
      }
    }

    const notificationQuery = `
      INSERT INTO notification (
        tenant_id, message, status, target_branch_id, creator_user_id, transaction_id, transaction_status, created_at, read_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), NULL)
      RETURNING id, tenant_id, message, status AS notification_read_status, target_branch_id, creator_user_id, transaction_id, created_at, read_at, transaction_status AS notification_link_status, null as target_branch_name, null as creator_username, null as transaction_is_accepted, null as linked_transaction_lifecycle_status, notification_type, priority, acknowledged_at, acknowledged_by_user_id;
    `;
    const notificationRes = await client.query(notificationQuery, [
      tenantId,
      message,
      NOTIFICATION_STATUS.UNREAD.toString(),
      target_branch_id,
      adminUserId,
      transactionIdForNotification,
      finalTransactionLinkStatus.toString()
    ]);

    await client.query('COMMIT');

    if (notificationRes.rows.length > 0) {
      const newNotification = notificationRes.rows[0];
      let creatorUsername: string | null = null;
      if (newNotification.creator_user_id) {
        const userRes = await client.query('SELECT username FROM users WHERE id = $1', [newNotification.creator_user_id]);
        if (userRes.rows.length > 0) creatorUsername = userRes.rows[0].username;
      }
      let targetBranchName: string | null = null;
      if (newNotification.target_branch_id) {
        const branchRes = await client.query('SELECT branch_name FROM tenant_branch WHERE id = $1 AND tenant_id = $2', [newNotification.target_branch_id, tenantId]);
        if (branchRes.rows.length > 0) targetBranchName = branchRes.rows[0].branch_name;
      }

      return {
        success: true,
        message: "Notification created successfully.",
        notification: {
          ...newNotification,
          status: Number(newNotification.notification_read_status),
          transaction_status: Number(newNotification.notification_link_status),
          creator_username: creatorUsername,
          target_branch_name: targetBranchName,
          // Add other mappings if needed
        } as Notification
      };
    }
    return { success: false, message: "Notification creation failed after commit." };
  } catch (dbError) {
    await client.query('ROLLBACK');
    console.error('[createNotification DB Error]', dbError);
    return { success: false, message: `Database error during notification creation: ${dbError instanceof Error ? dbError.message : String(dbError)}` };
  } finally {
    client.release();
  }
}
