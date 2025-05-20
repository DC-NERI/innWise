
import { z } from "zod";
import { ROOM_AVAILABILITY_STATUS, TRANSACTION_STATUS } from '@/lib/constants';

export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

// For Admin role updating branches of their tenant
export const branchUpdateSchema = z.object({
  branch_name: z.string().min(1, "Branch name is required").max(255, "Branch name too long"),
  branch_code: z.string().min(1, "Branch code is required").max(50, "Branch code too long"),
  branch_address: z.string().max(1000, "Address too long").optional().nullable(),
  contact_number: z.string().max(100, "Contact number too long").optional().nullable(),
  email_address: z.string().email("Invalid email address").max(255, "Email too long").optional().nullable(),
});

export const tenantCreateSchema = z.object({
  tenant_name: z.string().min(1, "Tenant name is required").max(255, "Tenant name too long"),
  tenant_address: z.string().max(1000, "Address too long").optional().nullable(),
  tenant_email: z.string().email("Invalid email address").max(255, "Email too long").optional().nullable(),
  tenant_contact_info: z.string().max(100, "Contact number too long").optional().nullable(),
  max_branch_count: z.coerce.number().int().min(0, "Max branches must be non-negative").optional().nullable(),
  max_user_count: z.coerce.number().int().min(0, "Max users must be non-negative").optional().nullable(),
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
  tenant_id: z.coerce.number().int().positive().optional().nullable(),
  tenant_branch_id: z.coerce.number().int().positive().optional().nullable(),
}).superRefine((data, ctx) => {
  if (data.role === 'admin' || data.role === 'staff') {
    if (data.tenant_id === null || data.tenant_id === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Tenant is required for admin and staff members.",
        path: ["tenant_id"],
      });
    }
  }
  if (data.role === 'staff') {
    if (data.tenant_branch_id === null || data.tenant_branch_id === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Branch is required for staff members.",
        path: ["tenant_branch_id"],
      });
    }
  }
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
  tenant_branch_id: z.coerce.number().int().positive().optional().nullable(),
}).superRefine((data, ctx) => {
  if (data.role === 'staff' && (data.tenant_branch_id === null || data.tenant_branch_id === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Branch is required for staff members.",
      path: ["tenant_branch_id"],
    });
  }
});
export type UserCreateDataAdmin = z.infer<typeof userCreateSchemaAdmin>;


export const userUpdateSchemaSysAd = z.object({
  first_name: z.string().min(1, "First name is required").max(100),
  last_name: z.string().min(1, "Last name is required").max(100),
  password: z.string().min(6, "Password must be at least 6 characters").max(100).optional().nullable().or(z.literal('')),
  email: z.string().email("Invalid email address").max(255).optional().nullable(),
  role: z.enum(["admin", "staff", "sysad"]).default("staff"),
  tenant_id: z.coerce.number().int().positive().optional().nullable(),
  tenant_branch_id: z.coerce.number().int().positive().optional().nullable(),
  status: z.enum(['0', '1']).default('1'),
}).superRefine((data, ctx) => {
  if (data.role === 'admin' || data.role === 'staff') {
    if (data.tenant_id === null || data.tenant_id === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Tenant is required for admin and staff members.",
        path: ["tenant_id"],
      });
    }
  }
  if (data.role === 'staff') {
    if (data.tenant_branch_id === null || data.tenant_branch_id === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Branch is required for staff members.",
        path: ["tenant_branch_id"],
      });
    }
  }
});
export type UserUpdateDataSysAd = z.infer<typeof userUpdateSchemaSysAd>;

// Schema for Admin updating users (tenant_id implicit and non-editable, role limited)
export const userUpdateSchemaAdmin = z.object({
  first_name: z.string().min(1, "First name is required").max(100),
  last_name: z.string().min(1, "Last name is required").max(100),
  password: z.string().min(6, "Password must be at least 6 characters").max(100).optional().nullable().or(z.literal('')),
  email: z.string().email("Invalid email address").max(255).optional().nullable(),
  role: z.enum(["admin", "staff"]).default("staff"), // Admin can only assign admin or staff
  tenant_branch_id: z.coerce.number().int().positive().optional().nullable(),
  status: z.enum(['0', '1']).default('1'),
}).superRefine((data, ctx) => {
  if (data.role === 'staff' && (data.tenant_branch_id === null || data.tenant_branch_id === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Branch is required for staff members.",
      path: ["tenant_branch_id"],
    });
  }
});
export type UserUpdateDataAdmin = z.infer<typeof userUpdateSchemaAdmin>;


