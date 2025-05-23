
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
// Corrected import path assuming listRoomsForBranch.ts is in src/actions/admin/rooms/
import { TRANSACTION_LIFECYCLE_STATUS, HOTEL_ENTITY_STATUS, ROOM_CLEANING_STATUS } from '../../../lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/rooms/listRoomsForBranch action', err);
});

export async function listRoomsForBranch(branchId: number, tenantId: number): Promise<HotelRoom[]> {
  // Debugging: Log imported constants
  // console.log('[listRoomsForBranch] Imported TRANSACTION_LIFECYCLE_STATUS:', JSON.stringify(TRANSACTION_LIFECYCLE_STATUS));
  // console.log('[listRoomsForBranch] Imported HOTEL_ENTITY_STATUS:', JSON.stringify(HOTEL_ENTITY_STATUS));

  if (!branchId || !tenantId) {
    return [];
  }
  if (typeof TRANSACTION_LIFECYCLE_STATUS?.CHECKED_IN === 'undefined' ||
      typeof HOTEL_ENTITY_STATUS?.ACTIVE === 'undefined') {
    console.error('[listRoomsForBranch] CRITICAL ERROR: Constants are undefined. Check imports and constants.ts file.');
    throw new Error('Server configuration error: Required constants are undefined.');
  }

  const client = await pool.connect();
  try {
    const query = `
      SELECT
        hr.id,
        hr.tenant_id,
        hr.branch_id,
        hr.hotel_rate_id,
        hr.transaction_id AS room_transaction_id_fk,
        hr.room_name,
        hr.room_code,
        hr.floor,
        hr.room_type,
        hr.bed_type,
        hr.capacity,
        hr.is_available,
        hr.cleaning_status,
        hr.cleaning_notes,
        hr.status AS room_definition_status,
        t_active.id AS active_transaction_id,
        t_active.client_name AS active_transaction_client_name,
        t_active.check_in_time AS active_transaction_check_in_time,
        t_active.reserved_check_in_datetime AS active_transaction_reserved_check_in_time,
        hrt_active.name AS active_transaction_rate_name,
        hrt_active.hours AS active_transaction_rate_hours,
        t_active.status AS active_transaction_lifecycle_status
      FROM hotel_room hr
      LEFT JOIN transactions t_active ON hr.transaction_id = t_active.id
          AND t_active.tenant_id = hr.tenant_id
          AND t_active.branch_id = hr.branch_id
          AND (
                t_active.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN} OR
                t_active.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM} OR
                t_active.status::INTEGER = ${TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM}
              )
      LEFT JOIN hotel_rates hrt_active ON t_active.hotel_rate_id = hrt_active.id
          AND hrt_active.tenant_id = hr.tenant_id
          AND hrt_active.branch_id = hr.branch_id
          AND hrt_active.status = '${HOTEL_ENTITY_STATUS.ACTIVE}'
      WHERE hr.branch_id = $1 AND hr.tenant_id = $2 AND hr.status = '${HOTEL_ENTITY_STATUS.ACTIVE}'
      ORDER BY hr.floor, hr.room_code;
    `;

    const res = await client.query(query, [branchId, tenantId]);

    return res.rows.map(row => {
      let parsedRateIds: number[] | null = null;
      try {
        if (row.hotel_rate_id) {
          // Ensure it's parsed as an array of numbers, accommodating different JSON structures
          const rawRateId = row.hotel_rate_id;
          if (Array.isArray(rawRateId) && rawRateId.every(item => typeof item === 'number')) {
            parsedRateIds = rawRateId;
          } else if (typeof rawRateId === 'string') {
            const parsed = JSON.parse(rawRateId);
            if (Array.isArray(parsed) && parsed.every(item => typeof item === 'number')) {
              parsedRateIds = parsed;
            }
          } else if (typeof rawRateId === 'object' && rawRateId !== null) {
            // Handle cases where it might be an object like {0: id1, 1: id2}
            const values = Object.values(rawRateId);
            if (values.every(item => typeof item === 'number')) {
              parsedRateIds = values as number[];
            }
          }
        }
      } catch (e) {
        // console.error(\`Failed to parse hotel_rate_id JSON for room \${row.id}: \${row.hotel_rate_id}\`, e);
        // Keep parsedRateIds as null or empty array if parsing fails
      }

      const hotelRoom: HotelRoom = {
        id: Number(row.id),
        tenant_id: Number(row.tenant_id),
        branch_id: Number(row.branch_id),
        hotel_rate_id: parsedRateIds,
        transaction_id: row.room_transaction_id_fk ? Number(row.room_transaction_id_fk) : null,
        room_name: row.room_name,
        room_code: row.room_code,
        floor: row.floor ? Number(row.floor) : null,
        room_type: row.room_type,
        bed_type: row.bed_type,
        capacity: row.capacity ? Number(row.capacity) : null,
        is_available: Number(row.is_available),
        cleaning_status: Number(row.cleaning_status), // Assuming cleaning_status is numeric
        cleaning_notes: row.cleaning_notes,
        status: String(row.room_definition_status), // Ensure status is string '0' or '1'

        // Active transaction details are now directly from the joined t_active
        active_transaction_id: row.active_transaction_id ? Number(row.active_transaction_id) : null,
        active_transaction_client_name: row.active_transaction_client_name,
        active_transaction_check_in_time: row.active_transaction_check_in_time, // Already a string
        active_transaction_rate_name: row.active_transaction_rate_name,
        active_transaction_rate_hours: row.active_transaction_rate_hours ? parseInt(row.active_transaction_rate_hours, 10) : null,
        active_transaction_lifecycle_status: row.active_transaction_lifecycle_status !== null ? Number(row.active_transaction_lifecycle_status) : null,

        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
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
