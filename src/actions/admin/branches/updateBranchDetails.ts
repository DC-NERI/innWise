
"use server";

import pg from 'pg';
// Configure pg to return numeric types as numbers instead of strings
pg.types.setTypeParser(20, (val) => parseInt(val, 10)); // int8
pg.types.setTypeParser(21, (val) => parseInt(val, 10)); // int2
pg.types.setTypeParser(23, (val) => parseInt(val, 10)); // int4
pg.types.setTypeParser(1700, (val) => parseFloat(val)); // numeric

// Configure pg to return timestamp without timezone as strings
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE

import { Pool } from 'pg';
import type { Branch } from '@/lib/types';
import { branchUpdateSchema } from '@/lib/schemas';
import type { z } from 'zod';
import { HOTEL_ENTITY_STATUS } from '../../../lib/constants';


const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/branches/updateBranchDetails action', err);
});

type BranchUpdateFormData = z.infer<typeof branchUpdateSchema>;

export async function updateBranchDetails(branchId: number, data: BranchUpdateFormData): Promise<{ success: boolean; message?: string; updatedBranch?: Branch }> {
  const validatedFields = branchUpdateSchema.safeParse(data);
  if (!validatedFields.success) {
    const errorMessage = "Invalid data: " + JSON.stringify(validatedFields.error.flatten().fieldErrors);
    return { success: false, message: errorMessage };
  }

  const { branch_name, branch_code, branch_address, contact_number, email_address } = validatedFields.data;

  const client = await pool.connect();
  try {
    // First, check if the new branch_code already exists for another branch in the same tenant (if branch_code is being updated)
    // The original admin branch edit form *did* allow branch_code editing.

    const checkExistingBranchCodeSQL = `
      SELECT id FROM tenant_branch WHERE branch_code = $1 AND id != $2 AND tenant_id = (SELECT tenant_id FROM tenant_branch WHERE id = $2);
    `;
    const existingBranchCodeRes = await client.query(checkExistingBranchCodeSQL, [branch_code, branchId]);
    if (existingBranchCodeRes.rows.length > 0) {
      return { success: false, message: "This branch code is already in use by another branch for this tenant." };
    }

    const updateBranchSQL = `
      UPDATE tenant_branch
      SET branch_name = $1, branch_code = $2, branch_address = $3, contact_number = $4, email_address = $5, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
      WHERE id = $6
      RETURNING id, tenant_id, branch_name, branch_code, branch_address, contact_number, email_address, status, created_at, updated_at;
    `;
    const res = await client.query(updateBranchSQL, [branch_name, branch_code, branch_address, contact_number, email_address, branchId]);

    if (res.rows.length > 0) {
      const updatedBranch = res.rows[0];
      return {
        success: true,
        message: "Branch details updated successfully.",
        updatedBranch: {
            ...updatedBranch,
            status: String(updatedBranch.status) // Ensure status is string
        } as Branch,
      };
    }
    return { success: false, message: "Branch not found or update failed." };
  } catch (error) {
    console.error('[updateBranchDetails DB Error]', error);
    let errorMessage = "Database error occurred during branch update.";
     if (error instanceof Error && (error as any).code === '23505' && (error as any).constraint === 'tenant_branch_branch_code_key') { // Using the actual constraint name for branch_code uniqueness
        errorMessage = "This branch code is already in use. Please choose a different one.";
    } else if (error instanceof Error) {
        errorMessage = `Database error: ${error.message}`;
    }
    return { success: false, message: errorMessage };
  } finally {
    client.release();
  }
}
    