export const branchCreateSchema = z.object({
  tenant_id: z.coerce.number().int().positive({ message: "Tenant ID is required and must be a positive integer" }),
  branch_name: z.string().min(1, "Branch name is required").max(255),
  branch_code: z.string().min(1, "Branch code is required").max(50),
  branch_address: z.string().max(1000, "Address too long").optional().nullable(),
  contact_number: z.string().max(100, "Contact number too long").optional().nullable(),
  email_address: z.string().email("Invalid email address").max(255).optional().nullable(),
});
export type BranchCreateData = z.infer<typeof branchCreateSchema>;

// For SysAd updating any branch
export const branchUpdateSchemaSysAd = z.object({
  tenant_id: z.coerce.number().int().positive({ message: "Tenant ID is required" }),
  branch_name: z.string().min(1, "Branch name is required").max(255),
  branch_address: z.string().max(1000, "Address too long").optional().nullable(),
  contact_number: z.string().max(100, "Contact number too long").optional().nullable(),
  email_address: z.string().email("Invalid email address").max(255).optional().nullable(),
  status: z.enum(['0', '1']).default('1'),
});
export type BranchUpdateDataSysAd = z.infer<typeof branchUpdateSchemaSysAd>;


// Hotel Rate Schemas
export const hotelRateCreateSchema = z.object({
  name: z.string().min(1, "Rate name is required").max(100),
  price: z.coerce.number().positive("Price must be a positive number"),
  hours: z.coerce.number().int().positive("Hours must be a positive integer"),
  excess_hour_price: z.coerce.number().positive("Excess hour price must be a positive number").optional().nullable(),
  description: z.string().max(500, "Description too long").optional().nullable(),
});
export type HotelRateCreateData = z.infer<typeof hotelRateCreateSchema>;

export const hotelRateUpdateSchema = hotelRateCreateSchema.extend({
  status: z.enum(['0', '1']).default('1'),
});
export type HotelRateUpdateData = z.infer<typeof hotelRateUpdateSchema>;

// Hotel Room Schemas
export const hotelRoomCreateSchema = z.object({
  hotel_rate_ids: z.array(z.coerce.number().int().positive())
                     .min(1, "At least one rate must be selected.")
                     .default([]),
  room_name: z.string().min(1, "Room name is required").max(100),
  room_code: z.string().min(1, "Room code is required").max(50),
  floor: z.coerce.number().int().optional().nullable(),
  room_type: z.string().max(50).optional().nullable(),
  bed_type: z.string().max(50).optional().nullable(),
  capacity: z.coerce.number().int().min(1, "Capacity must be at least 1").optional().nullable().default(2),
  is_available: z.coerce.number().int().min(0).max(2).default(ROOM_AVAILABILITY_STATUS.AVAILABLE),
});
export type HotelRoomCreateData = z.infer<typeof hotelRoomCreateSchema>;

export const hotelRoomUpdateSchema = hotelRoomCreateSchema.extend({
  // room_code is part of hotelRoomCreateSchema now, so it will be included in update
  is_available: z.coerce.number().int().min(0).max(2).default(ROOM_AVAILABILITY_STATUS.AVAILABLE),
  status: z.enum(['0', '1']).default('1'),
});
export type HotelRoomUpdateData = z.infer<typeof hotelRoomUpdateSchema>;

// Transaction Schemas
export const transactionCreateSchema = z.object({
  client_name: z.string().min(1, "Client name is required").max(255),
  client_payment_method: z.string().min(1, "Payment method is required").max(50),
  notes: z.string().max(1000, "Notes too long").optional().nullable(),
  selected_rate_id: z.coerce.number().int().positive("A valid rate must be selected."),
});
export type TransactionCreateData = z.infer<typeof transactionCreateSchema>;

export const transactionUpdateNotesSchema = z.object({
  notes: z.string().max(1000, "Notes too long").optional().nullable(),
});
export type TransactionUpdateNotesData = z.infer<typeof transactionUpdateNotesSchema>;

export const transactionReservedUpdateSchema = z.object({
  client_name: z.string().min(1, "Client name is required").max(255),
  client_payment_method: z.string().min(1, "Payment method is required").max(50),
  notes: z.string().max(1000, "Notes too long").optional().nullable(),
});
export type TransactionReservedUpdateData = z.infer<typeof transactionReservedUpdateSchema>;

// Schema for assigning room to unassigned reservation
export const assignRoomAndCheckInSchema = z.object({
  selected_room_id: z.coerce.number().int().positive("A valid room must be selected."),
  // selected_rate_id might not be needed here if we use the rate from the original unassigned reservation
});
export type AssignRoomAndCheckInData = z.infer<typeof assignRoomAndCheckInSchema>;
