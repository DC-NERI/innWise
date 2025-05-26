
import { z } from "zod";
import {
    ROOM_AVAILABILITY_STATUS,
    TRANSACTION_LIFECYCLE_STATUS,
    TRANSACTION_PAYMENT_STATUS,
    HOTEL_ENTITY_STATUS,
    ROOM_CLEANING_STATUS,
    ROOM_CLEANING_STATUS_OPTIONS,
    LOST_AND_FOUND_STATUS,
    LOST_AND_FOUND_STATUS_OPTIONS,
    TRANSACTION_IS_ACCEPTED_STATUS
} from '@/lib/constants';

export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
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
  status: z.enum([
    HOTEL_ENTITY_STATUS.ARCHIVED,
    HOTEL_ENTITY_STATUS.ACTIVE,
    HOTEL_ENTITY_STATUS.SUSPENDED
  ]).default(HOTEL_ENTITY_STATUS.ACTIVE),
});
export type TenantUpdateData = z.infer<typeof tenantUpdateSchema>;

// Base fields for user schemas
const baseUserSchemaFields = {
  first_name: z.string().min(1, "First name is required").max(100),
  last_name: z.string().min(1, "Last name is required").max(100),
  username: z.string().min(1, "Username is required").max(100),
  email: z.string().email("Invalid email address").max(255).optional().nullable(),
  role: z.enum(["admin", "staff", "sysad", "housekeeping"]),
  tenant_id: z.coerce.number().int().positive().optional().nullable(),
  tenant_branch_id: z.coerce.number().int().positive().optional().nullable(),
};

export const userCreateSchema = z.object({
  ...baseUserSchemaFields,
  password: z.string().min(6, "Password must be at least 6 characters").max(100),
}).superRefine((data, ctx) => {
  if (data.role === 'admin' || data.role === 'staff' || data.role === 'housekeeping') {
    if (!data.tenant_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Tenant is required for admin, staff, and housekeeping roles.", path: ["tenant_id"] });
    }
  }
  if (data.role === 'staff' || data.role === 'housekeeping') {
    if (!data.tenant_branch_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Branch is required for staff and housekeeping roles.", path: ["tenant_branch_id"] });
    }
  }
});
export type UserCreateData = z.infer<typeof userCreateSchema>;

