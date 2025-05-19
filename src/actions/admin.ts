
"use server";

import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import type { Tenant, Branch, User, SimpleBranch } from '@/lib/types';
import { 
  branchUpdateSchema, 
  tenantCreateSchema, TenantCreateData, tenantUpdateSchema, TenantUpdateData,
  userCreateSchema, UserCreateData, userUpdateSchemaSysAd, UserUpdateDataSysAd,
  branchCreateSchema, BranchCreateData, branchUpdateSchemaSysAd, BranchUpdateDataSysAd,
  userCreateSchemaAdmin, UserCreateDataAdmin, userUpdateSchemaAdmin, UserUpdateDataAdmin
} from '@/lib/schemas';
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
    return { success: false, message: `Invalid data: ${JSON.stringify(validatedFields.error.flatten().fieldErrors)}` };
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

export async function updateTenant(tenantId: number, data: TenantUpdateData): Promise<{ success: boolean; message?: string; tenant?: Tenant }> {
  const validatedFields = tenantUpdateSchema.safeParse(data);
  if (!validatedFields.success) {
    return { success: false, message: `Invalid data: ${JSON.stringify(validatedFields.error.flatten().fieldErrors)}` };
  }
  const { tenant_name, tenant_address, tenant_email, tenant_contact_info, status } = data; 
  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE tenants 
       SET tenant_name = $1, tenant_address = $2, tenant_email = $3, tenant_contact_info = $4, status = $5, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $6
       RETURNING id, tenant_name, tenant_address, tenant_email, tenant_contact_info, created_at, updated_at, status`,
      [tenant_name, tenant_address, tenant_email, tenant_contact_info, status, tenantId]
    );
    if (res.rows.length > 0) {
      const updatedRow = res.rows[0];
      return { success: true, message: "Tenant updated successfully.", tenant: { ...updatedRow, created_at: new Date(updatedRow.created_at).toISOString(), updated_at: new Date(updatedRow.updated_at).toISOString() } as Tenant };
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
      `UPDATE tenants SET status = '0', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id`,
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

  const { branch_name, branch_address, contact_number, email_address } = validatedFields.data;
  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE tenant_branch 
       SET branch_name = $1, branch_address = $2, contact_number = $3, email_address = $4, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $5
       RETURNING id, tenant_id, branch_name, branch_code, branch_address, contact_number, email_address, created_at, updated_at, status`,
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


export async function updateBranchSysAd(branchId: number, data: BranchUpdateDataSysAd): Promise<{ success: boolean; message?: string; branch?: Branch }> {
  const validatedFields = branchUpdateSchemaSysAd.safeParse(data);
  if (!validatedFields.success) {
    return { success: false, message: `Invalid data: ${JSON.stringify(validatedFields.error.flatten().fieldErrors)}` };
  }

  const { tenant_id, branch_name, branch_address, contact_number, email_address, status } = validatedFields.data;
  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE tenant_branch 
       SET tenant_id = $1, branch_name = $2, branch_address = $3, contact_number = $4, email_address = $5, status = $6, updated_at = CURRENT_TIMESTAMP 
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

export async function archiveBranch(branchId: number): Promise<{ success: boolean; message?: string }> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE tenant_branch SET status = '0', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id`,
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
  
  const salt = bcrypt.genSaltSync(10);
  const password_hash = bcrypt.hashSync(password, salt);

  const client = await pool.connect();
  try {
    const res = await client.query(
      `INSERT INTO users (first_name, last_name, username, password_hash, email, role, tenant_id, tenant_branch_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
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
       SET first_name = $1, last_name = $2, email = $3, role = $4, tenant_id = $5, tenant_branch_id = $6, status = $7, updated_at = CURRENT_TIMESTAMP ${password_hash_update_string}
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
      `UPDATE users SET status = '0', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id`,
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
       LEFT JOIN tenant_branch tb ON u.tenant_branch_id = tb.id
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

  const salt = bcrypt.genSaltSync(10);
  const password_hash = bcrypt.hashSync(password, salt);

  const client = await pool.connect();
  try {
    const res = await client.query(
      `INSERT INTO users (first_name, last_name, username, password_hash, email, role, tenant_id, tenant_branch_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
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
    // Verify user belongs to the admin's tenant
    const userCheck = await client.query('SELECT tenant_id FROM users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0 || userCheck.rows[0].tenant_id !== callingTenantId) {
      return { success: false, message: "User not found in this tenant or permission denied." };
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
       SET first_name = $1, last_name = $2, email = $3, role = $4, tenant_branch_id = $5, status = $6, updated_at = CURRENT_TIMESTAMP ${password_hash_update_string}
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
    // Verify user belongs to the admin's tenant
    const userCheck = await client.query('SELECT tenant_id FROM users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0 || userCheck.rows[0].tenant_id !== callingTenantId) {
      return { success: false, message: "User not found in this tenant or permission denied." };
    }

    const res = await client.query(
      `UPDATE users SET status = '0', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2 RETURNING id`,
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
    
