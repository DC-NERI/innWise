
export type UserRole = "admin" | "sysad" | "staff";

export interface User { // Renamed from AuthenticatedUser for broader use
  id: string | number; // number from DB, string for some contexts
  tenant_id?: number | null;
  tenant_name?: string | null; // For listing users with their tenant
  tenant_branch_id?: number | null;
  branch_name?: string | null; // For displaying branch name
  first_name: string;
  last_name: string;
  username: string;
  email?: string | null;
  role: UserRole;
  status: string; // Ensure status is always present
  created_at: string; // ISO date string
  updated_at: string; // ISO date string
  last_log_in?: string | null; // ISO date string
  userId?: number; // from login result, ensure consistency
}

export interface Tenant {
  id: number;
  tenant_name: string;
  tenant_address?: string | null;
  tenant_email?: string | null;
  tenant_contact_info?: string | null;
  max_branch_count?: number | null;
  max_user_count?: number | null;
  created_at: string; // ISO date string
  updated_at: string; // ISO date string
  status: string;
}

export interface Branch {
  id: number;
  tenant_id: number;
  tenant_name?: string; // Optional: for listing branches with tenant name
  branch_name: string;
  branch_code: string;
  branch_address?: string | null;
  contact_number?: string | null;
  email_address?: string | null;
  status: string;
  created_at: string; // ISO date string
  updated_at: string; // ISO date string
}

// For simpler branch selection
export interface SimpleBranch {
  id: number;
  branch_name: string;
}

export interface HotelRate {
  id: number;
  tenant_id: number;
  branch_id: number;
  branch_name?: string; // For display
  name: string;
  price: number;
  hours: number;
  excess_hour_price?: number | null;
  description?: string | null;
  status: string; // '0' or '1'
  created_at: string; // ISO date string
  updated_at: string; // ISO date string
}

export interface HotelRoom {
  id: number;
  tenant_id: number;
  branch_id: number;
  branch_name?: string; // For display
  hotel_rate_id: number[] | null; // Updated to array
  rate_names?: string[]; // For display, derived from hotel_rate_id
  room_name: string;
  room_code: string;
  floor?: number | null;
  room_type?: string | null;
  bed_type?: string | null;
  capacity?: number | null;
  is_available: number; // 0: Available, 1: Occupied, 2: Reserved (was boolean)
  status: string; // '0' or '1' (for the room record itself, not booking status)
  created_at: string; // ISO date string
  updated_at: string; // ISO date string
  active_transaction_id?: number | null;
  active_transaction_client_name?: string | null;
  active_transaction_check_in_time?: string | null; // This is actual check_in_time for occupied, or reservation creation time for reserved
  active_transaction_rate_name?: string | null;
}

// For simpler rate selection
export interface SimpleRate {
  id: number;
  name: string;
  price: number;
}

export interface Transaction {
    id: number;
    tenant_id: number;
    branch_id: number;
    hotel_room_id: number | null; // Made nullable for unassigned reservations
    hotel_rate_id: number | null; // Made nullable as rate can be optional
    client_name: string;
    client_payment_method: string | null; // Made nullable as payment method can be optional
    notes?: string | null;
    check_in_time: string; // ISO date string (for unassigned, this is reservation creation time; for assigned, actual check-in)
    check_out_time?: string | null; // ISO date string
    hours_used?: number | null;
    total_amount?: number | null;
    created_by_user_id: number;
    check_out_by_user_id?: number | null;
    status: string; // '0': Unpaid/Occupied, '1': Paid, '2': Advance Paid (no room assigned yet), '3': Cancelled, '4': Advance Reservation (future date)
    created_at: string; // ISO date string
    updated_at: string; // ISO date string
    reserved_check_in_datetime?: string | null; // For status '4'
    reserved_check_out_datetime?: string | null; // For status '4'
    room_name?: string | null; // From join if room assigned
    rate_name?: string | null; // From join with hotel_rates
    checked_out_by_username?: string;
}