export const userCreateSchemaAdmin = z.object({
  ...baseUserSchemaFields,
  role: z.enum(["admin", "staff", "housekeeping"]).default("staff"),
  password: z.string().min(6, "Password must be at least 6 characters").max(100),
}).superRefine((data, ctx) => {
  if ((data.role === 'staff' || data.role === 'housekeeping') && (data.tenant_branch_id === null || data.tenant_branch_id === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Branch is required for staff and housekeeping roles.", path: ["tenant_branch_id"] });
  }
});
export type UserCreateDataAdmin = z.infer<typeof userCreateSchemaAdmin>;

const baseUserUpdateSchemaFields = {
  first_name: z.string().min(1, "First name is required").max(100),
  last_name: z.string().min(1, "Last name is required").max(100),
  password: z.string().min(6, "Password must be at least 6 characters").max(100).optional().nullable().or(z.literal('')),
  email: z.string().email("Invalid email address").max(255).optional().nullable(),
  role: z.enum(["admin", "staff", "sysad", "housekeeping"]),
  tenant_id: z.coerce.number().int().positive().optional().nullable(),
  tenant_branch_id: z.coerce.number().int().positive().optional().nullable(),
  status: z.enum([HOTEL_ENTITY_STATUS.ARCHIVED, HOTEL_ENTITY_STATUS.ACTIVE]).default(HOTEL_ENTITY_STATUS.ACTIVE),
};

export const userUpdateSchemaSysAd = z.object(baseUserUpdateSchemaFields).superRefine((data, ctx) => {
  if (data.role === 'admin' || data.role === 'staff' || data.role === 'housekeeping') {
    if (!data.tenant_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Tenant is required for admin, staff, and housekeeping roles.", path: ["tenant_id"] });
    }
  }
  if (data.role === 'staff' || data.role === 'housekeeping') {
    if (!data.tenant_branch_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Branch is required for staff and housekeeping roles.", path: ["tenant_branch_id"] });
    }
  }
});
export type UserUpdateDataSysAd = z.infer<typeof userUpdateSchemaSysAd>;

export const userUpdateSchemaAdmin = z.object({
  ...baseUserUpdateSchemaFields,
  role: z.enum(["admin", "staff", "housekeeping"]),
}).superRefine((data, ctx) => {
  if ((data.role === 'staff' || data.role === 'housekeeping') && (data.tenant_branch_id === null || data.tenant_branch_id === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Branch is required for staff and housekeeping roles.", path: ["tenant_branch_id"] });
  }
});
export type UserUpdateDataAdmin = z.infer<typeof userUpdateSchemaAdmin>;

export const adminResetPasswordSchema = z.object({
  new_password: z.string().min(6, "New password must be at least 6 characters.").max(100),
  confirm_password: z.string().min(6).max(100),
}).refine((data) => data.new_password === data.confirm_password, {
  message: "Passwords don't match",
  path: ["confirm_password"],
});
export type AdminResetPasswordData = z.infer<typeof adminResetPasswordSchema>;


export const branchCreateSchema = z.object({
  tenant_id: z.coerce.number().int().positive({ message: "Tenant ID is required and must be a positive integer" }),
  branch_name: z.string().min(1, "Branch name is required").max(255),
  branch_code: z.string().min(1, "Branch code is required").max(50),
  branch_address: z.string().max(1000, "Address too long").optional().nullable(),
  contact_number: z.string().max(100, "Contact number too long").optional().nullable(),
  email_address: z.string().email("Invalid email address").max(255).optional().nullable(),
});
export type BranchCreateData = z.infer<typeof branchCreateSchema>;

export const branchUpdateSchema = z.object({
  branch_name: z.string().min(1, "Branch name is required").max(255, "Branch name too long"),
  branch_code: z.string().min(1, "Branch code is required").max(50, "Branch code too long"),
  branch_address: z.string().max(1000, "Address too long").optional().nullable(),
  contact_number: z.string().max(100, "Contact number too long").optional().nullable(),
  email_address: z.string().email("Invalid email address").max(255).optional().nullable(),
});

export const branchUpdateSchemaSysAd = z.object({
  tenant_id: z.coerce.number().int().positive({ message: "Tenant ID is required" }),
  branch_name: z.string().min(1, "Branch name is required").max(255),
  branch_address: z.string().max(1000, "Address too long").optional().nullable(),
  contact_number: z.string().max(100, "Contact number too long").optional().nullable(),
  email_address: z.string().email("Invalid email address").max(255).optional().nullable(),
  status: z.enum([HOTEL_ENTITY_STATUS.ARCHIVED, HOTEL_ENTITY_STATUS.ACTIVE]).default(HOTEL_ENTITY_STATUS.ACTIVE),
});
export type BranchUpdateDataSysAd = z.infer<typeof branchUpdateSchemaSysAd>;

export const hotelRateCreateSchema = z.object({
  name: z.string().min(1, "Rate name is required").max(100),
  price: z.coerce.number().positive("Price must be a positive number"),
  hours: z.coerce.number().int().positive("Hours must be a positive integer"),
  excess_hour_price: z.coerce.number().positive("Excess hour price must be a positive number").optional().nullable(),
  description: z.string().max(500, "Description too long").optional().nullable(),
});
export type HotelRateCreateData = z.infer<typeof hotelRateCreateSchema>;

export const hotelRateUpdateSchema = hotelRateCreateSchema.extend({
  status: z.enum([HOTEL_ENTITY_STATUS.ARCHIVED, HOTEL_ENTITY_STATUS.ACTIVE]).default(HOTEL_ENTITY_STATUS.ACTIVE),
});
export type HotelRateUpdateData = z.infer<typeof hotelRateUpdateSchema>;

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
  is_available: z.nativeEnum(ROOM_AVAILABILITY_STATUS).default(ROOM_AVAILABILITY_STATUS.AVAILABLE),
  cleaning_status: z.nativeEnum(ROOM_CLEANING_STATUS).default(ROOM_CLEANING_STATUS.CLEAN),
  cleaning_notes: z.string().max(1000, "Cleaning notes too long").optional().nullable(),
});
export type HotelRoomCreateData = z.infer<typeof hotelRoomCreateSchema>;

