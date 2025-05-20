
"use server";

import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import type { Tenant, Branch, User, SimpleBranch, HotelRate, HotelRoom, SimpleRate } from '@/lib/types';
import {
  branchUpdateSchema,
  tenantCreateSchema, TenantCreateData, tenantUpdateSchema, TenantUpdateData,
  userCreateSchema, UserCreateData, userUpdateSchemaSysAd, UserUpdateDataSysAd,
  branchCreateSchema, BranchCreateData, branchUpdateSchemaSysAd, BranchUpdateDataSysAd,
  userCreateSchemaAdmin, UserCreateDataAdmin, userUpdateSchemaAdmin, UserUpdateDataAdmin,
  hotelRateCreateSchema, HotelRateCreateData, hotelRateUpdateSchema, HotelRateUpdateData,
  hotelRoomCreateSchema, HotelRoomCreateData, hotelRoomUpdateSchema, HotelRoomUpdateData
} from '@/lib/schemas';
import type { z } from 'zod';
import { ROOM_AVAILABILITY_STATUS, TRANSACTION_STATUS } from '@/lib/constants';


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
    const res = await client.query('SELECT id, tenant_name, tenant_address, tenant_email, tenant_contact_info, max_branch_count, max_user_count, created_at, updated_at, status FROM tenants ORDER BY tenant_name ASC');
    return res.rows.map(row => ({
        ...row,
        max_branch_count: row.max_branch_count,
        max_user_count: row.max_user_count,
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
    return { success: false, message: `Invalid data: ${JSON.stringify(validatedFields.error.flatten().fieldErrors)}` };
  }
  const { tenant_name, tenant_address, tenant_email, tenant_contact_info, max_branch_count, max_user_count } = validatedFields.data;
  const client = await pool.connect();
  try {
    // created_at and updated_at will use DB defaults (Asia/Manila)
    const res = await client.query(
      `INSERT INTO tenants (tenant_name, tenant_address, tenant_email, tenant_contact_info, max_branch_count, max_user_count)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, tenant_name, tenant_address, tenant_email, tenant_contact_info, max_branch_count, max_user_count, created_at, updated_at, status`,
      [tenant_name, tenant_address, tenant_email, tenant_contact_info, max_branch_count, max_user_count]
    );
    if (res.rows.length > 0) {
       const newRow = res.rows[0];
      return {
        success: true,
        message: "Tenant created successfully.",
        tenant: {
            ...newRow,
            max_branch_count: newRow.max_branch_count,
            max_user_count: newRow.max_user_count,
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

export async function updateTenant(tenantId: number, data: TenantUpdateData): Promise<{ success: boolean; message?: string; tenant?: Tenant }> {
  const validatedFields = tenantUpdateSchema.safeParse(data);
  if (!validatedFields.success) {
    return { success: false, message: `Invalid data: ${JSON.stringify(validatedFields.error.flatten().fieldErrors)}` };
  }
  const { tenant_name, tenant_address, tenant_email, tenant_contact_info, max_branch_count, max_user_count, status } = data;
  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE tenants
       SET tenant_name = $1, tenant_address = $2, tenant_email = $3, tenant_contact_info = $4, max_branch_count = $5, max_user_count = $6, status = $7, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $8
       RETURNING id, tenant_name, tenant_address, tenant_email, tenant_contact_info, max_branch_count, max_user_count, created_at, updated_at, status`,
      [tenant_name, tenant_address, tenant_email, tenant_contact_info, max_branch_count, max_user_count, status, tenantId]
    );
    if (res.rows.length > 0) {
      const updatedRow = res.rows[0];
      return { success: true, message: "Tenant updated successfully.", tenant: { ...updatedRow, max_branch_count: updatedRow.max_branch_count, max_user_count: updatedRow.max_user_count, created_at: new Date(updatedRow.created_at).toISOString(), updated_at: new Date(updatedRow.updated_at).toISOString() } as Tenant };
    }
    return { success: false, message: "Tenant not found or no changes made." };
  } catch (error) {
    console.error(`Failed to update tenant ${tenantId}:`, error);
    let errorMessage = "Database error occurred during tenant update.";
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

export async function archiveTenant(tenantId: number): Promise<{ success: boolean; message?: string }> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE tenants SET status = '0', updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') WHERE id = $1 RETURNING id`,
      [tenantId]
    );
    if (res.rowCount > 0) {
      return { success: true, message: "Tenant archived successfully." };
    }
    return { success: false, message: "Tenant not found or already archived." };
  } catch (error) {
    console.error(`Failed to archive tenant ${tenantId}:`, error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}

export async function getTenantDetails(tenantId: number): Promise<Tenant | null> {
  if (isNaN(tenantId) || tenantId <= 0) {
    console.warn(`Invalid tenantId received in getTenantDetails: ${tenantId}`);
    return null;
  }
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT id, tenant_name, tenant_address, tenant_email, tenant_contact_info, max_branch_count, max_user_count, created_at, updated_at, status FROM tenants WHERE id = $1', [tenantId]);
    if (res.rows.length > 0) {
      const row = res.rows[0];
      return {
        ...row,
        max_branch_count: row.max_branch_count,
        max_user_count: row.max_user_count,
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
  if (isNaN(tenantId) || tenantId <= 0) {
    console.warn(`Invalid tenantId received in getBranchesForTenant: ${tenantId}`);
    return [];
  }
  const client = await pool.connect();
  try {
    const res = await client.query(
      'SELECT id, tenant_id, branch_name, branch_code, branch_address, contact_number, email_address, created_at, updated_at, status FROM tenant_branch WHERE tenant_id = $1 ORDER BY branch_name ASC',
      [tenantId]
    );
    return res.rows.map(row => ({
        ...row,
        status: row.status,
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

export async function getBranchesForTenantSimple(tenantId: number): Promise<SimpleBranch[]> {
  if (isNaN(tenantId) || tenantId <= 0) {
    console.warn(`Invalid tenantId received in getBranchesForTenantSimple: ${tenantId}`);
    return [];
  }
  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT id, branch_name FROM tenant_branch WHERE tenant_id = $1 AND status = '1' ORDER BY branch_name ASC",
      [tenantId]
    );
    return result.rows as SimpleBranch[];
  } catch (error: any) {
     console.error(`Failed to fetch simple branches for tenant ${tenantId}:`, error.message);
    throw new Error(`Database error: Could not fetch simple active branches. ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}


// Used by Admin Role
export async function updateBranchDetails(
  branchId: number,
  data: z.infer<typeof branchUpdateSchema>
): Promise<{ success: boolean; message?: string; updatedBranch?: Branch }> {
  const validatedFields = branchUpdateSchema.safeParse(data);

  if (!validatedFields.success) {
    return {
      success: false,
      message: `Invalid data: ${JSON.stringify(validatedFields.error.flatten().fieldErrors)}`,
    };
  }

  const { branch_name, branch_code, branch_address, contact_number, email_address } = validatedFields.data;
  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE tenant_branch
       SET branch_name = $1, branch_code = $2, branch_address = $3, contact_number = $4, email_address = $5, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $6
       RETURNING id, tenant_id, branch_name, branch_code, branch_address, contact_number, email_address, created_at, updated_at, status`,
      [branch_name, branch_code, branch_address, contact_number, email_address, branchId]
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
    if (error instanceof Error && (error as any).code === '23505') {
        if ((error as any).constraint === 'tenant_branch_branch_code_key') {
            errorMessage = "This branch code is already in use by another branch.";
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


export async function updateBranchSysAd(branchId: number, data: BranchUpdateDataSysAd): Promise<{ success: boolean; message?: string; branch?: Branch }> {
  const validatedFields = branchUpdateSchemaSysAd.safeParse(data);
  if (!validatedFields.success) {
    return { success: false, message: `Invalid data: ${JSON.stringify(validatedFields.error.flatten().fieldErrors)}` };
  }

  const { tenant_id, branch_name, branch_address, contact_number, email_address, status } = validatedFields.data;
  const client = await pool.connect();
  try {
    if (status === '1') {
        const currentBranchRes = await client.query('SELECT status, tenant_id FROM tenant_branch WHERE id = $1', [branchId]);
        if (currentBranchRes.rows.length > 0 && currentBranchRes.rows[0].status === '0') {
            const branchTenantId = currentBranchRes.rows[0].tenant_id;
            const tenantDetails = await client.query('SELECT max_branch_count FROM tenants WHERE id = $1', [branchTenantId]);
            if (tenantDetails.rows.length > 0) {
                const max_branch_count = tenantDetails.rows[0].max_branch_count;
                if (max_branch_count !== null && max_branch_count > 0) { 
                    const currentBranchCountRes = await client.query(
                        "SELECT COUNT(*) as count FROM tenant_branch WHERE tenant_id = $1 AND status = '1'",
                        [branchTenantId]
                    );
                    const currentBranchCount = parseInt(currentBranchCountRes.rows[0].count, 10);
                    if (currentBranchCount >= max_branch_count) {
                        return { success: false, message: `Tenant has reached the maximum active branch limit of ${max_branch_count}. To restore this branch, please archive an existing active branch first or increase the tenant's limit.` };
                    }
                }
            }
        }
    }

    const res = await client.query(
      `UPDATE tenant_branch
       SET tenant_id = $1, branch_name = $2, branch_address = $3, contact_number = $4, email_address = $5, status = $6, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $7
       RETURNING id, tenant_id, branch_name, branch_code, branch_address, contact_number, email_address, created_at, updated_at, status`,
      [tenant_id, branch_name, branch_address, contact_number, email_address, status, branchId]
    );
    if (res.rows.length > 0) {
      const updatedRow = res.rows[0];
      const tenantRes = await client.query('SELECT tenant_name FROM tenants WHERE id = $1', [updatedRow.tenant_id]);
      const tenant_name = tenantRes.rows.length > 0 ? tenantRes.rows[0].tenant_name : null;

      return {
        success: true,
        message: "Branch updated successfully.",
        branch: {
            ...updatedRow,
            tenant_name,
            status: updatedRow.status,
            created_at: new Date(updatedRow.created_at).toISOString(),
            updated_at: new Date(updatedRow.updated_at).toISOString(),
        } as Branch
      };
    }
    return { success: false, message: "Branch not found or no changes made." };
  } catch (error) {
    console.error(`Failed to update branch ${branchId} by SysAd:`, error);
    let errorMessage = "Database error occurred during branch update.";
     if (error instanceof Error && (error as any).code === '23505') {
        if ((error as any).constraint === 'tenant_branch_branch_code_key') {
            errorMessage = "This branch code is already in use by another branch.";
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

export async function archiveBranch(branchId: number): Promise<{ success: boolean; message?: string }> {
  const client = await pool.connect();
  try {
    const columnCheck = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='tenant_branch' AND column_name='status'"
    );
    if (columnCheck.rowCount === 0) {
        console.error("CRITICAL: 'status' column does not exist in 'tenant_branch' table. Archiving functionality is disabled.");
        return { success: false, message: "Branch archiving is currently unavailable due to a system configuration issue. Please contact support. (Missing 'status' column in 'tenant_branch')" };
    }

    const res = await client.query(
      `UPDATE tenant_branch SET status = '0', updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') WHERE id = $1 RETURNING id`,
      [branchId]
    );
    if (res.rowCount > 0) {
      return { success: true, message: "Branch archived successfully." };
    }
    return { success: false, message: "Branch not found or already archived." };
  } catch (error) {
    console.error(`Failed to archive branch ${branchId}:`, error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}. Ensure 'tenant_branch' table has a 'status' column.` };
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
    const tenantDetails = await client.query('SELECT max_branch_count FROM tenants WHERE id = $1', [tenant_id]);
    if (tenantDetails.rows.length === 0) {
      return { success: false, message: "Tenant not found." };
    }
    const max_branch_count = tenantDetails.rows[0].max_branch_count;

    if (max_branch_count !== null && max_branch_count > 0) {
      const currentBranchCountRes = await client.query(
        "SELECT COUNT(*) as count FROM tenant_branch WHERE tenant_id = $1 AND status = '1'",
        [tenant_id]
      );
      const currentBranchCount = parseInt(currentBranchCountRes.rows[0].count, 10);
      if (currentBranchCount >= max_branch_count) {
        return { success: false, message: `Tenant has reached the maximum active branch limit of ${max_branch_count}. To add a new active branch, please archive an existing one first or increase the tenant's limit.` };
      }
    }
    // created_at and updated_at will use DB defaults (Asia/Manila)
    const res = await client.query(
      `INSERT INTO tenant_branch (tenant_id, branch_name, branch_code, branch_address, contact_number, email_address, status)
       VALUES ($1, $2, $3, $4, $5, $6, '1')
       RETURNING id, tenant_id, branch_name, branch_code, branch_address, contact_number, email_address, created_at, updated_at, status`,
      [tenant_id, branch_name, branch_code, branch_address, contact_number, email_address]
    );
    if (res.rows.length > 0) {
      const newRow = res.rows[0];
      const tenantRes = await client.query('SELECT tenant_name FROM tenants WHERE id = $1', [newRow.tenant_id]);
      const tenant_name = tenantRes.rows.length > 0 ? tenantRes.rows[0].tenant_name : null;
      return {
        success: true,
        message: "Branch created successfully.",
        branch: {
            ...newRow,
            tenant_name,
            status: newRow.status,
            created_at: new Date(newRow.created_at).toISOString(),
            updated_at: new Date(newRow.updated_at).toISOString(),
        } as Branch
      };
    }
    return { success: false, message: "Branch creation failed." };
  } catch (error) {
    console.error('Failed to create branch:', error);
    let errorMessage = "Database error occurred during branch creation.";
    if (error instanceof Error && (error as any).code === '23505') {
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
    const res = await client.query(`
      SELECT tb.id, tb.tenant_id, t.tenant_name, tb.branch_name, tb.branch_code,
             tb.branch_address, tb.contact_number, tb.email_address,
             tb.created_at, tb.updated_at, tb.status
      FROM tenant_branch tb
      JOIN tenants t ON tb.tenant_id = t.id
      ORDER BY t.tenant_name ASC, tb.branch_name ASC
    `);
    return res.rows.map(row => ({
        ...row,
        tenant_name: row.tenant_name,
        status: row.status,
        created_at: new Date(row.created_at).toISOString(),
        updated_at: new Date(row.updated_at).toISOString(),
    })) as Branch[];
  } catch (error) {
    console.error('Failed to fetch all branches:', error);
    throw new Error(`Database error: Could not fetch all branches. ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}


// User Actions (for SysAd)
export async function listAllUsers(): Promise<User[]> {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT u.id, u.tenant_id, t.tenant_name, u.tenant_branch_id, tb.branch_name,
             u.first_name, u.last_name, u.username,
             u.email, u.role, u.status, u.created_at, u.updated_at, u.last_log_in
      FROM users u
      LEFT JOIN tenants t ON u.tenant_id = t.id
      LEFT JOIN tenant_branch tb ON u.tenant_branch_id = tb.id
      ORDER BY u.last_name ASC, u.first_name ASC
    `);
    return res.rows.map(row => ({
      id: row.id,
      tenant_id: row.tenant_id,
      tenant_name: row.tenant_name,
      tenant_branch_id: row.tenant_branch_id,
      branch_name: row.branch_name,
      first_name: row.first_name,
      last_name: row.last_name,
      username: row.username,
      email: row.email,
      role: row.role as User['role'],
      status: row.status,
      created_at: new Date(row.created_at).toISOString(),
      updated_at: new Date(row.updated_at).toISOString(),
      last_log_in: row.last_log_in ? new Date(row.last_log_in).toISOString() : null,
    })) as User[];
  } catch (error) {
    console.error('Failed to fetch all users:', error);
    throw new Error(`Database error: Could not fetch all users. ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}

export async function createUserSysAd(data: UserCreateData): Promise<{ success: boolean; message?: string; user?: User }> {
  const validatedFields = userCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    return { success: false, message: `Invalid data: ${JSON.stringify(validatedFields.error.flatten().fieldErrors)}` };
  }

  const { first_name, last_name, username, password, email, role, tenant_id, tenant_branch_id } = validatedFields.data;

  const client = await pool.connect();
  try {
    if (tenant_id && (role === 'admin' || role === 'staff')) {
        const tenantDetails = await client.query('SELECT max_user_count FROM tenants WHERE id = $1', [tenant_id]);
        if (tenantDetails.rows.length === 0) {
            return { success: false, message: "Assigned tenant not found." };
        }
        const max_user_count = tenantDetails.rows[0].max_user_count;

        if (max_user_count !== null && max_user_count > 0) { 
            const currentUserCountRes = await client.query(
                "SELECT COUNT(*) as count FROM users WHERE tenant_id = $1 AND status = '1'",
                [tenant_id]
            );
            const currentUserCount = parseInt(currentUserCountRes.rows[0].count, 10);
            if (currentUserCount >= max_user_count) {
                return { success: false, message: `Tenant has reached the maximum active user limit of ${max_user_count}. To add a new active user, please archive an existing one first or increase the tenant's limit.` };
            }
        }
    }

    const salt = bcrypt.genSaltSync(10);
    const password_hash = bcrypt.hashSync(password, salt);
    // created_at and updated_at will use DB defaults (Asia/Manila)
    const res = await client.query(
      `INSERT INTO users (first_name, last_name, username, password_hash, email, role, tenant_id, tenant_branch_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '1')
       RETURNING id, tenant_id, tenant_branch_id, first_name, last_name, username, email, role, status, created_at, updated_at, last_log_in`,
      [first_name, last_name, username, password_hash, email, role, tenant_id, tenant_branch_id]
    );
    if (res.rows.length > 0) {
      const newUser = res.rows[0];
      const tenantRes = newUser.tenant_id ? await client.query('SELECT tenant_name FROM tenants WHERE id = $1', [newUser.tenant_id]) : { rows: [] };
      const tenant_name = tenantRes.rows.length > 0 ? tenantRes.rows[0].tenant_name : null;
      const branchRes = newUser.tenant_branch_id ? await client.query('SELECT branch_name FROM tenant_branch WHERE id = $1', [newUser.tenant_branch_id]) : { rows: [] };
      const branch_name = branchRes.rows.length > 0 ? branchRes.rows[0].branch_name : null;

      return {
        success: true,
        message: "User created successfully.",
        user: {
          id: newUser.id,
          tenant_id: newUser.tenant_id,
          tenant_name,
          tenant_branch_id: newUser.tenant_branch_id,
          branch_name,
          first_name: newUser.first_name,
          last_name: newUser.last_name,
          username: newUser.username,
          email: newUser.email,
          role: newUser.role as User['role'],
          status: newUser.status,
          created_at: new Date(newUser.created_at).toISOString(),
          updated_at: new Date(newUser.updated_at).toISOString(),
          last_log_in: newUser.last_log_in ? new Date(newUser.last_log_in).toISOString() : null,
        }
      };
    }
    return { success: false, message: "User creation failed." };
  } catch (error) {
    console.error('Failed to create user:', error);
    let errorMessage = "Database error occurred during user creation.";
    if (error instanceof Error && (error as any).code === '23505') {
        if ((error as any).constraint === 'users_username_key') {
            errorMessage = "This username is already taken.";
        } else if ((error as any).constraint === 'users_email_key') {
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

export async function updateUserSysAd(userId: number, data: UserUpdateDataSysAd): Promise<{ success: boolean; message?: string; user?: User }> {
  const validatedFields = userUpdateSchemaSysAd.safeParse(data);
  if (!validatedFields.success) {
    return { success: false, message: `Invalid data: ${JSON.stringify(validatedFields.error.flatten().fieldErrors)}` };
  }

  const { first_name, last_name, password, email, role, tenant_id, tenant_branch_id, status } = validatedFields.data;

  const client = await pool.connect();
  try {
    if (status === '1' && tenant_id && (role === 'admin' || role === 'staff')) {
        const currentUserRes = await client.query('SELECT status, tenant_id as current_tenant_id FROM users WHERE id = $1', [userId]);
        if (currentUserRes.rows.length > 0 && currentUserRes.rows[0].status === '0') {
            const userCurrentTenantId = currentUserRes.rows[0].current_tenant_id;
            const targetTenantId = tenant_id;

            const tenantDetails = await client.query('SELECT max_user_count FROM tenants WHERE id = $1', [targetTenantId]);
            if (tenantDetails.rows.length > 0) {
                const max_user_count = tenantDetails.rows[0].max_user_count;
                if (max_user_count !== null && max_user_count > 0) { 
                    const currentUserCountRes = await client.query(
                        "SELECT COUNT(*) as count FROM users WHERE tenant_id = $1 AND status = '1'",
                        [targetTenantId]
                    );
                    const currentUserCount = parseInt(currentUserCountRes.rows[0].count, 10);
                    if (currentUserCount >= max_user_count) {
                        if (userCurrentTenantId !== targetTenantId) {
                             return { success: false, message: `Target tenant (ID: ${targetTenantId}) has reached the maximum active user limit of ${max_user_count}.` };
                        }
                        else {
                             return { success: false, message: `Tenant has reached the maximum active user limit of ${max_user_count}. To restore this user, please archive an existing active user first or increase the tenant's limit.` };
                        }
                    }
                }
            }
        }
    }

    let password_hash_update_string = '';
    const queryParams: any[] = [first_name, last_name, email, role, tenant_id, tenant_branch_id, status];

    if (password && password.trim() !== '') {
      const salt = bcrypt.genSaltSync(10);
      const new_password_hash = bcrypt.hashSync(password, salt);
      password_hash_update_string = `, password_hash = $${queryParams.length + 1}`;
      queryParams.push(new_password_hash);
    }
    queryParams.push(userId);

    const res = await client.query(
      `UPDATE users
       SET first_name = $1, last_name = $2, email = $3, role = $4, tenant_id = $5, tenant_branch_id = $6, status = $7, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') ${password_hash_update_string}
       WHERE id = $${queryParams.length}
       RETURNING id, tenant_id, tenant_branch_id, first_name, last_name, username, email, role, status, created_at, updated_at, last_log_in`,
      queryParams
    );

    if (res.rows.length > 0) {
      const updatedUser = res.rows[0];
      const tenantRes = updatedUser.tenant_id ? await client.query('SELECT tenant_name FROM tenants WHERE id = $1', [updatedUser.tenant_id]) : { rows: [] };
      const tenant_name = tenantRes.rows.length > 0 ? tenantRes.rows[0].tenant_name : null;
      const branchRes = updatedUser.tenant_branch_id ? await client.query('SELECT branch_name FROM tenant_branch WHERE id = $1', [updatedUser.tenant_branch_id]) : { rows: [] };
      const branch_name = branchRes.rows.length > 0 ? branchRes.rows[0].branch_name : null;

      return {
        success: true,
        message: "User updated successfully.",
        user: {
          id: updatedUser.id,
          tenant_id: updatedUser.tenant_id,
          tenant_name,
          tenant_branch_id: updatedUser.tenant_branch_id,
          branch_name,
          first_name: updatedUser.first_name,
          last_name: updatedUser.last_name,
          username: updatedUser.username,
          email: updatedUser.email,
          role: updatedUser.role as User['role'],
          status: updatedUser.status,
          created_at: new Date(updatedUser.created_at).toISOString(),
          updated_at: new Date(updatedUser.updated_at).toISOString(),
          last_log_in: updatedUser.last_log_in ? new Date(updatedUser.last_log_in).toISOString() : null,
        }
      };
    }
    return { success: false, message: "User not found or no changes made." };
  } catch (error) {
    console.error(`Failed to update user ${userId}:`, error);
    let errorMessage = "Database error occurred during user update.";
    if (error instanceof Error && (error as any).code === '23505' && (error as any).constraint === 'users_email_key') {
        errorMessage = "This email address is already in use by another user.";
    } else if (error instanceof Error) {
        errorMessage = `Database error: ${error.message}`;
    }
    return { success: false, message: errorMessage };
  } finally {
    client.release();
  }
}

export async function archiveUser(userId: number): Promise<{ success: boolean; message?: string }> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE users SET status = '0', updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') WHERE id = $1 RETURNING id`,
      [userId]
    );
    if (res.rowCount > 0) {
      return { success: true, message: "User archived successfully." };
    }
    return { success: false, message: "User not found or already archived." };
  } catch (error) {
    console.error(`Failed to archive user ${userId}:`, error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}

// User Actions (for Admin role, scoped to their tenant)
export async function getUsersForTenant(tenantId: number): Promise<User[]> {
  if (isNaN(tenantId) || tenantId <= 0) {
    console.warn(`Invalid tenantId received in getUsersForTenant: ${tenantId}`);
    return [];
  }
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT u.id, u.tenant_id, t.tenant_name, u.tenant_branch_id, tb.branch_name,
              u.first_name, u.last_name, u.username,
              u.email, u.role, u.status, u.created_at, u.updated_at, u.last_log_in
       FROM users u
       JOIN tenants t ON u.tenant_id = t.id
       LEFT JOIN tenant_branch tb ON u.tenant_branch_id = tb.id AND u.tenant_id = tb.tenant_id
       WHERE u.tenant_id = $1 AND u.role != 'sysad'
       ORDER BY CASE u.role WHEN 'admin' THEN 1 WHEN 'staff' THEN 2 ELSE 3 END, u.last_name ASC, u.first_name ASC`,
      [tenantId]
    );
    return res.rows.map(row => ({
      id: row.id,
      tenant_id: row.tenant_id,
      tenant_name: row.tenant_name,
      tenant_branch_id: row.tenant_branch_id,
      branch_name: row.branch_name,
      first_name: row.first_name,
      last_name: row.last_name,
      username: row.username,
      email: row.email,
      role: row.role as User['role'],
      status: row.status,
      created_at: new Date(row.created_at).toISOString(),
      updated_at: new Date(row.updated_at).toISOString(),
      last_log_in: row.last_log_in ? new Date(row.last_log_in).toISOString() : null,
    })) as User[];
  } catch (error) {
    console.error(`Failed to fetch users for tenant ${tenantId}:`, error);
    throw new Error(`Database error: Could not fetch users. ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}

export async function createUserAdmin(data: UserCreateDataAdmin, callingTenantId: number): Promise<{ success: boolean; message?: string; user?: User }> {
  const validatedFields = userCreateSchemaAdmin.safeParse(data);
  if (!validatedFields.success) {
    return { success: false, message: `Invalid data: ${JSON.stringify(validatedFields.error.flatten().fieldErrors)}` };
  }

  const { first_name, last_name, username, password, email, role, tenant_branch_id } = validatedFields.data;

  if (role === 'sysad') {
    return { success: false, message: "Admins cannot create System Administrator accounts." };
  }
  if (isNaN(callingTenantId) || callingTenantId <= 0) {
      return { success: false, message: "Invalid calling tenant ID." };
  }

  const client = await pool.connect();
  try {
    const tenantDetails = await client.query('SELECT max_user_count FROM tenants WHERE id = $1', [callingTenantId]);
    if (tenantDetails.rows.length === 0) {
        return { success: false, message: "Calling tenant not found." };
    }
    const max_user_count = tenantDetails.rows[0].max_user_count;

    if (max_user_count !== null && max_user_count > 0) { 
        const currentUserCountRes = await client.query(
            "SELECT COUNT(*) as count FROM users WHERE tenant_id = $1 AND status = '1'",
            [callingTenantId]
        );
        const currentUserCount = parseInt(currentUserCountRes.rows[0].count, 10);
        if (currentUserCount >= max_user_count) {
            return { success: false, message: `Tenant has reached the maximum active user limit of ${max_user_count}. To add a new active user, please archive an existing one first or increase the tenant's limit.` };
        }
    }


    const salt = bcrypt.genSaltSync(10);
    const password_hash = bcrypt.hashSync(password, salt);
    // created_at and updated_at will use DB defaults (Asia/Manila)
    const res = await client.query(
      `INSERT INTO users (first_name, last_name, username, password_hash, email, role, tenant_id, tenant_branch_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '1')
       RETURNING id, tenant_id, tenant_branch_id, first_name, last_name, username, email, role, status, created_at, updated_at, last_log_in`,
      [first_name, last_name, username, password_hash, email, role, callingTenantId, tenant_branch_id]
    );
    if (res.rows.length > 0) {
      const newUser = res.rows[0];
      const tenantRes = await client.query('SELECT tenant_name FROM tenants WHERE id = $1', [newUser.tenant_id]);
      const tenant_name = tenantRes.rows.length > 0 ? tenantRes.rows[0].tenant_name : null;
      const branchRes = newUser.tenant_branch_id ? await client.query('SELECT branch_name FROM tenant_branch WHERE id = $1', [newUser.tenant_branch_id]) : { rows: [] };
      const branch_name = branchRes.rows.length > 0 ? branchRes.rows[0].branch_name : null;

      return {
        success: true,
        message: "User created successfully.",
        user: {
          id: newUser.id,
          tenant_id: newUser.tenant_id,
          tenant_name,
          tenant_branch_id: newUser.tenant_branch_id,
          branch_name,
          first_name: newUser.first_name,
          last_name: newUser.last_name,
          username: newUser.username,
          email: newUser.email,
          role: newUser.role as User['role'],
          status: newUser.status,
          created_at: new Date(newUser.created_at).toISOString(),
          updated_at: new Date(newUser.updated_at).toISOString(),
          last_log_in: newUser.last_log_in ? new Date(newUser.last_log_in).toISOString() : null,
        }
      };
    }
    return { success: false, message: "User creation failed." };
  } catch (error) {
    console.error('Failed to create user by admin:', error);
    let errorMessage = "Database error occurred during user creation.";
    if (error instanceof Error && (error as any).code === '23505') {
        if ((error as any).constraint === 'users_username_key') errorMessage = "This username is already taken.";
        else if ((error as any).constraint === 'users_email_key') errorMessage = "This email address is already in use.";
    } else if (error instanceof Error) {
        errorMessage = `Database error: ${error.message}`;
    }
    return { success: false, message: errorMessage };
  } finally {
    client.release();
  }
}

export async function updateUserAdmin(userId: number, data: UserUpdateDataAdmin, callingTenantId: number): Promise<{ success: boolean; message?: string; user?: User }> {
  const validatedFields = userUpdateSchemaAdmin.safeParse(data);
  if (!validatedFields.success) {
    return { success: false, message: `Invalid data: ${JSON.stringify(validatedFields.error.flatten().fieldErrors)}` };
  }

  const { first_name, last_name, password, email, role, tenant_branch_id, status } = validatedFields.data;

  if (role === 'sysad') {
    return { success: false, message: "Admins cannot assign System Administrator role." };
  }
   if (isNaN(callingTenantId) || callingTenantId <= 0) {
      return { success: false, message: "Invalid calling tenant ID." };
  }

  const client = await pool.connect();
  try {
    const userCheck = await client.query('SELECT tenant_id, status as current_status FROM users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0 || userCheck.rows[0].tenant_id !== callingTenantId) {
      return { success: false, message: "User not found in this tenant or permission denied." };
    }
    const currentUserStatus = userCheck.rows[0].current_status;

    if (status === '1' && currentUserStatus === '0') { 
        const tenantDetails = await client.query('SELECT max_user_count FROM tenants WHERE id = $1', [callingTenantId]);
        if (tenantDetails.rows.length > 0) {
            const max_user_count = tenantDetails.rows[0].max_user_count;
            if (max_user_count !== null && max_user_count > 0) { 
                const currentUserCountRes = await client.query(
                    "SELECT COUNT(*) as count FROM users WHERE tenant_id = $1 AND status = '1'",
                    [callingTenantId]
                );
                const currentUserCount = parseInt(currentUserCountRes.rows[0].count, 10);
                if (currentUserCount >= max_user_count) {
                    return { success: false, message: `Tenant has reached the maximum active user limit of ${max_user_count}. To restore this user, please archive an existing active user first or increase the tenant's limit.` };
                }
            }
        }
    }


    let password_hash_update_string = '';
    const queryParams: any[] = [first_name, last_name, email, role, tenant_branch_id, status];

    if (password && password.trim() !== '') {
      const salt = bcrypt.genSaltSync(10);
      const new_password_hash = bcrypt.hashSync(password, salt);
      password_hash_update_string = `, password_hash = $${queryParams.length + 1}`;
      queryParams.push(new_password_hash);
    }
    queryParams.push(userId);

    const res = await client.query(
      `UPDATE users
       SET first_name = $1, last_name = $2, email = $3, role = $4, tenant_branch_id = $5, status = $6, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') ${password_hash_update_string}
       WHERE id = $${queryParams.length} AND tenant_id = $${queryParams.length + 1}
       RETURNING id, tenant_id, tenant_branch_id, first_name, last_name, username, email, role, status, created_at, updated_at, last_log_in`,
      [...queryParams, callingTenantId]
    );

    if (res.rows.length > 0) {
      const updatedUser = res.rows[0];
      const tenantRes = await client.query('SELECT tenant_name FROM tenants WHERE id = $1', [updatedUser.tenant_id]);
      const tenant_name = tenantRes.rows.length > 0 ? tenantRes.rows[0].tenant_name : null;
      const branchRes = updatedUser.tenant_branch_id ? await client.query('SELECT branch_name FROM tenant_branch WHERE id = $1', [updatedUser.tenant_branch_id]) : { rows: [] };
      const branch_name = branchRes.rows.length > 0 ? branchRes.rows[0].branch_name : null;

      return {
        success: true,
        message: "User updated successfully.",
        user: {
          id: updatedUser.id,
          tenant_id: updatedUser.tenant_id,
          tenant_name,
          tenant_branch_id: updatedUser.tenant_branch_id,
          branch_name,
          first_name: updatedUser.first_name,
          last_name: updatedUser.last_name,
          username: updatedUser.username,
          email: updatedUser.email,
          role: updatedUser.role as User['role'],
          status: updatedUser.status,
          created_at: new Date(updatedUser.created_at).toISOString(),
          updated_at: new Date(updatedUser.updated_at).toISOString(),
          last_log_in: updatedUser.last_log_in ? new Date(updatedUser.last_log_in).toISOString() : null,
        }
      };
    }
    return { success: false, message: "User not found or no changes made." };
  } catch (error) {
    console.error(`Failed to update user ${userId} by admin:`, error);
    let errorMessage = "Database error occurred during user update.";
    if (error instanceof Error && (error as any).code === '23505' && (error as any).constraint === 'users_email_key') {
        errorMessage = "This email address is already in use by another user.";
    } else if (error instanceof Error) {
        errorMessage = `Database error: ${error.message}`;
    }
    return { success: false, message: errorMessage };
  } finally {
    client.release();
  }
}

export async function archiveUserAdmin(userId: number, callingTenantId: number): Promise<{ success: boolean; message?: string }> {
  if (isNaN(callingTenantId) || callingTenantId <= 0) {
    return { success: false, message: "Invalid calling tenant ID." };
  }
  const client = await pool.connect();
  try {
    const userCheck = await client.query('SELECT tenant_id FROM users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0 || userCheck.rows[0].tenant_id !== callingTenantId) {
      return { success: false, message: "User not found in this tenant or permission denied." };
    }

    const res = await client.query(
      `UPDATE users SET status = '0', updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [userId, callingTenantId]
    );
    if (res.rowCount > 0) {
      return { success: true, message: "User archived successfully." };
    }
    return { success: false, message: "User not found or already archived." };
  } catch (error) {
    console.error(`Failed to archive user ${userId} by admin:`, error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}


// Hotel Rate Actions
export async function listRatesForBranch(branchId: number, tenantId: number): Promise<HotelRate[]> {
  if (isNaN(branchId) || branchId <= 0 || isNaN(tenantId) || tenantId <= 0) {
    return [];
  }
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT hr.id, hr.tenant_id, hr.branch_id, tb.branch_name, hr.name, hr.price, hr.hours, hr.excess_hour_price, hr.description, hr.status, hr.created_at, hr.updated_at
       FROM hotel_rates hr
       JOIN tenant_branch tb ON hr.branch_id = tb.id
       WHERE hr.branch_id = $1 AND hr.tenant_id = $2
       ORDER BY hr.name ASC`,
      [branchId, tenantId]
    );
    return res.rows.map(row => ({
      ...row,
      price: parseFloat(row.price),
      excess_hour_price: row.excess_hour_price ? parseFloat(row.excess_hour_price) : null,
      created_at: new Date(row.created_at).toISOString(),
      updated_at: new Date(row.updated_at).toISOString(),
    })) as HotelRate[];
  } catch (error) {
    console.error(`Failed to fetch rates for branch ${branchId}:`, error);
    throw new Error(`Database error: Could not fetch rates. ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}

export async function createRate(
  data: HotelRateCreateData,
  tenantId: number,
  branchId: number
): Promise<{ success: boolean; message?: string; rate?: HotelRate }> {
  const validatedFields = hotelRateCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    return { success: false, message: `Invalid data: ${JSON.stringify(validatedFields.error.flatten().fieldErrors)}` };
  }
  const { name, price, hours, excess_hour_price, description } = validatedFields.data;
  const client = await pool.connect();
  try {
    // created_at and updated_at will use DB defaults (Asia/Manila)
    const res = await client.query(
      `INSERT INTO hotel_rates (tenant_id, branch_id, name, price, hours, excess_hour_price, description, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, '1')
       RETURNING id, tenant_id, branch_id, name, price, hours, excess_hour_price, description, status, created_at, updated_at`,
      [tenantId, branchId, name, price, hours, excess_hour_price, description]
    );
    if (res.rows.length > 0) {
      const newRow = res.rows[0];
      const branchRes = await client.query('SELECT branch_name FROM tenant_branch WHERE id = $1', [branchId]);
      const branch_name = branchRes.rows.length > 0 ? branchRes.rows[0].branch_name : null;
      return {
        success: true,
        message: "Rate created successfully.",
        rate: {
          ...newRow,
          branch_name,
          price: parseFloat(newRow.price),
          excess_hour_price: newRow.excess_hour_price ? parseFloat(newRow.excess_hour_price) : null,
          created_at: new Date(newRow.created_at).toISOString(),
          updated_at: new Date(newRow.updated_at).toISOString(),
        } as HotelRate
      };
    }
    return { success: false, message: "Rate creation failed." };
  } catch (error) {
    console.error('Failed to create rate:', error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}

export async function updateRate(
  rateId: number,
  data: HotelRateUpdateData,
  tenantId: number,
  branchId: number
): Promise<{ success: boolean; message?: string; rate?: HotelRate }> {
  const validatedFields = hotelRateUpdateSchema.safeParse(data);
  if (!validatedFields.success) {
    return { success: false, message: `Invalid data: ${JSON.stringify(validatedFields.error.flatten().fieldErrors)}` };
  }
  const { name, price, hours, excess_hour_price, description, status } = validatedFields.data;
  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE hotel_rates
       SET name = $1, price = $2, hours = $3, excess_hour_price = $4, description = $5, status = $6, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $7 AND tenant_id = $8 AND branch_id = $9
       RETURNING id, tenant_id, branch_id, name, price, hours, excess_hour_price, description, status, created_at, updated_at`,
      [name, price, hours, excess_hour_price, description, status, rateId, tenantId, branchId]
    );
    if (res.rows.length > 0) {
      const updatedRow = res.rows[0];
       const branchRes = await client.query('SELECT branch_name FROM tenant_branch WHERE id = $1', [branchId]);
      const branch_name = branchRes.rows.length > 0 ? branchRes.rows[0].branch_name : null;
      return {
        success: true,
        message: "Rate updated successfully.",
        rate: {
          ...updatedRow,
          branch_name,
          price: parseFloat(updatedRow.price),
          excess_hour_price: updatedRow.excess_hour_price ? parseFloat(updatedRow.excess_hour_price) : null,
          created_at: new Date(updatedRow.created_at).toISOString(),
          updated_at: new Date(updatedRow.updated_at).toISOString(),
        } as HotelRate
      };
    }
    return { success: false, message: "Rate not found or no changes made." };
  } catch (error) {
    console.error(`Failed to update rate ${rateId}:`, error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}

export async function archiveRate(rateId: number, tenantId: number, branchId: number): Promise<{ success: boolean; message?: string }> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE hotel_rates SET status = '0', updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 RETURNING id`,
      [rateId, tenantId, branchId]
    );
    if (res.rowCount > 0) {
      return { success: true, message: "Rate archived successfully." };
    }
    return { success: false, message: "Rate not found or already archived." };
  } catch (error) {
    console.error(`Failed to archive rate ${rateId}:`, error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}

export async function getRatesForBranchSimple(branchId: number, tenantId: number): Promise<SimpleRate[]> {
   if (isNaN(branchId) || branchId <= 0 || isNaN(tenantId) || tenantId <= 0) {
    return [];
  }
  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT id, name, price FROM hotel_rates WHERE branch_id = $1 AND tenant_id = $2 AND status = '1' ORDER BY name ASC",
      [branchId, tenantId]
    );
    return result.rows.map(row => ({
        ...row,
        price: parseFloat(row.price)
    })) as SimpleRate[];
  } catch (error: any) {
     console.error(`Failed to fetch simple rates for branch ${branchId}:`, error.message);
    throw new Error(`Database error: Could not fetch simple active rates. ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}


// Hotel Room Actions
export async function listRoomsForBranch(branchId: number, tenantId: number): Promise<HotelRoom[]> {
  const client = await pool.connect();
  try {
    const query = `
      SELECT
        hr.id, hr.tenant_id, hr.branch_id, tb.branch_name,
        hr.hotel_rate_id, hr.transaction_id, 
        hr.room_name, hr.room_code, hr.floor, hr.room_type, hr.bed_type, hr.capacity,
        hr.is_available, hr.status, hr.created_at, hr.updated_at,
        t_active.client_name AS active_transaction_client_name,
        t_active.check_in_time AS active_transaction_check_in_time,
        hr_active.name AS active_transaction_rate_name
      FROM hotel_room hr
      JOIN tenant_branch tb ON hr.branch_id = tb.id
      LEFT JOIN transactions t_active ON hr.transaction_id = t_active.id
          AND t_active.tenant_id = hr.tenant_id 
          AND t_active.branch_id = hr.branch_id
          AND (t_active.status = $3 OR t_active.status = $4) -- Unpaid or Advance Paid
      LEFT JOIN hotel_rates hr_active ON t_active.hotel_rate_id = hr_active.id 
          AND hr_active.tenant_id = hr.tenant_id 
          AND hr_active.branch_id = hr.branch_id 
          AND hr_active.status = '1'
      WHERE hr.branch_id = $1 AND hr.tenant_id = $2 AND hr.status = '1'
      ORDER BY hr.floor ASC, hr.room_code ASC;
    `;

    const res = await client.query(query, [branchId, tenantId, TRANSACTION_STATUS.UNPAID, TRANSACTION_STATUS.ADVANCE_PAID]);

    return res.rows.map(row => {
      let parsedRateIds: number[] | null = null;
      if (row.hotel_rate_id) {
        try {
          // Ensure we handle both stringified JSON and actual JSONB from DB if type changes
          const rawRateIdData = row.hotel_rate_id;
          if (typeof rawRateIdData === 'string') {
            parsedRateIds = JSON.parse(rawRateIdData);
          } else if (typeof rawRateIdData === 'object' && rawRateIdData !== null) {
            // If it's already an array or an object from JSONB (less likely if type is just JSON)
            parsedRateIds = Array.isArray(rawRateIdData) ? rawRateIdData : [];
          } else {
            parsedRateIds = [];
          }
          if (!Array.isArray(parsedRateIds) || !parsedRateIds.every(id => typeof id === 'number')) {
            parsedRateIds = [];
          }
        } catch (parseError) {
          console.error(`Error parsing hotel_rate_id JSON for room ${row.id}:`, row.hotel_rate_id, parseError);
          parsedRateIds = [];
        }
      } else {
        parsedRateIds = [];
      }

      const activeTransactionIdFromRoom = row.transaction_id ? Number(row.transaction_id) : null;
      const activeTransactionClientName = row.active_transaction_client_name || null;
      const activeTransactionCheckInTime = row.active_transaction_check_in_time ? new Date(row.active_transaction_check_in_time).toISOString() : null;
      const activeTransactionRateName = row.active_transaction_rate_name || null;
      
      if (Number(row.is_available) === ROOM_AVAILABILITY_STATUS.OCCUPIED || Number(row.is_available) === ROOM_AVAILABILITY_STATUS.RESERVED) {
        console.log(`[listRoomsForBranch Server Log] Room ${row.room_name} (ID: ${row.id}):`, {
          is_available_db: row.is_available,
          room_transaction_id_db: row.transaction_id,
          active_transaction_id_db: row.active_transaction_id,
          active_transaction_client_name_db: row.active_transaction_client_name,
          active_transaction_check_in_time_db: row.active_transaction_check_in_time,
          active_transaction_rate_name_db: row.active_transaction_rate_name,
          mapped_client_name: activeTransactionClientName,
          mapped_check_in_time: activeTransactionCheckInTime
        });
      }

      return {
        id: row.id,
        tenant_id: row.tenant_id,
        branch_id: row.branch_id,
        branch_name: row.branch_name,
        hotel_rate_id: parsedRateIds,
        transaction_id: activeTransactionIdFromRoom,
        room_name: row.room_name,
        room_code: row.room_code,
        floor: row.floor,
        room_type: row.room_type,
        bed_type: row.bed_type,
        capacity: row.capacity,
        is_available: Number(row.is_available),
        status: row.status,
        created_at: new Date(row.created_at).toISOString(),
        updated_at: new Date(row.updated_at).toISOString(),
        active_transaction_id: activeTransactionIdFromRoom,
        active_transaction_client_name: activeTransactionClientName,
        active_transaction_check_in_time: activeTransactionCheckInTime,
        active_transaction_rate_name: activeTransactionRateName,
      } as HotelRoom;
    });
  } catch (error) {
    console.error(`Failed to fetch rooms for branch ${branchId}:`, error);
    throw new Error(`Database error: Could not fetch rooms. ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}

export async function createRoom(
  data: HotelRoomCreateData,
  tenantId: number,
  branchId: number
): Promise<{ success: boolean; message?: string; room?: HotelRoom }> {
  const validatedFields = hotelRoomCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    return { success: false, message: `Invalid data: ${JSON.stringify(validatedFields.error.flatten().fieldErrors)}` };
  }

  const { hotel_rate_ids, room_name, room_code, floor, room_type, bed_type, capacity, is_available } = validatedFields.data;
  const client = await pool.connect();
  try {
    const rateIdsToStore = Array.isArray(hotel_rate_ids) ? hotel_rate_ids : [];
    const hotelRateIdJson = JSON.stringify(rateIdsToStore);
    // created_at and updated_at will use DB defaults (Asia/Manila)
    const res = await client.query(
      `INSERT INTO hotel_room (tenant_id, branch_id, hotel_rate_id, room_name, room_code, floor, room_type, bed_type, capacity, is_available, status, transaction_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '1', NULL)
       RETURNING id, tenant_id, branch_id, hotel_rate_id, transaction_id, room_name, room_code, floor, room_type, bed_type, capacity, is_available, status, created_at, updated_at`,
      [tenantId, branchId, hotelRateIdJson, room_name, room_code, floor, room_type, bed_type, capacity, is_available]
    );
    if (res.rows.length > 0) {
      const newRow = res.rows[0];
      const branchRes = await client.query('SELECT branch_name FROM tenant_branch WHERE id = $1', [branchId]);
      const branch_name = branchRes.rows.length > 0 ? branchRes.rows[0].branch_name : null;

      let parsedRateIds: number[] | null = null;
      if (newRow.hotel_rate_id) {
         try {
          parsedRateIds = typeof newRow.hotel_rate_id === 'string' ? JSON.parse(newRow.hotel_rate_id) : newRow.hotel_rate_id;
          if (!Array.isArray(parsedRateIds)) parsedRateIds = [];
        } catch { parsedRateIds = []; }
      } else {
        parsedRateIds = [];
      }

      return {
        success: true,
        message: "Room created successfully.",
        room: {
          ...newRow,
          branch_name,
          hotel_rate_id: parsedRateIds,
          transaction_id: newRow.transaction_id ? Number(newRow.transaction_id) : null,
          is_available: Number(newRow.is_available),
          created_at: new Date(newRow.created_at).toISOString(),
          updated_at: new Date(newRow.updated_at).toISOString(),
        } as HotelRoom
      };
    }
    return { success: false, message: "Room creation failed." };
  } catch (error) {
    console.error('Failed to create room:', error);
    let errorMessage = "Database error occurred during room creation.";
    if (error instanceof Error && (error as any).code === '23505' && (error as any).constraint === 'hotel_room_room_code_key') {
      errorMessage = "This room code is already in use for this branch.";
    } else if (error instanceof Error) {
      errorMessage = `Database error: ${error.message}`;
    }
    return { success: false, message: errorMessage };
  } finally {
    client.release();
  }
}

export async function updateRoom(roomId: number, data: HotelRoomUpdateData, tenantId: number, branchId: number): Promise<{ success: boolean; message?: string; room?: HotelRoom }> {
  const validatedFields = hotelRoomUpdateSchema.safeParse(data);
  if (!validatedFields.success) {
    return { success: false, message: `Invalid data: ${JSON.stringify(validatedFields.error.flatten().fieldErrors)}` };
  }

  const { hotel_rate_ids, room_name, room_code, floor, room_type, bed_type, capacity, is_available, status } = validatedFields.data;

  const client = await pool.connect();
  try {
    const rateIdsToStore = Array.isArray(hotel_rate_ids) ? hotel_rate_ids : [];
    const hotelRateIdJson = JSON.stringify(rateIdsToStore);

    const res = await client.query(
      `UPDATE hotel_room
       SET hotel_rate_id = $1, room_name = $2, room_code = $3, floor = $4, room_type = $5, bed_type = $6, capacity = $7, is_available = $8, status = $9, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $10 AND tenant_id = $11 AND branch_id = $12
       RETURNING id, tenant_id, branch_id, hotel_rate_id, transaction_id, room_name, room_code, floor, room_type, bed_type, capacity, is_available, status, created_at, updated_at`,
      [hotelRateIdJson, room_name, room_code, floor, room_type, bed_type, capacity, is_available, status, roomId, tenantId, branchId]
    );
    if (res.rows.length > 0) {
      const updatedRow = res.rows[0];
      const branchRes = await client.query('SELECT branch_name FROM tenant_branch WHERE id = $1', [branchId]);
      const branch_name = branchRes.rows.length > 0 ? branchRes.rows[0].branch_name : null;

      let parsedRateIds: number[] | null = null;
      if (updatedRow.hotel_rate_id) {
         try {
          parsedRateIds = typeof updatedRow.hotel_rate_id === 'string' ? JSON.parse(updatedRow.hotel_rate_id) : updatedRow.hotel_rate_id;
          if (!Array.isArray(parsedRateIds)) parsedRateIds = [];
        } catch { parsedRateIds = []; }
      } else {
        parsedRateIds = [];
      }

      return {
        success: true,
        message: "Room updated successfully.",
        room: {
          ...updatedRow,
          branch_name,
          hotel_rate_id: parsedRateIds,
          transaction_id: updatedRow.transaction_id ? Number(updatedRow.transaction_id) : null,
          is_available: Number(updatedRow.is_available),
          created_at: new Date(updatedRow.created_at).toISOString(),
          updated_at: new Date(updatedRow.updated_at).toISOString(),
        } as HotelRoom
      };
    }
    return { success: false, message: "Room not found or no changes made." };
  } catch (error) {
    console.error(`Failed to update room ${roomId}:`, error);
     let errorMessage = "Database error occurred during room update.";
    if (error instanceof Error && (error as any).code === '23505' && (error as any).constraint === 'hotel_room_room_code_key') {
      errorMessage = "This room code is already in use for this branch.";
    } else if (error instanceof Error) {
      errorMessage = `Database error: ${error.message}`;
    }
    return { success: false, message: errorMessage };
  } finally {
    client.release();
  }
}

export async function archiveRoom(roomId: number, tenantId: number, branchId: number): Promise<{ success: boolean; message?: string }> {
  const client = await pool.connect();
  try {

    const roomCheck = await client.query('SELECT transaction_id FROM hotel_room WHERE id = $1 AND tenant_id = $2 AND branch_id = $3', [roomId, tenantId, branchId]);
    if (roomCheck.rows.length > 0 && roomCheck.rows[0].transaction_id !== null) {
        return { success: false, message: "Cannot archive room with an active or pending transaction. Please resolve the transaction first."};
    }

    const res = await client.query(
      `UPDATE hotel_room SET status = '0', updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 RETURNING id`,
      [roomId, tenantId, branchId]
    );
    if (res.rowCount > 0) {
      return { success: true, message: "Room archived successfully." };
    }
    return { success: false, message: "Room not found or already archived." };
  } catch (error) {
    console.error(`Failed to archive room ${roomId}:`, error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}

    