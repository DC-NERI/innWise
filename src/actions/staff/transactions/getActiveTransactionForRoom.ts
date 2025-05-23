
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
import type { Transaction } from '@/lib/types';
import { TRANSACTION_LIFECYCLE_STATUS } from '../../../lib/constants'; // Corrected import path

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in staff/transactions/getActiveTransactionForRoom action', err);
});

export async function getActiveTransactionForRoom(transactionId: number, tenantId: number, branchId: number): Promise<Transaction | null> {
  // Critical check for constants
  if (
    typeof TRANSACTION_LIFECYCLE_STATUS?.UNPAID === 'undefined' ||
    typeof TRANSACTION_LIFECYCLE_STATUS?.ADVANCE_PAID === 'undefined' ||
    typeof TRANSACTION_LIFECYCLE_STATUS?.ADVANCE_RESERVATION === 'undefined' ||
    typeof TRANSACTION_LIFECYCLE_STATUS?.PENDING_BRANCH_ACCEPTANCE === 'undefined'
  ) {
    const errorMessage = "Server configuration error: Critical TRANSACTION_LIFECYCLE_STATUS constants are missing or undefined in getActiveTransactionForRoom.";
    console.error('[getActiveTransactionForRoom] CRITICAL ERROR:', errorMessage, {
        TRANSACTION_LIFECYCLE_STATUS_defined: !!TRANSACTION_LIFECYCLE_STATUS,
        UNPAID_defined: typeof TRANSACTION_LIFECYCLE_STATUS?.UNPAID,
        ADVANCE_PAID_defined: typeof TRANSACTION_LIFECYCLE_STATUS?.ADVANCE_PAID,
        ADVANCE_RESERVATION_defined: typeof TRANSACTION_LIFECYCLE_STATUS?.ADVANCE_RESERVATION,
        PENDING_BRANCH_ACCEPTANCE_defined: typeof TRANSACTION_LIFECYCLE_STATUS?.PENDING_BRANCH_ACCEPTANCE,
    });
    throw new Error(errorMessage); // Throw to ensure it's caught by calling function
  }

  const client = await pool.connect();
  try {
    const query = `
      SELECT
        t.*,
        hr_room.room_name,
        hrt.name as rate_name,
        hrt.price as rate_price,
        hrt.hours as rate_hours,
        hrt.excess_hour_price as rate_excess_hour_price
      FROM transactions t
      LEFT JOIN hotel_room hr_room ON t.hotel_room_id = hr_room.id
      LEFT JOIN hotel_rates hrt ON t.hotel_rate_id = hrt.id
      WHERE t.id = $1
        AND t.tenant_id = $2
        AND t.branch_id = $3
        AND (
          t.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.UNPAID} 
          OR t.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.ADVANCE_PAID}
          OR t.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.ADVANCE_RESERVATION}
          OR t.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE}
        )
      LIMIT 1;
    `;
    const res = await client.query(query, [transactionId, tenantId, branchId]);
    if (res.rows.length > 0) {
      const row = res.rows[0];
      return {
        id: Number(row.id),
        tenant_id: Number(row.tenant_id),
        branch_id: Number(row.branch_id),
        hotel_room_id: row.hotel_room_id ? Number(row.hotel_room_id) : null,
        hotel_rate_id: row.hotel_rate_id ? Number(row.hotel_rate_id) : null,
        client_name: row.client_name,
        client_payment_method: row.client_payment_method,
        notes: row.notes,
        check_in_time: row.check_in_time,
        check_out_time: row.check_out_time,
        hours_used: row.hours_used ? Number(row.hours_used) : null,
        total_amount: row.total_amount ? parseFloat(row.total_amount) : null,
        tender_amount: row.tender_amount ? parseFloat(row.tender_amount) : null,
        is_paid: row.is_paid !== null ? Number(row.is_paid) : null,
        created_by_user_id: Number(row.created_by_user_id),
        check_out_by_user_id: row.check_out_by_user_id ? Number(row.check_out_by_user_id) : null,
        accepted_by_user_id: row.accepted_by_user_id ? Number(row.accepted_by_user_id) : null,
        declined_by_user_id: row.declined_by_user_id ? Number(row.declined_by_user_id) : null,
        status: Number(row.status),
        created_at: row.created_at,
        updated_at: row.updated_at,
        reserved_check_in_datetime: row.reserved_check_in_datetime,
        reserved_check_out_datetime: row.reserved_check_out_datetime,
        is_admin_created: row.is_admin_created !== null ? Number(row.is_admin_created) : null,
        is_accepted: row.is_accepted !== null ? Number(row.is_accepted) : null,
        room_name: row.room_name,
        rate_name: row.rate_name,
        rate_price: row.rate_price !== null ? parseFloat(row.rate_price) : null,
        rate_hours: row.rate_hours !== null ? parseInt(row.rate_hours, 10) : null,
        rate_excess_hour_price: row.rate_excess_hour_price !== null ? parseFloat(row.rate_excess_hour_price) : null,
      } as Transaction;
    }
    return null;
  } catch (error) {
    console.error('[getActiveTransactionForRoom DB Error]', error);
    throw new Error(`Database error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}