export const hotelRoomUpdateSchema = hotelRoomCreateSchema.extend({
  status: z.enum([HOTEL_ENTITY_STATUS.ARCHIVED, HOTEL_ENTITY_STATUS.ACTIVE]).default(HOTEL_ENTITY_STATUS.ACTIVE),
});
export type HotelRoomUpdateData = z.infer<typeof hotelRoomUpdateSchema>;


const baseTransactionFields = {
  client_name: z.string().min(1, "Client name is required").max(255),
  selected_rate_id: z.coerce.number().int().positive().optional().nullable(),
  client_payment_method: z.string().max(50).optional().nullable(),
  notes: z.string().max(1000, "Notes too long").optional().nullable(),
  is_advance_reservation: z.boolean().optional().default(false),
  reserved_check_in_datetime: z.string()
    .optional()
    .nullable()
    .transform(val => (val === "" || val === undefined ? null : val))
    .refine(val => val === null || !isNaN(new Date(val).getTime()), { message: "Invalid check-in datetime string." }),
  reserved_check_out_datetime: z.string()
    .optional()
    .nullable()
    .transform(val => (val === "" || val === undefined ? null : val))
    .refine(val => val === null || !isNaN(new Date(val).getTime()), { message: "Invalid check-out datetime string." }),
  selected_room_id_placeholder_for_walkin: z.coerce.number().int().positive().optional().nullable(),
  is_paid: z.nativeEnum(TRANSACTION_PAYMENT_STATUS).default(TRANSACTION_PAYMENT_STATUS.UNPAID).optional().nullable(),
  tender_amount_at_checkin: z.coerce.number().min(0,"Tender amount cannot be negative.").optional().nullable(),
};

export const transactionObjectSchema = z.object(baseTransactionFields);
type BaseTransactionData = z.infer<typeof transactionObjectSchema>;

export const transactionSuperRefineLogic = (data: BaseTransactionData, ctx: z.RefinementCtx) => {
  if (data.is_advance_reservation) {
    if (!data.reserved_check_in_datetime) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Reserved check-in date and time are required for advance reservations.", path: ["reserved_check_in_datetime"] });
    }
    if (!data.reserved_check_out_datetime) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Reserved check-out date and time are required for advance reservations.", path: ["reserved_check_out_datetime"] });
    }
    if (data.reserved_check_in_datetime && data.reserved_check_out_datetime) {
      if (new Date(data.reserved_check_out_datetime) <= new Date(data.reserved_check_in_datetime)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Reserved check-out date/time must be after check-in date/time.", path: ["reserved_check_out_datetime"] });
      }
    }
  }
  if ((data.is_paid === TRANSACTION_PAYMENT_STATUS.PAID || data.is_paid === TRANSACTION_PAYMENT_STATUS.ADVANCE_PAID)) {
    if (data.tender_amount_at_checkin === null || data.tender_amount_at_checkin === undefined || data.tender_amount_at_checkin < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Tender amount is required if transaction is marked as paid.", path: ["tender_amount_at_checkin"] });
    }
    if (!data.selected_rate_id && data.is_paid !== TRANSACTION_PAYMENT_STATUS.UNPAID) {
       ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A rate must be selected if transaction is marked as paid.", path: ["selected_rate_id"] });
    }
  }
};

