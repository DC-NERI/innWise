
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
  hotel_rate_id: number;
  rate_name?: string | null; // For display
  room_name: string;
  room_code: string;
  floor?: number | null;
  room_type?: string | null;
  bed_type?: string | null;
  capacity?: number | null;
  is_available: boolean;
  status: string; // '0' or '1'
  created_at: string; // ISO date string
  updated_at: string; // ISO date string
  // Fields for active transaction display
  active_transaction_id?: number | null;
  active_transaction_check_in_time?: string | null;
  active_transaction_client_name?: string | null;
}

// For simpler rate selection
export interface SimpleRate {
  id: number;
  name: string;
}

export interface Transaction {
    id: number;
    tenant_id: number;
    branch_id: number;
    hotel_room_id: number;
    hotel_rate_id: number;
    client_name: string;
    client_payment_method: string;
    notes?: string | null;
    check_in_time: string; // ISO date string
    check_out_time?: string | null; // ISO date string
    hours_used?: number | null;
    total_amount?: number | null; // Stored as numeric, handle as number
    check_out_by_user_id?: number | null;
    status: string; // '0' for active, '1' for completed/checked-out
    created_at: string; // ISO date string
    updated_at: string; // ISO date string
    // Optional joined data for display
    room_name?: string;
    rate_name?: string;
    checked_out_by_username?: string;
}
