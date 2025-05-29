
import type { z } from 'zod';
import type {
    transactionObjectSchema,
    roomCleaningStatusAndNotesUpdateSchema,
    checkoutFormSchema,
    StaffBookingCreateData,
    TransactionCreateData,
    adminResetPasswordSchema,
    transactionUpdateNotesSchema, // Import the new schema
    transactionReservedUpdateSchema, // Import the new schema
} from '@/lib/schemas';
import type {
    ROOM_AVAILABILITY_STATUS,
    ROOM_CLEANING_STATUS,
    TRANSACTION_LIFECYCLE_STATUS,
    TRANSACTION_PAYMENT_STATUS,
    NOTIFICATION_STATUS,
    NOTIFICATION_TRANSACTION_LINK_STATUS,
    TRANSACTION_IS_ACCEPTED_STATUS,
    HOTEL_ENTITY_STATUS,
    LOST_AND_FOUND_STATUS,
    LOGIN_LOG_STATUS
} from '@/lib/constants';


export type UserRole = "admin" | "sysad" | "staff" | "housekeeping";

export interface User {
  id: number;
  tenant_id?: number | null;
  tenant_name?: string | null;
  tenant_branch_id?: number | null;
  branch_name?: string | null;
  first_name: string;
  last_name: string;
  username: string;
  email?: string | null;
  role: UserRole;
  status: string; // '0' or '1' from HOTEL_ENTITY_STATUS
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
  status: string; // '0', '1', or '2' from HOTEL_ENTITY_STATUS
  theme_primary_hsl?: string | null;
  theme_secondary_hsl?: string | null;
  theme_accent_hsl?: string | null;
  theme_background_hsl?: string | null;
  theme_foreground_hsl?: string | null;
  theme_logo_url?: string | null;
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
  status: string; // '0' or '1' from HOTEL_ENTITY_STATUS
  created_at: string;
  updated_at: string;
}


export interface SimpleBranch {
  id: number;
  branch_name: string;
  status?: string; // '0' or '1' from HOTEL_ENTITY_STATUS
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
  status: string; // '0' or '1' from HOTEL_ENTITY_STATUS
  created_at: string;
  updated_at: string;
}

export interface HotelRoom {
  id: number;
  tenant_id: number;
  branch_id: number;
  branch_name?: string;
  hotel_rate_id: number[] | null; // Array of rate IDs
  rate_names?: string[]; // For display, if fetched
  transaction_id?: number | null; // Foreign key to transactions for the active booking
  room_name: string;
  room_code: string;
  floor?: number | null;
  room_type?: string | null;
  bed_type?: string | null;
  capacity?: number | null;
  is_available: number; // 0: Available, 1: Occupied, 2: Reserved
  cleaning_status: number; // 0: Clean, 1: Dirty, 2: Inspection, 3: Out of Order
  cleaning_notes?: string | null;
  status: string; // '0' or '1' from HOTEL_ENTITY_STATUS (for room definition)
  created_at: string;
  updated_at: string;

  // Fields populated by JOIN for active transaction details
  active_transaction_id?: number | null; // This is usually the same as room.transaction_id if linked
  active_transaction_client_name?: string | null;
  active_transaction_check_in_time?: string | null;
  active_transaction_rate_name?: string | null;
  active_transaction_rate_hours?: number | null;
  active_transaction_lifecycle_status?: number | null;
}


export interface SimpleRate {
  id: number;
  name: string;
  price: number;
  hours: number;
  status?: string;
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
    check_in_time: string | null; // Can be null for future reservations
    check_out_time?: string | null;
    hours_used?: number | null;
    total_amount?: number | null;
    tender_amount?: number | null;
    is_paid: number | null; // 0: Unpaid, 1: Paid, 2: Advance Paid
    created_by_user_id: number;
    check_out_by_user_id?: number | null;
    accepted_by_user_id?: number | null;
    declined_by_user_id?: number | null;
    status: number; // 0-6 from TRANSACTION_LIFECYCLE_STATUS
    created_at: string;
    updated_at: string;
    reserved_check_in_datetime?: string | null;
    reserved_check_out_datetime?: string | null;
    is_admin_created?: number | null; // 0 or 1
    is_accepted?: number | null; // 0-3 from TRANSACTION_IS_ACCEPTED_STATUS