export const transactionCreateSchema = transactionObjectSchema.superRefine(transactionSuperRefineLogic);
export type TransactionCreateData = z.infer<typeof transactionCreateSchema>;

// For Staff direct booking from Room Status
export const staffBookingCreateSchema = transactionObjectSchema.extend({
  selected_rate_id: z.coerce.number().int().positive("A rate must be selected for booking."),
  client_payment_method: z.string().min(1, "Payment method is required.").max(50),
}).superRefine(transactionSuperRefineLogic);
export type StaffBookingCreateData = z.infer<typeof staffBookingCreateSchema>;

export const transactionUpdateNotesSchema = z.object({
  notes: z.string().max(1000, "Notes too long").optional().nullable(),
});
export type TransactionUpdateNotesData = z.infer<typeof transactionUpdateNotesSchema>;

// For Staff editing an unassigned reservation (e.g., from notifications or reservations list)
export const transactionUnassignedUpdateSchema = transactionObjectSchema.extend({
  client_name: z.string().max(255).optional().nullable(), // Client name is likely pre-filled and might not need re-validation for min(1)
  selected_rate_id: z.coerce.number().int().positive("A rate must be selected when managing this reservation."),
}).superRefine(transactionSuperRefineLogic);
export type TransactionUnassignedUpdateData = z.infer<typeof transactionUnassignedUpdateSchema>;

// For Staff editing a RESERVATION_WITH_ROOM (status 2) - full edit
export const transactionReservedUpdateSchema = transactionObjectSchema.extend({
  client_name: z.string().min(1, "Client name is required.").max(255),
  selected_rate_id: z.coerce.number().int().positive("A rate must be selected for the reservation."),
}).superRefine(transactionSuperRefineLogic);
export type TransactionReservedUpdateData = z.infer<typeof transactionReservedUpdateSchema>;


export const assignRoomAndCheckInSchema = z.object({
  selected_room_id: z.coerce.number().int().positive("A valid room must be selected."),
});
export type AssignRoomAndCheckInData = z.infer<typeof assignRoomAndCheckInSchema>;

export const notificationCreateSchema = z.object({
  message: z.string().min(1, "Message is required.").max(2000, "Message is too long."),
  target_branch_id: z.coerce.number().int().positive().optional().nullable(),
  do_reservation: z.boolean().optional().default(false),
  reservation_client_name: z.string().max(255).optional().nullable(),
  reservation_selected_rate_id: z.coerce.number().int().positive().optional().nullable(),
  reservation_client_payment_method: z.string().max(50).optional().nullable(),
  reservation_notes: z.string().max(1000).optional().nullable(),
  reservation_is_advance: z.boolean().optional().default(false),
  reservation_is_paid: z.nativeEnum(TRANSACTION_PAYMENT_STATUS).default(TRANSACTION_PAYMENT_STATUS.UNPAID).optional(),
  reservation_tender_amount_at_checkin: z.coerce.number().min(0, "Tender amount cannot be negative.").optional().nullable(),
  reservation_check_in_datetime: z.string().optional().nullable().transform(val => (val === "" || val === undefined ? null : val)).refine(val => val === null || !isNaN(new Date(val).getTime()), { message: "Invalid reservation check-in datetime." }),
  reservation_check_out_datetime: z.string().optional().nullable().transform(val => (val === "" || val === undefined ? null : val)).refine(val => val === null || !isNaN(new Date(val).getTime()), { message: "Invalid reservation check-out datetime." }),
}).superRefine((data, ctx) => {
  if (data.do_reservation) {
    if (!data.target_branch_id) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Target branch is required to create a linked reservation.", path: ["target_branch_id"] });
    }
    if (!data.reservation_client_name) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Client name for reservation is required.", path: ["reservation_client_name"] });
    }
    // Rate ID is now optional for Admin creating a reservation via notification
    // if (!data.reservation_selected_rate_id) {
    //   ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Rate for reservation is required.", path: ["reservation_selected_rate_id"] });
    // }
    if (data.reservation_is_advance) {
      if (!data.reservation_check_in_datetime) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Check-in date/time for advance reservation is required.", path: ["reservation_check_in_datetime"] });
      }
      if (!data.reservation_check_out_datetime) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Check-out date/time for advance reservation is required.", path: ["reservation_check_out_datetime"] });
      }
      if (data.reservation_check_in_datetime && data.reservation_check_out_datetime && new Date(data.reservation_check_out_datetime) <= new Date(data.reservation_check_in_datetime)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Reservation check-out must be after check-in.", path: ["reservation_check_out_datetime"] });
      }
    }
     if ((data.reservation_is_paid === TRANSACTION_PAYMENT_STATUS.PAID || data.reservation_is_paid === TRANSACTION_PAYMENT_STATUS.ADVANCE_PAID)) {
      if (data.reservation_tender_amount_at_checkin === null || data.reservation_tender_amount_at_checkin === undefined || data.reservation_tender_amount_at_checkin < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Tender amount is required if reservation is marked as paid.",
          path: ["reservation_tender_amount_at_checkin"],
        });
      }
      // If paid, a rate should ideally be selected, but making it optional for admin here
      // if (!data.reservation_selected_rate_id) {
      //    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A rate must be selected if reservation is marked as paid.", path: ["reservation_selected_rate_id"] });
      // }
    }
  }
});
export type NotificationCreateData = z.infer<typeof notificationCreateSchema>;

