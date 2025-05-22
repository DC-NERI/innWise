
import type { z } from 'zod';

export type UserRole = "admin" | "sysad" | "staff" | "housekeeping";

export interface User {
  id: string | number;
  tenant_id?: number | null;
  tenant_name?: string | null;
  tenant_branch_id?: number | null;
  branch_name?: string | null;
  first_name: string;
  last_name: string;
  username: string;
  email?: string | null;
  role: UserRole;
  status: string;
  created_at: string;
  updated_at: string;
  last_log_in?: string | null;
}

export interface SimpleUser {
  id: number;
  username: string;
  first_name?: string;
  last_name?: string;
}


export interface Tenant {
  id: number;
  tenant_name: string;
  tenant_address?: string | null;
  tenant_email?: string | null;
  tenant_contact_info?: string | null;
  max_branch_count?: number | null;
  max_user_count?: number | null;
  created_at: string;
  updated_at: string;
  status: string;
}

export interface Branch {
  id: number;
  tenant_id: number;
  tenant_name?: string;
  branch_name: string;
  branch_code: string;
  branch_address?: string | null;
  contact_number?: string | null;
  email_address?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}


export interface SimpleBranch {
  id: number;
  branch_name: string;
}

export interface HotelRate {
  id: number;
  tenant_id: number;
  branch_id: number;
  branch_name?: string;
  name: string;
  price: number;
  hours: number;
  excess_hour_price?: number | null;
  description?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface HotelRoom {
  id: number;
  tenant_id: number;
  branch_id: number;
  branch_name?: string;
  hotel_rate_id: number[] | null; // Array of rate IDs
  rate_names?: string[]; // For display
  room_name: string;
  room_code: string;
  floor?: number | null;
  room_type?: string | null;
  bed_type?: string | null;
  capacity?: number | null;
  is_available: number; // 0: Available, 1: Occupied, 2: Reserved
  cleaning_status?: string | null;
  cleaning_notes?: string | null;
  status: string; // '0' or '1' for room definition status
  transaction_id?: number | null; // Link to the active transaction
  created_at: string;
  updated_at: string;

  // Fields populated from joined active transaction
  active_transaction_id?: number | null;
  active_transaction_client_name?: string | null;
  active_transaction_check_in_time?: string | null;
  active_transaction_rate_name?: string | null;
  active_transaction_status?: string | null;
  active_transaction_rate_hours?: number | null;
}


export interface SimpleRate {
  id: number;
  name: string;
  price: number;
  hours: number;
}

export interface Transaction {
    id: number;
    tenant_id: number;
    branch_id: number;
    hotel_room_id: number | null;
    hotel_rate_id: number | null;
    client_name: string;
    client_payment_method: string | null;
    notes?: string | null;
    check_in_time: string | null;
    check_out_time?: string | null;
    hours_used?: number | null;
    total_amount?: number | null;
    tender_amount?: number | null; // Added for storing tender amount
    is_paid?: number | null; // 0 for unpaid, 1 for paid
    created_by_user_id: number;
    check_out_by_user_id?: number | null;
    accepted_by_user_id?: number | null;
    declined_by_user_id?: number | null;
    status: string; // '0' Unpaid, '1' Paid, '2' Advance Paid, '3' Cancelled, '4' Advance Reservation, '5' Pending Branch Acceptance
    created_at: string;
    updated_at: string;
    reserved_check_in_datetime?: string | null;
    reserved_check_out_datetime?: string | null;
    is_admin_created?: number | null; // 0 = default, 1 = admin created
    is_accepted?: number | null; // 0=Default, 1=Not Accepted, 2=Accepted, 3=Pending

    // For display purposes, joined from other tables
    room_name?: string | null;
    rate_name?: string | null;
    rate_price?: number | null;
    rate_hours?: number | null;
    rate_excess_hour_price?: number | null;
    checked_out_by_username?: string;
}


export interface GroupedRooms {
  [floor: string]: HotelRoom[];
}

export interface Notification {
  id: number;
  tenant_id: number;
  message: string;
  status: number; // 0 for unread, 1 for read
  target_branch_id?: number | null;
  target_branch_name?: string | null;
  creator_user_id?: number | null;
  creator_username?: string | null;
  transaction_id?: number | null;
  created_at: string;
  read_at?: string | null;
  transaction_status: number; // 0 for Pending Action, 1 for Reservation Created
  transaction_is_accepted?: number | null; // From joined transaction.is_accepted
  linked_transaction_status?: string | null; // From joined transaction.status

  notification_type?: string | null;
  priority?: number | null;
  acknowledged_at?: string | null;
  acknowledged_by_user_id?: number | null;
}

export type RoomCleaningStatusUpdateData = z.infer<typeof import('@/lib/schemas').roomCleaningStatusAndNotesUpdateSchema>;
export type CheckoutFormData = z.infer<typeof import('@/lib/schemas').checkoutFormSchema>;

export interface RoomCleaningLog {
    id: number;
    room_id: number;
    room_cleaning_status: string;
    notes?: string | null;
    user_id?: number | null;
    created_at: string;
}
