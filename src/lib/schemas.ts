
import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

// For Admin role updating branches of their tenant
export const branchUpdateSchema = z.object({
  branch_name: z.string().min(1, "Branch name is required").max(255, "Branch name too long"),
  branch_address: z.string().max(1000, "Address too long").optional().nullable(),
  contact_number: z.string().max(100, "Contact number too long").optional().nullable(),
  email_address: z.string().email("Invalid email address").max(255, "Email too long").optional().nullable(),
});

export const tenantCreateSchema = z.object({
  tenant_name: z.string().min(1, "Tenant name is required").max(255, "Tenant name too long"),
  tenant_address: z.string().max(1000, "Address too long").optional().nullable(),
  tenant_email: z.string().email("Invalid email address").max(255, "Email too long").optional().nullable(),
  tenant_contact_info: z.string().max(100, "Contact number too long").optional().nullable(),
});
export type TenantCreateData = z.infer<typeof tenantCreateSchema>;

export const tenantUpdateSchema = tenantCreateSchema.extend({
  status: z.enum(['0', '1']).default('1'), 
}); 
export type TenantUpdateData = z.infer<typeof tenantUpdateSchema>;


export const userCreateSchema = z.object({
  first_name: z.string().min(1, "First name is required").max(100),
  last_name: z.string().min(1, "Last name is required").max(100),
  username: z.string().min(1, "Username is required").max(100),
  password: z.string().min(6, "Password must be at least 6 characters").max(100),
  email: z.string().email("Invalid email address").max(255).optional().nullable(),
  role: z.enum(["admin", "staff", "sysad"]).default("staff"),
  tenant_id: z.number().int().positive().optional().nullable(),
  tenant_branch_id: z.number().int().positive().optional().nullable(),
});
export type UserCreateData = z.infer<typeof userCreateSchema>;

// Schema for Admin creating users (tenant_id implicit, role limited)
export const userCreateSchemaAdmin = z.object({
  first_name: z.string().min(1, "First name is required").max(100),
  last_name: z.string().min(1, "Last name is required").max(100),
  username: z.string().min(1, "Username is required").max(100),
  password: z.string().min(6, "Password must be at least 6 characters").max(100),
  email: z.string().email("Invalid email address").max(255).optional().nullable(),
  role: z.enum(["admin", "staff"]).default("staff"), // Admin can only create admin or staff
  tenant_branch_id: z.number().int().positive().optional().nullable(),
});
export type UserCreateDataAdmin = z.infer<typeof userCreateSchemaAdmin>;


export const userUpdateSchemaSysAd = z.object({
  first_name: z.string().min(1, "First name is required").max(100),
  last_name: z.string().min(1, "Last name is required").max(100),
  password: z.string().min(6, "Password must be at least 6 characters").max(100).optional().nullable().or(z.literal('')),
  email: z.string().email("Invalid email address").max(255).optional().nullable(),
  role: z.enum(["admin", "staff", "sysad"]).default("staff"),
  tenant_id: z.number().int().positive().optional().nullable(),
  tenant_branch_id: z.number().int().positive().optional().nullable(),
  status: z.enum(['0', '1']).default('1'),
});
export type UserUpdateDataSysAd = z.infer<typeof userUpdateSchemaSysAd>;

// Schema for Admin updating users (tenant_id implicit and non-editable, role limited)
export const userUpdateSchemaAdmin = z.object({
  first_name: z.string().min(1, "First name is required").max(100),
  last_name: z.string().min(1, "Last name is required").max(100),
  password: z.string().min(6, "Password must be at least 6 characters").max(100).optional().nullable().or(z.literal('')),
  email: z.string().email("Invalid email address").max(255).optional().nullable(),
  role: z.enum(["admin", "staff"]).default("staff"), // Admin can only assign admin or staff
  tenant_branch_id: z.number().int().positive().optional().nullable(),
  status: z.enum(['0', '1']).default('1'),
});
export type UserUpdateDataAdmin = z.infer<typeof userUpdateSchemaAdmin>;


export const branchCreateSchema = z.object({
  tenant_id: z.number().int().positive({ message: "Tenant ID is required and must be a positive integer" }),
  branch_name: z.string().min(1, "Branch name is required").max(255),
  branch_code: z.string().min(1, "Branch code is required").max(50),
  branch_address: z.string().max(1000, "Address too long").optional().nullable(),
  contact_number: z.string().max(100, "Contact number too long").optional().nullable(),
  email_address: z.string().email("Invalid email address").max(255).optional().nullable(),
});
export type BranchCreateData = z.infer<typeof branchCreateSchema>;

// For SysAd updating any branch
export const branchUpdateSchemaSysAd = z.object({
  tenant_id: z.number().int().positive({ message: "Tenant ID is required" }), 
  branch_name: z.string().min(1, "Branch name is required").max(255),
  branch_address: z.string().max(1000, "Address too long").optional().nullable(),
  contact_number: z.string().max(100, "Contact number too long").optional().nullable(),
  email_address: z.string().email("Invalid email address").max(255).optional().nullable(),
  status: z.enum(['0', '1']).default('1'),
});
export type BranchUpdateDataSysAd = z.infer<typeof branchUpdateSchemaSysAd>;

    
