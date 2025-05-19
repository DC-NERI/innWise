
"use server";

import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import type { Tenant, Branch, User } from '@/lib/types';
import { branchUpdateSchema, tenantCreateSchema, TenantCreateData, userCreateSchema, UserCreateData, branchCreateSchema, BranchCreateData } from '@/lib/schemas';
import type { z } from 'zod';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/sysad actions', err);
});

// Tenant Actions
export async function listTenants(): Promise<Tenant[]> {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT id, tenant_name, tenant_address, tenant_email, tenant_contact_info, created_at, updated_at, status FROM tenants ORDER BY tenant_name ASC');
    return res.rows.map(row => ({
        ...row,
        created_at: new Date(row.created_at).toISOString(),
        updated_at: new Date(row.updated_at).toISOString(),
    })) as Tenant[];
  } catch (error) {
    console.error('Failed to fetch tenants:', error);
    throw new Error(`Database error: Could not fetch tenants. ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}

export async function createTenant(data: TenantCreateData): Promise<{ success: boolean; message?: string; tenant?: Tenant }> {
  const validatedFields = tenantCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    return { success: false, message: `Invalid data: ${validatedFields.error.flatten().fieldErrors}` };
  }
  const { tenant_name, tenant_address, tenant_email, tenant_contact_info } = validatedFields.data;
  const client = await pool.connect();
  try {
    const res = await client.query(
      `INSERT INTO tenants (tenant_name, tenant_address, tenant_email, tenant_contact_info) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id, tenant_name, tenant_address, tenant_email, tenant_contact_info, created_at, updated_at, status`,
      [tenant_name, tenant_address, tenant_email, tenant_contact_info]
    );
    if (res.rows.length > 0) {
       const newRow = res.rows[0];
      return { 
        success: true, 
        message: "Tenant created successfully.", 
        tenant: {
            ...newRow,
            created_at: new Date(newRow.created_at).toISOString(),
            updated_at: new Date(newRow.updated_at).toISOString(),
        } as Tenant 
      };
    }
    return { success: false, message: "Tenant creation failed." };
  } catch (error) {
    console.error('Failed to create tenant:', error);
    let errorMessage = "Database error occurred during tenant creation.";
     if (error instanceof Error && (error as any).code === '23505' && (error as any).constraint === 'tenants_tenant_email_key') {
        errorMessage = "This email address is already in use by another tenant.";
    } else if (error instanceof Error) {
        errorMessage = `Database error: ${error.message}`;
    }
    return { success: false, message: errorMessage };
  } finally {
    client.release();
  }
}


export async function getTenantDetails(tenantId: number): Promise<Tenant | null> {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT id, tenant_name, tenant_address, tenant_email, tenant_contact_info, created_at, updated_at, status FROM tenants WHERE id = $1', [tenantId]);
    if (res.rows.length > 0) {
      const row = res.rows[0];
      return {
        ...row,
        created_at: new Date(row.created_at).toISOString(),
        updated_at: new Date(row.updated_at).toISOString(),
      } as Tenant;
    }
    return null;
  } catch (error) {
    console.error(`Failed to fetch tenant ${tenantId}:`, error);
    throw new Error(`Database error: Could not fetch tenant details. ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}

// Branch Actions
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

export async function createBranchForTenant(data: BranchCreateData): Promise<{ success: boolean; message?: string; branch?: Branch }> {
  const validatedFields = branchCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    return { success: false, message: `Invalid data: ${JSON.stringify(validatedFields.error.flatten().fieldErrors)}` };
  }
  const { tenant_id, branch_name, branch_code, branch_address, contact_number, email_address } = validatedFields.data;
  const client = await pool.connect();
  try {
    const res = await client.query(
      `INSERT INTO tenant_branch (tenant_id, branch_name, branch_code, branch_address, contact_number, email_address) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING id, tenant_id, branch_name, branch_code, branch_address, contact_number, email_address, created_at, updated_at`,
      [tenant_id, branch_name, branch_code, branch_address, contact_number, email_address]
    );
    if (res.rows.length > 0) {
      const newRow = res.rows[0];
      return { 
        success: true, 
        message: "Branch created successfully.", 
        branch: {
            ...newRow,
            created_at: new Date(newRow.created_at).toISOString(),
            updated_at: new Date(newRow.updated_at).toISOString(),
        } as Branch
      };
    }
    return { success: false, message: "Branch creation failed." };
  } catch (error) {
    console.error('Failed to create branch:', error);
    let errorMessage = "Database error occurred during branch creation.";
    if (error instanceof Error && (error as any).code === '23505') { // Unique constraint violation
        if ((error as any).constraint === 'tenant_branch_branch_code_key') {
            errorMessage = "This branch code is already in use.";
        } else if ((error as any).constraint === 'tenant_branch_email_address_key') {
            errorMessage = "This email address is already in use by another branch.";
        }
    } else if (error instanceof Error) {
        errorMessage = `Database error: ${error.message}`;
    }
    return { success: false, message: errorMessage };
  } finally {
    client.release();
  }
}

