
"use server";

import pg from 'pg';
// Configure pg to return numeric types as numbers
pg.types.setTypeParser(pg.types.builtins.INT2, (val: string) => parseInt(val, 10));
pg.types.setTypeParser(pg.types.builtins.INT4, (val: string) => parseInt(val, 10));
pg.types.setTypeParser(pg.types.builtins.INT8, (val: string) => parseInt(val, 10));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (val: string) => parseFloat(val));
// Configure pg to return timestamp without timezone as strings
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (stringValue: string) => stringValue);
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (stringValue: string) => stringValue);

import { Pool } from 'pg';
import type { Transaction } from '@/lib/types';
import { TRANSACTION_LIFECYCLE_STATUS, TRANSACTION_IS_ACCEPTED_STATUS } from '../../../lib/constants'; // Adjusted path

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('[getTransactionDetailsForManagement Pool Error] Unexpected error on idle client:', err);
});

export async function getTransactionDetailsForManagement(
  transactionId: number,
  tenantId: number,
  branchId: number
): Promise<Transaction | null> {

  if (
    typeof TRANSACTION_LIFECYCLE_STATUS?.PENDING_BRANCH_ACCEPTANCE === 'undefined' ||
    typeof TRANSACTION_IS_ACCEPTED_STATUS?.PENDING === 'undefined'
  ) {
    const errorMessage = "Server configuration error: Critical status constants are missing or undefined in getTransactionDetailsForManagement.";
    console.error('[getTransactionDetailsForManagement] CRITICAL ERROR:', errorMessage);
    throw new Error(errorMessage);
  }

  let client;
  try {
    client = await pool.connect();
    const query = `
      SELECT
        t.*,
        hrt.name as rate_name,
        hrt.price as rate_price,
        hrt.hours as rate_hours,
        hrt.excess_hour_price as rate_excess_hour_price
      FROM transactions t
      LEFT JOIN hotel_rates hrt ON t.hotel_rate_id = hrt.id AND t.tenant_id = hrt.tenant_id AND t.branch_id = hrt.branch_id
      WHERE t.id = $1
        AND t.tenant_id = $2
        AND t.branch_id = $3
        AND t.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE}
        AND t.is_accepted = ${TRANSACTION_IS_ACCEPTED_STATUS.PENDING}
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
        client_name: String(row.client_name),
        client_payment_method: row.client_payment_method,
        notes: row.notes,
        check_in_time: row.check_in_time,
        check_out_time: row.check_out_time,
        hours_used: row.hours_used ? Number(row.hours_used) : null,
        total_amount: row.total_amount ? parseFloat(row.total_amount) : null,
        tender_amount: row.tender_amount !== null ? parseFloat(row.tender_amount) : null,
        is_paid: Number(row.is_paid),
        created_by_user_id: Number(row.created_by_user_id),
        check_out_by_user_id: row.check_out_by_user_id ? Number(row.check_out_by_user_id) : null,
        accepted_by_user_id: row.accepted_by_user_id ? Number(row.accepted_by_user_id) : null,
        declined_by_user_id: row.declined_by_user_id ? Number(row.declined_by_user_id) : null,
        status: Number(row.status),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
        reserved_check_in_datetime: row.reserved_check_in_datetime,
        reserved_check_out_datetime: row.reserved_check_out_datetime,
        is_admin_created: Number(row.is_admin_created),
        is_accepted: Number(row.is_accepted),
        rate_name: row.rate_name,
        rate_price: row.rate_price !== null ? parseFloat(row.rate_price) : null,
        rate_hours: row.rate_hours !== null ? parseInt(row.rate_hours, 10) : null,
        rate_excess_hour_price: row.rate_excess_hour_price !== null ? parseFloat(row.rate_excess_hour_price) : null,
      } as Transaction;
    }
    return null;
  } catch (dbError: any) {
    console.error('[getTransactionDetailsForManagement DB Error Raw]', dbError);
    const errorMessage = dbError?.message || 'Unknown database error occurred while fetching transaction details for management.';
    throw new Error(`Database error in getTransactionDetailsForManagement: ${errorMessage}`);
  } finally {
    if (client) {
        client.release();
    }
  }
}
