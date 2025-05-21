
export type UserRole = "admin" | "sysad" | "staff";

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
  hotel_rate_id: number[] | null;
  rate_names?: string[];
  room_name: string;
  room_code: string;
  floor?: number | null;
  room_type?: string | null;
  bed_type?: string | null;
  capacity?: number | null;
  is_available: number; // 0: Available, 1: Occupied, 2: Reserved
  cleaning_status?: string | null; // e.g., 'clean', 'dirty', 'inspection', 'out_of_order'
  status: string;
  transaction_id?: number | null;
  created_at: string;
  updated_at: string;

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
    check_in_time: string;
    check_out_time?: string | null;
    hours_used?: number | null;
    total_amount?: number | null;
    created_by_user_id: number;
    check_out_by_user_id?: number | null;
    status: string;
    created_at: string;
    updated_at: string;
    reserved_check_in_datetime?: string | null;
    reserved_check_out_datetime?: string | null;
    is_admin_created?: number | null;
    is_accepted?: number | null;
    accepted_by_user_id?: number | null;
    declined_by_user_id?: number | null;

    room_name?: string | null;
    rate_name?: string | null;
    checked_out_by_username?: string;
}


export interface GroupedRooms {
  [floor: string]: HotelRoom[];
}

export interface Notification {
  id: number;
  tenant_id: number;
  message: string;
  status: number; // 0: unread, 1: read (from NOTIFICATION_STATUS)
  target_branch_id?: number | null;
  target_branch_name?: string | null;
  creator_user_id?: number | null;
  creator_username?: string | null;
  transaction_id?: number | null;
  created_at: string;
  read_at?: string | null;
  transaction_status: number; // From NOTIFICATION_TRANSACTION_STATUS
  transaction_is_accepted?: number | null; // From TRANSACTION_IS_ACCEPTED_STATUS
  linked_transaction_status?: string | null; // From TRANSACTION_STATUS

  // New fields for notification enhancements
  notification_type?: string | null; // e.g., 'General', 'ReservationRequest', 'Maintenance'
  priority?: number | null; // e.g., 0 for Normal, 1 for High
  acknowledged_at?: string | null;
  acknowledged_by_user_id?: number | null;
}

// For guest charges - simplified
export interface GuestCharge {
  id: number;
  transaction_id: number;
  item_description: string;
  amount: number;
  quantity: number;
  charge_datetime: string;
  charged_by_user_id?: number | null;
}

// For shift logs - simplified
export interface ShiftLog {
  id: number;
  user_id: number;
  username?: string; // For display
  log_datetime: string;
  message: string;
  category?: string | null;
}
