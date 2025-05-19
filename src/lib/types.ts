
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
  status: string; // Added status for branch
  created_at: string; // ISO date string
  updated_at: string; // ISO date string
}

// For simpler branch selection
export interface SimpleBranch {
  id: number;
  branch_name: string;
}

