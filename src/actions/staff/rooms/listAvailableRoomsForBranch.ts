
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
import type { HotelRoom } from '@/lib/types';
import { ROOM_AVAILABILITY_STATUS, ROOM_CLEANING_STATUS, HOTEL_ENTITY_STATUS } from '../../../lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in staff/rooms/listAvailableRoomsForBranch action', err);
});

export async function listAvailableRoomsForBranch(tenantId: number, branchId: number): Promise<HotelRoom[]> {
  if (typeof HOTEL_ENTITY_STATUS?.ACTIVE === 'undefined' ||
      typeof ROOM_AVAILABILITY_STATUS?.AVAILABLE === 'undefined' ||
      typeof ROOM_CLEANING_STATUS?.CLEAN === 'undefined') {
    console.error('[listAvailableRoomsForBranch] CRITICAL ERROR: Constants are undefined. Check imports and constants.ts file.');
    throw new Error('Server configuration error: Required constants for room availability are undefined.');
  }
  
  const client = await pool.connect();
  try {
    const query = `
      SELECT 
        hr.id, 
        hr.room_name, 
        hr.room_code, 
        hr.hotel_rate_id, 
        hr.is_available,
        hr.cleaning_status
      FROM hotel_room hr
      WHERE hr.tenant_id = $1 
        AND hr.branch_id = $2
        AND hr.status = $3 -- Room definition is active
        AND hr.is_available = $4 -- Room booking status is available
        AND hr.cleaning_status = $5 -- Room is clean
      ORDER BY hr.room_name;
    `;
    const res = await client.query(query, [
        tenantId, 
        branchId, 
        HOTEL_ENTITY_STATUS.ACTIVE, 
        ROOM_AVAILABILITY_STATUS.AVAILABLE,
        ROOM_CLEANING_STATUS.CLEAN
    ]);
    return res.rows.map(row => {
        let parsedRateIds: number[] | null = null;
        try {
            if (row.hotel_rate_id) {
                const rawRateId = row.hotel_rate_id;
                if (Array.isArray(rawRateId) && rawRateId.every(item => typeof item === 'number')) {
                    parsedRateIds = rawRateId;
                } else if (typeof rawRateId === 'string') {
                    const parsed = JSON.parse(rawRateId);
                    if (Array.isArray(parsed) && parsed.every(item => typeof item === 'number')) {
                    parsedRateIds = parsed;
                    }
                } else if (typeof rawRateId === 'object' && rawRateId !== null) {
                    const values = Object.values(rawRateId);
                    if (values.every(item => typeof item === 'number')) {
                    parsedRateIds = values as number[];
                    }
                }
            }
        } catch (e) {
            // console.error(\`Failed to parse hotel_rate_id JSON for room \${row.id}: \${row.hotel_rate_id}\`, e);
        }
        return {
            // Cast to HotelRoom to satisfy partial type; only relevant fields for this action are populated
            id: Number(row.id),
            tenant_id: Number(tenantId), // these come from params, not row directly
            branch_id: Number(branchId), // these come from params, not row directly
            room_name: row.room_name,
            room_code: row.room_code,
            hotel_rate_id: parsedRateIds,
            is_available: Number(row.is_available),
            cleaning_status: Number(row.cleaning_status),
            status: HOTEL_ENTITY_STATUS.ACTIVE, // Assuming these are active rooms
            created_at: '', // Placeholder, not fetched
            updated_at: '', // Placeholder, not fetched
        } as HotelRoom; 
    });
  } catch (error) {
    console.error('[listAvailableRoomsForBranch DB Error]', error);
    throw new Error(`Database error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}
    
