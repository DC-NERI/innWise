
export type UserRole = "admin" | "sysad" | "staff";

export interface AuthenticatedUser {
  id: string;
  username: string;
  role: UserRole;
  lastLogIn?: Date;
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
  branch_name: string;
  branch_code: string;
  branch_address?: string | null;
  contact_number?: string | null;
  email_address?: string | null;
  created_at: string; // ISO date string
  updated_at: string; // ISO date string
}
