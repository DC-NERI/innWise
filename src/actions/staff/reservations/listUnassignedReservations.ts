
"use server";

import pg from 'pg';
// Configure pg to return numeric types as numbers instead of strings
pg.types.setTypeParser(20, (val) => parseInt(val, 10)); // int8
pg.types.setTypeParser(21, (val) => parseInt(val, 10)); // int2
pg.types.setTypeParser(23, (val) => parseInt(val, 10)); // int4
pg.types.setTypeParser(1700, (val) => parseFloat(val)); // numeric

// Configure pg to return timestamp without timezone as strings
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE

import { Pool } from 'pg';
import type { Transaction } from '@/lib/types';
import { TRANSACTION_LIFECYCLE_STATUS, TRANSACTION_IS_ACCEPTED_STATUS } from '../../../lib/constants'; // Adjusted import path

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  // console.error('Unexpected error on idle client in staff/reservations/listUnassignedReservations action', err);
});

export async function listUnassignedReservations(tenantId: number, branchId: number): Promise<Transaction[]> {
  if (!tenantId || !branchId) {
    return [];
  }
  // Check if constants are loaded correctly
  if (typeof TRANSACTION_LIFECYCLE_STATUS?.RESERVATION_NO_ROOM === 'undefined' ||
      typeof TRANSACTION_IS_ACCEPTED_STATUS?.ACCEPTED === 'undefined') {
    console.error('[listUnassignedReservations] CRITICAL ERROR: Status constants are undefined.');
    throw new Error('Server configuration error: Required constants are missing.');
  }

  const client = await pool.connect();
  try {
    const query = `
      SELECT
        t.*,
        hrt.name as rate_name,
        hrt.price as rate_price,
        hrt.hours as rate_hours
      FROM transactions t
      LEFT JOIN hotel_rates hrt ON t.hotel_rate_id = hrt.id AND t.tenant_id = hrt.tenant_id AND t.branch_id = hrt.branch_id
      WHERE t.tenant_id = $1
        AND t.branch_id = $2
        AND t.hotel_room_id IS NULL
        AND t.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM} -- Status '3'
        AND t.is_accepted::INTEGER = ${TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED} -- Only show if accepted by branch
      ORDER BY t.reserved_check_in_datetime ASC, t.created_at ASC;
    `;
    const res = await client.query(query, [tenantId, branchId]);
    return res.rows.map(row => ({
      ...row,
      status: Number(row.status),
      is_paid: Number(row.is_paid),
      is_accepted: row.is_accepted !== null ? Number(row.is_accepted) : null,
      is_admin_created: row.is_admin_created !== null ? Number(row.is_admin_created) : null,
      rate_price: row.rate_price !== null ? parseFloat(row.rate_price) : null,
      rate_hours: row.rate_hours !== null ? parseInt(row.rate_hours, 10) : null,
      // Ensure all other numeric fields from Transaction type are correctly parsed if needed
      accepted_by_user_id: row.accepted_by_user_id ? Number(row.accepted_by_user_id) : null,
      declined_by_user_id: row.declined_by_user_id ? Number(row.declined_by_user_id) : null,
      check_out_by_user_id: row.check_out_by_user_id ? Number(row.check_out_by_user_id) : null,
      total_amount: row.total_amount ? parseFloat(row.total_amount) : null,
      tender_amount: row.tender_amount ? parseFloat(row.tender_amount) : null,
      hours_used: row.hours_used ? Number(row.hours_used) : null,
    }));
  } catch (error) {
    // console.error('Failed to fetch unassigned reservations:', error);
    throw new Error(`Database error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}
    
    