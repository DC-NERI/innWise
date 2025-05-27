
"use server";

import pg from 'pg';
// Configure pg to return numeric types as numbers
pg.types.setTypeParser(20, (val) => parseInt(val, 10)); // int8/bigint
pg.types.setTypeParser(21, (val) => parseInt(val, 10)); // int2/smallint
pg.types.setTypeParser(23, (val) => parseInt(val, 10)); // int4/integer
pg.types.setTypeParser(1700, (val) => parseFloat(val)); // numeric/decimal
// Configure pg to return timestamp without timezone as strings
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE

import { Pool } from 'pg';
import type { Transaction } from '@/lib/types';
import { TRANSACTION_LIFECYCLE_STATUS, TRANSACTION_IS_ACCEPTED_STATUS } from '../../../lib/constants';

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
  branchId: number // The branchId where the transaction is expected to be
): Promise<Transaction | null> {
  
  if (
    !TRANSACTION_LIFECYCLE_STATUS ||
    typeof TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE === 'undefined' ||
    !TRANSACTION_IS_ACCEPTED_STATUS ||
    typeof TRANSACTION_IS_ACCEPTED_STATUS.PENDING === 'undefined'
  ) {
    const errorMessage = "Server configuration error: Critical status constants are missing or undefined in getTransactionDetailsForManagement.";
    console.error('[getTransactionDetailsForManagement] CRITICAL ERROR:', errorMessage);
    // It's better to throw an error here so the calling function knows something fundamental is wrong.
    throw new Error(errorMessage);
  }

  const client = await pool.connect();
  try {
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
        AND t.branch_id = $3 -- Ensure transaction is for the specified branch
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
        check_in_time: String(row.check_in_time), // Represents creation time for this status
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
    return null; // Explicitly return null if no transaction found matching criteria
  } catch (dbError: any) {
    console.error('[getTransactionDetailsForManagement DB Error Raw]', dbError);
    const errorMessage = dbError?.message || 'Unknown database error occurred while fetching transaction details for management.';
    throw new Error(`Database error in getTransactionDetailsForManagement: ${errorMessage}`);
  } finally {
    client.release();
  }
}