    // Joined fields for display
    room_name?: string | null;
    rate_name?: string | null;
    rate_price?: number | null;
    rate_hours?: number | null;
    rate_excess_hour_price?: number | null;
    created_by_username?: string;
    checked_out_by_username?: string; // Username of staff who processed checkout
    accepted_by_username?: string;
    declined_by_username?: string;
}


export interface GroupedRooms {
  [floor: string]: HotelRoom[];
}

export interface Notification {
  id: number;
  tenant_id: number;
  message: string;
  status: number; // 0: Unread, 1: Read (NOTIFICATION_STATUS)
  target_branch_id?: number | null;
  target_branch_name?: string | null;
  creator_user_id?: number | null;
  creator_username?: string | null;
  transaction_id?: number | null;
  created_at: string;
  read_at?: string | null;
  transaction_status: number; // (NOTIFICATION_TRANSACTION_LINK_STATUS)
  transaction_is_accepted?: number | null; // 0-3 (TRANSACTION_IS_ACCEPTED_STATUS)
  linked_transaction_lifecycle_status?: number | null; // String from DB, converted to number

  notification_type?: string | null;
  priority?: number | null;
  acknowledged_at?: string | null;
  acknowledged_by_user_id?: number | null;
}

export type RoomCleaningStatusUpdateData = z.infer<typeof roomCleaningStatusAndNotesUpdateSchema>;
export type CheckoutFormData = z.infer<typeof checkoutFormSchema>;

export interface RoomCleaningLog {
    id: number;
    room_id: number;
    tenant_id: number;
    branch_id: number;
    room_cleaning_status: number; // Uses ROOM_CLEANING_STATUS
    notes?: string | null;
    user_id?: number | null;
    created_at: string;
}

// Re-exporting from schemas.ts to keep type definitions centralized if they're simple inferences
export type TransactionUpdateNotesData = z.infer<typeof transactionUpdateNotesSchema>;
export type TransactionReservedUpdateData = z.infer<typeof transactionReservedUpdateSchema>;

export type { StaffBookingCreateData };
export type { TransactionCreateData };


export interface LostAndFoundLog {
  id: number;
  tenant_id: number;
  branch_id: number;
  branch_name?: string;
  item_name: string; // from 'item' column in DB
  description?: string | null;
  found_location?: string | null;
  reported_by_user_id?: number | null;
  reported_by_username?: string | null;
  status: number; // 0: Found, 1: Claimed, 2: Disposed
  found_at: string;
  updated_at: string;
  claimed_at?: string | null;
  claimed_by_details?: string | null;
  disposed_details?: string | null;
}

export interface PaymentMethodSaleSummary {
  payment_method: string;
  total_sales: number;
  transaction_count: number;
}

export interface RateTypeSaleSummary {
  rate_id: number | null;
  rate_name: string;
  total_sales: number;
  transaction_count: number;
}

export interface DailySaleSummary {
  sale_date: string; // YYYY-MM-DD
  total_sales: number;
  transaction_count: number;
}

export interface AdminDashboardSummary {
  totalSales: number;
  branchPerformance: Array<{
    branch_id: number;
    branch_name: string;
    transaction_count: number;
    total_sales: number;
  }>;
  salesByPaymentMethod?: PaymentMethodSaleSummary[];
  salesByRateType?: RateTypeSaleSummary[];
  dailySales?: DailySaleSummary[];
  detailedTransactions?: Transaction[]; // Added for the detailed transaction list
}

export interface ActivityLog {
  id: number;
  tenant_id: number | null;
  tenant_name?: string | null;
  branch_id: number | null;
  branch_name?: string | null;
  user_id: number | null;
  username: string | null;
  action_type: string;
  description: string | null;
  target_entity_type?: string | null;
  target_entity_id?: string | null;
  details?: Record<string, any> | null;
  created_at: string;
}

export type AdminResetPasswordData = z.infer<typeof adminResetPasswordSchema>;

export interface SystemOverviewData {
  totalActiveTenants: number;
  totalActiveBranches: number;
  userCountsByRole: {
    sysad: number;
    admin: number;
    staff: number;
    housekeeping: number;
  };
}

export interface LoginLog {
  id: number;
  user_id: number | null;
  username?: string | null; // Joined from users table
  login_time: string; // TIMESTAMPTZ as string
  ip_address: string | null;
  user_agent: string | null;
  status: number; // 0 for failed, 1 for success (LOGIN_LOG_STATUS)
  error_details: string | null;
}
