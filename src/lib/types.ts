
export type UserRole = "admin" | "sysad" | "staff";

export interface User { // Renamed from AuthenticatedUser for broader use
  id: string | number; // number from DB, string for some contexts
  tenant_id?: number | null;
  tenant_name?: string | null; // For listing users with their tenant
  first_name: string;
  last_name: string;
  username: string;
  email?: string | null;
  role: UserRole;
  status?: string;
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
  created_at: string; // ISO date string
  updated_at: string; // ISO date string
}
