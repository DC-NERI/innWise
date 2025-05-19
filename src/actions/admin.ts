
"use server";

import { Pool } from 'pg';
import type { Tenant, Branch } from '@/lib/types';
import { branchUpdateSchema } from '@/lib/schemas';
import type { z } from 'zod';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin actions', err);
});

// Placeholder for tenant details fetching
export async function getTenantDetails(tenantId: number): Promise<Tenant | null> {
  // In a real app, fetch from the database:
  // const client = await pool.connect();
  // try {
  //   const res = await client.query('SELECT id, tenant_name, tenant_address, tenant_email, tenant_contact_info, created_at, updated_at, status FROM tenants WHERE id = $1', [tenantId]);
  //   if (res.rows.length > 0) {
  //     return res.rows[0] as Tenant;
  //   }
  //   return null;
  // } catch (error) {
  //   console.error(`Failed to fetch tenant ${tenantId}:`, error);
  //   throw error; // Or handle more gracefully
  // } finally {
  //   client.release();
  // }
  console.log(`Fetching tenant details for ID: ${tenantId} (currently placeholder)`);
  if (tenantId === 1) { // Example placeholder data
    return {
      id: 1,
      tenant_name: "InnWise Demo Hotel",
      tenant_address: "123 Demo Street, Suite 456, Innovation City, ID 78901",
      tenant_email: "contact@innwisedemo.com",
      tenant_contact_info: "+1 (555) 123-4567",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: '1',
    };
  }
  return null;
}

export async function getBranchesForTenant(tenantId: number): Promise<Branch[]> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      'SELECT id, tenant_id, branch_name, branch_code, branch_address, contact_number, email_address, created_at, updated_at FROM tenant_branch WHERE tenant_id = $1 ORDER BY branch_name ASC',
      [tenantId]
    );
    return res.rows.map(row => ({
        ...row,
        created_at: new Date(row.created_at).toISOString(),
        updated_at: new Date(row.updated_at).toISOString(),
    })) as Branch[];
  } catch (error) {
    console.error(`Failed to fetch branches for tenant ${tenantId}:`, error);
    // In a real app, you might want to throw a more specific error or return an error object
    throw new Error(`Database error: Could not fetch branches. ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}

type BranchUpdateData = z.infer<typeof branchUpdateSchema>;

export async function updateBranchDetails(
  branchId: number,
  data: BranchUpdateData
): Promise<{ success: boolean; message?: string; updatedBranch?: Branch }> {
  const validatedFields = branchUpdateSchema.safeParse(data);

  if (!validatedFields.success) {
    return {
      success: false,
      message: `Invalid data: ${validatedFields.error.flatten().fieldErrors}`,
    };
  }

  const { branch_name, branch_address, contact_number, email_address } = validatedFields.data;
  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE tenant_branch 
       SET branch_name = $1, branch_address = $2, contact_number = $3, email_address = $4, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $5
       RETURNING id, tenant_id, branch_name, branch_code, branch_address, contact_number, email_address, created_at, updated_at`,
      [branch_name, branch_address, contact_number, email_address, branchId]
    );

    if (res.rows.length > 0) {
      const updatedRow = res.rows[0];
      return {
        success: true,
        message: "Branch updated successfully.",
        updatedBranch: {
            ...updatedRow,
            created_at: new Date(updatedRow.created_at).toISOString(),
            updated_at: new Date(updatedRow.updated_at).toISOString(),
        } as Branch,
      };
    } else {
      return { success: false, message: "Branch not found or no changes made." };
    }
  } catch (error) {
    console.error(`Failed to update branch ${branchId}:`, error);
     let errorMessage = "Database error occurred during branch update.";
    if (error instanceof Error && (error as any).code === '23505' && (error as any).constraint === 'tenant_branch_email_address_key') {
        errorMessage = "This email address is already in use by another branch.";
    } else if (error instanceof Error) {
        errorMessage = `Database error: ${error.message}`;
    }
    return { success: false, message: errorMessage };
  } finally {
    client.release();
  }
}
