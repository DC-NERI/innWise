
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
import type { HotelRoom } from '@/lib/types';
import { ROOM_AVAILABILITY_STATUS, HOTEL_ENTITY_STATUS, TRANSACTION_LIFECYCLE_STATUS, ROOM_CLEANING_STATUS } from '@/lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/rooms/listRoomsForBranch action', err);
});

export async function listRoomsForBranch(branchId: number, tenantId: number): Promise<HotelRoom[]> {
  if (!branchId || !tenantId) {
    return [];
  }
  const client = await pool.connect();
  try {
    const query = `
      SELECT
        hr.id,
        hr.tenant_id,
        hr.branch_id,
        hr.hotel_rate_id, -- This is JSONB
        hr.transaction_id, -- This is the FK from hotel_room to transactions
        hr.room_name,
        hr.room_code,
        hr.floor,
        hr.room_type,
        hr.bed_type,
        hr.capacity,
        hr.is_available, -- This is now integer: 0=Available, 1=Occupied, 2=Reserved
        hr.cleaning_status,
        hr.cleaning_notes,
        hr.status AS room_definition_status, -- Renamed to avoid conflict with transaction.status
        t_active.client_name AS active_transaction_client_name,
        t_active.check_in_time AS active_transaction_check_in_time,
        t_active.reserved_check_in_datetime AS active_transaction_reserved_check_in_time, -- for reservations
        hrt_active.name AS active_transaction_rate_name,
        hrt_active.hours AS active_transaction_rate_hours,
        t_active.status AS active_transaction_lifecycle_status -- lifecycle status of the active transaction
      FROM hotel_room hr
      LEFT JOIN transactions t_active ON hr.transaction_id = t_active.id
          AND t_active.tenant_id = hr.tenant_id
          AND t_active.branch_id = hr.branch_id
          -- Fetch details if transaction is Unpaid, Advance Paid, Advance Reservation, or Pending Branch Acceptance
          AND (
                t_active.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN} OR
                t_active.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM} OR 
                t_active.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM} OR 
                t_active.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.RESERVATION_ADMIN_CREATED_PENDING_BRANCH_ACCEPTANCE}
              )
      LEFT JOIN hotel_rates hrt_active ON t_active.hotel_rate_id = hrt_active.id
          AND hrt_active.tenant_id = hr.tenant_id
          AND hrt_active.branch_id = hr.branch_id
          AND hrt_active.status = '${HOTEL_ENTITY_STATUS.ACTIVE}' -- Only consider active rates for transaction details
      WHERE hr.branch_id = $1 AND hr.tenant_id = $2 AND hr.status = '${HOTEL_ENTITY_STATUS.ACTIVE}'
      ORDER BY hr.floor, hr.room_code;
    `;

    const res = await client.query(query, [branchId, tenantId]);

    return res.rows.map(row => {
      let parsedRateIds: number[] | null = null;
      try {
        if (row.hotel_rate_id) {
          if (Array.isArray(row.hotel_rate_id)) {
            if (row.hotel_rate_id.every((item: any) => typeof item === 'number')) {
                 parsedRateIds = row.hotel_rate_id as number[];
            }
          } else if (typeof row.hotel_rate_id === 'string') {
            const data = JSON.parse(row.hotel_rate_id);
            if (Array.isArray(data) && data.every(item => typeof item === 'number')) {
              parsedRateIds = data;
            }
          } else if (typeof row.hotel_rate_id === 'object' && row.hotel_rate_id !== null) {
            const data = Object.values(row.hotel_rate_id);
            if (Array.isArray(data) && data.every(item => typeof item === 'number')) {
              parsedRateIds = data;
            }
          }
        }
      } catch (e) {
        const errorMessage = "Failed to parse hotel_rate_id JSON for room " + row.id + ": " + row.hotel_rate_id;
        console.error(errorMessage, e);
      }
      
      let displayCheckInTime = null;
      if (Number(row.is_available) === ROOM_AVAILABILITY_STATUS.OCCUPIED && row.active_transaction_check_in_time) {
          displayCheckInTime = row.active_transaction_check_in_time;
      } else if (Number(row.is_available) === ROOM_AVAILABILITY_STATUS.RESERVATION_WITH_ROOM && row.active_transaction_reserved_check_in_time) {
          displayCheckInTime = row.active_transaction_reserved_check_in_time;
      }

      const hotelRoom: HotelRoom = {
        id: row.id,
        tenant_id: row.tenant_id,
        branch_id: row.branch_id,
        hotel_rate_id: parsedRateIds,
        transaction_id: row.transaction_id ? Number(row.transaction_id) : null,
        room_name: row.room_name,
        room_code: row.room_code,
        floor: row.floor ? Number(row.floor) : null,
        room_type: row.room_type,
        bed_type: row.bed_type,
        capacity: row.capacity ? Number(row.capacity) : null,
        is_available: Number(row.is_available),
        cleaning_status: row.cleaning_status ? Number(row.cleaning_status) : ROOM_CLEANING_STATUS.CLEAN,
        cleaning_notes: row.cleaning_notes,
        status: row.room_definition_status,
        
        active_transaction_id: row.transaction_id ? Number(row.transaction_id) : null,
        active_transaction_client_name: row.active_transaction_client_name,
        active_transaction_check_in_time: displayCheckInTime,
        active_transaction_rate_name: row.active_transaction_rate_name,
        active_transaction_rate_hours: row.active_transaction_rate_hours ? parseInt(row.active_transaction_rate_hours, 10) : null,
        active_transaction_lifecycle_status: row.active_transaction_lifecycle_status !== null ? Number(row.active_transaction_lifecycle_status) : null,
        
        created_at: row.created_at, 
        updated_at: row.updated_at,
      };
      return hotelRoom;
    });
  } catch (error) {
    console.error('[listRoomsForBranch DB Error]', error);
    throw new Error(`Database error while fetching rooms: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}
    
