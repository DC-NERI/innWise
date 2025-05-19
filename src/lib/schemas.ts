
import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export const branchUpdateSchema = z.object({
  branch_name: z.string().min(1, "Branch name is required").max(255, "Branch name too long"),
  branch_address: z.string().max(1000, "Address too long").optional().nullable(),
  contact_number: z.string().max(100, "Contact number too long").optional().nullable(),
  email_address: z.string().email("Invalid email address").max(255, "Email too long").optional().nullable(),
});