export const roomCleaningStatusAndNotesUpdateSchema = z.object({
  cleaning_status: z.nativeEnum(ROOM_CLEANING_STATUS).refine(val => val !== undefined, {message: "Cleaning status is required"}),
  cleaning_notes: z.string().max(1000, "Notes cannot exceed 1000 characters.").optional().nullable(),
}).superRefine((data, ctx) => {
  if (data.cleaning_status === ROOM_CLEANING_STATUS.OUT_OF_ORDER) {
    if (!data.cleaning_notes || data.cleaning_notes.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Notes are required when setting room to 'Out of Order'.",
        path: ["cleaning_notes"],
      });
    }
  }
});
export type RoomCleaningStatusUpdateData = z.infer<typeof roomCleaningStatusAndNotesUpdateSchema>;

export const checkoutFormSchema = z.object({
  tender_amount: z.coerce.number().min(0, "Tender amount cannot be negative."),
  payment_method: z.string().min(1, "Payment method is required at checkout.").max(50),
});
export type CheckoutFormData = z.infer<typeof checkoutFormSchema>;

export const lostAndFoundCreateSchema = z.object({
  item_name: z.string().min(1, "Item name is required.").max(255, "Item name too long."),
  description: z.string().max(1000, "Description too long.").optional().nullable(),
  found_location: z.string().max(255, "Location too long.").optional().nullable(),
  // target_branch_id is added dynamically in the component for admin
});
export type LostAndFoundCreateData = z.infer<typeof lostAndFoundCreateSchema>;

export const lostAndFoundUpdateStatusSchema = z.object({
  status: z.nativeEnum(LOST_AND_FOUND_STATUS),
  claimed_by_details: z.string().max(500, "Claimed by details too long.").optional().nullable(),
  disposed_details: z.string().max(500, "Disposal details too long.").optional().nullable(),
}).superRefine((data, ctx) => {
  if (data.status === LOST_AND_FOUND_STATUS.CLAIMED && (!data.claimed_by_details || data.claimed_by_details.trim() === "")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Details of who claimed the item are required.",
      path: ["claimed_by_details"],
    });
  }
  if (data.status === LOST_AND_FOUND_STATUS.DISPOSED && (!data.disposed_details || data.disposed_details.trim() === "")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Notes for disposal are required.",
      path: ["disposed_details"],
    });
  }
});
export type LostAndFoundUpdateStatusData = z.infer<typeof lostAndFoundUpdateStatusSchema>;

    