export async function listAllBranches(): Promise<Branch[]> {
  const client = await pool.connect();
  try {
    // This query joins with tenants to potentially get tenant_name if needed in the list view
    const res = await client.query(`
      SELECT tb.id, tb.tenant_id, t.tenant_name, tb.branch_name, tb.branch_code, 
             tb.branch_address, tb.contact_number, tb.email_address, 
             tb.created_at, tb.updated_at 
      FROM tenant_branch tb
      JOIN tenants t ON tb.tenant_id = t.id
      ORDER BY t.tenant_name ASC, tb.branch_name ASC
    `);
    return res.rows.map(row => ({
        ...row,
        tenant_name: row.tenant_name, // Include tenant_name from the join
        created_at: new Date(row.created_at).toISOString(),
        updated_at: new Date(row.updated_at).toISOString(),
    })) as Branch[]; // Adjust Branch type if you add tenant_name directly to it
  } catch (error) {
    console.error('Failed to fetch all branches:', error);
    throw new Error(`Database error: Could not fetch all branches. ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}


// User Actions (for SysAd)
export async function listAllUsers(): Promise<User[]> {
  // Placeholder: Implement actual database query
  console.log("listAllUsers action called - placeholder");
  // In a real implementation, query the 'users' table, potentially joining with 'tenants' if tenant_name is needed.
  // Example: SELECT u.id, u.tenant_id, t.tenant_name, u.first_name, u.last_name, u.username, u.email, u.role, u.status, u.created_at, u.updated_at, u.last_log_in FROM users u LEFT JOIN tenants t ON u.tenant_id = t.id ORDER BY u.last_name ASC, u.first_name ASC;
  return [];
}

export async function createUserSysAd(data: UserCreateData): Promise<{ success: boolean; message?: string; user?: User }> {
  // Placeholder: Implement actual user creation logic
  console.log("createUserSysAd action called with data:", data, "- placeholder");
  const validatedFields = userCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    return { success: false, message: `Invalid data: ${JSON.stringify(validatedFields.error.flatten().fieldErrors)}` };
  }
  
  const { first_name, last_name, username, password, email, role, tenant_id } = validatedFields.data;
  
  const salt = bcrypt.genSaltSync(10);
  const password_hash = bcrypt.hashSync(password, salt);

  const client = await pool.connect();
  try {
    const res = await client.query(
      `INSERT INTO users (first_name, last_name, username, password_hash, email, role, tenant_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING id, tenant_id, first_name, last_name, username, email, role, status, created_at, updated_at, last_log_in`,
      [first_name, last_name, username, password_hash, email, role, tenant_id]
    );
    if (res.rows.length > 0) {
      const newUser = res.rows[0];
      return { 
        success: true, 
        message: "User created successfully.", 
        user: {
          id: newUser.id, // map to string if your User type expects id as string
          tenant_id: newUser.tenant_id,
          first_name: newUser.first_name,
          last_name: newUser.last_name,
          username: newUser.username,
          email: newUser.email,
          role: newUser.role as User['role'],
          status: newUser.status,
          created_at: new Date(newUser.created_at).toISOString(),
          updated_at: new Date(newUser.updated_at).toISOString(),
          last_log_in: newUser.last_log_in ? new Date(newUser.last_log_in).toISOString() : undefined,
        }
      };
    }
    return { success: false, message: "User creation failed." };
  } catch (error) {
    console.error('Failed to create user:', error);
    let errorMessage = "Database error occurred during user creation.";
    if (error instanceof Error && (error as any).code === '23505') { // Unique constraint violation
        if ((error as any).constraint === 'users_username_key') {
            errorMessage = "This username is already taken.";
        } else if ((error as any).constraint === 'users_email_key') { // Assuming you have a unique constraint on user email
            errorMessage = "This email address is already in use by another user.";
        }
    } else if (error instanceof Error) {
        errorMessage = `Database error: ${error.message}`;
    }
    return { success: false, message: errorMessage };
  } finally {
    client.release();
  }
}
