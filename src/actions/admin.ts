
"use server";

import pg from 'pg';
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE
pg.types.setTypeParser(20, (stringValue) => parseInt(stringValue, 10)); 
pg.types.setTypeParser(1700, (stringValue) => parseFloat(stringValue)); 

import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import type { Tenant, Branch, User, SimpleBranch, HotelRate, HotelRoom, SimpleRate, Notification } from '@/lib/types';
import {
  branchUpdateSchema,
  tenantCreateSchema, TenantCreateData, tenantUpdateSchema, TenantUpdateData,
  userCreateSchema, UserCreateData, userUpdateSchemaSysAd, UserUpdateDataSysAd,
  branchCreateSchema, BranchCreateData, branchUpdateSchemaSysAd, BranchUpdateDataSysAd,
  userCreateSchemaAdmin, UserCreateDataAdmin, userUpdateSchemaAdmin, UserUpdateDataAdmin,
  hotelRateCreateSchema, HotelRateCreateData, hotelRateUpdateSchema, HotelRateUpdateData,
  hotelRoomCreateSchema, HotelRoomCreateData, hotelRoomUpdateSchema, HotelRoomUpdateData,
  notificationCreateSchema, NotificationCreateData
} from '@/lib/schemas';
import type { z } from 'zod';
import { ROOM_AVAILABILITY_STATUS, TRANSACTION_STATUS, NOTIFICATION_STATUS, NOTIFICATION_TRANSACTION_STATUS, TRANSACTION_IS_ACCEPTED_STATUS, ROOM_CLEANING_STATUS } from '@/lib/constants';
import { createUnassignedReservation } from '@/actions/staff';
import type { TransactionCreateData } from '@/lib/schemas';


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
    return res.rows as Tenant[];
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
    const res = await client.query(
      `INSERT INTO tenants (tenant_name, tenant_address, tenant_email, tenant_contact_info, max_branch_count, max_user_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'))
       RETURNING id, tenant_name, tenant_address, tenant_email, tenant_contact_info, max_branch_count, max_user_count, created_at, updated_at, status`,
      [tenant_name, tenant_address, tenant_email, tenant_contact_info, max_branch_count, max_user_count]
    );
    if (res.rows.length > 0) {
      return {
        success: true,
        message: "Tenant created successfully.",
        tenant: res.rows[0] as Tenant
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
      return { success: true, message: "Tenant updated successfully.", tenant: res.rows[0] as Tenant };
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
      return res.rows[0] as Tenant;
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
    return res.rows as Branch[];
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
      return {
        success: true,
        message: "Branch updated successfully.",
        updatedBranch: res.rows[0] as Branch,
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
    const res = await client.query(
      `INSERT INTO tenant_branch (tenant_id, branch_name, branch_code, branch_address, contact_number, email_address, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, '1', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'))
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
    return res.rows as Branch[];
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
    return res.rows as User[];
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
    const res = await client.query(
      `INSERT INTO users (first_name, last_name, username, password_hash, email, role, tenant_id, tenant_branch_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '1', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'))
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
          ...newUser,
          tenant_name,
          branch_name,
        } as User
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
                        if (userCurrentTenantId !== targetTenantId || (userCurrentTenantId === targetTenantId && currentUserRes.rows[0].status === '0')) {
                             return { success: false, message: `Target tenant (ID: ${targetTenantId}) has reached the maximum active user limit of ${max_user_count}. To restore or move this user, please archive an existing active user in that tenant first or increase the tenant's limit.` };
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
            ...updatedUser,
            tenant_name,
            branch_name,
        } as User
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
    return res.rows as User[];
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
    const res = await client.query(
      `INSERT INTO users (first_name, last_name, username, password_hash, email, role, tenant_id, tenant_branch_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '1', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'))
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
          ...newUser,
          tenant_name,
          branch_name,
        } as User
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

    if (status === '1' && currentUserStatus === '0') { // Restoring an archived user
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
          ...updatedUser,
          tenant_name,
          branch_name,
        } as User
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
    const res = await client.query(
      `INSERT INTO hotel_rates (tenant_id, branch_id, name, price, hours, excess_hour_price, description, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, '1', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'))
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
      "SELECT id, name, price, hours FROM hotel_rates WHERE branch_id = $1 AND tenant_id = $2 AND status = '1' ORDER BY name ASC",
      [branchId, tenantId]
    );
    return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        price: parseFloat(row.price),
        hours: parseInt(row.hours, 10),
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
        hr.hotel_rate_id, -- This is JSON
        hr.room_name, hr.room_code, hr.floor, hr.room_type, hr.bed_type, hr.capacity,
        hr.is_available, hr.cleaning_status, hr.status, hr.created_at, hr.updated_at,
        hr.transaction_id,
        t_active.client_name AS active_transaction_client_name,
        t_active.check_in_time AS active_transaction_check_in_time,
        t_active.status as active_transaction_status,
        hrt_active.name AS active_transaction_rate_name,
        hrt_active.hours AS active_transaction_rate_hours
      FROM hotel_room hr
      JOIN tenant_branch tb ON hr.branch_id = tb.id
      LEFT JOIN transactions t_active ON hr.transaction_id = t_active.id
          AND t_active.tenant_id = hr.tenant_id
          AND t_active.branch_id = hr.branch_id
          AND (t_active.status = $3 OR t_active.status = $4 OR t_active.status = $5) -- Unpaid, Advance Paid, Pending Acceptance
      LEFT JOIN hotel_rates hrt_active ON t_active.hotel_rate_id = hrt_active.id
          AND hrt_active.tenant_id = hr.tenant_id
          AND hrt_active.branch_id = hr.branch_id
          AND hrt_active.status = '1'
      WHERE hr.branch_id = $1 AND hr.tenant_id = $2 AND hr.status = '1' -- Only active room definitions
      ORDER BY hr.floor ASC, hr.room_code ASC;
    `;

    const res = await client.query(query, [branchId, tenantId, TRANSACTION_STATUS.UNPAID, TRANSACTION_STATUS.ADVANCE_PAID, TRANSACTION_STATUS.PENDING_BRANCH_ACCEPTANCE]);

    if (process.env.NODE_ENV === 'development') {
        console.log(`[listRoomsForBranch Server Log] Fetched ${res.rows.length} rooms for branch ${branchId}`);
        res.rows.forEach(row => {
            if (row.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED || row.is_available === ROOM_AVAILABILITY_STATUS.RESERVED) {
                 console.log(`[listRoomsForBranch Server Log] Room ${row.room_name} (ID: ${row.id}):`, {
                    is_available_db: row.is_available,
                    room_transaction_id_db: row.transaction_id,
                    active_transaction_client_name_db: row.active_transaction_client_name,
                    active_transaction_check_in_time_db: row.active_transaction_check_in_time,
                    active_transaction_rate_name_db: row.active_transaction_rate_name,
                    active_transaction_rate_hours_db: row.active_transaction_rate_hours,
                    active_transaction_status_db: row.active_transaction_status,
                 });
            }
        });
    }

    return res.rows.map(row => {
      let parsedRateIds: number[] | null = null;
      if (row.hotel_rate_id) {
        try {
          parsedRateIds = typeof row.hotel_rate_id === 'string' ? JSON.parse(row.hotel_rate_id) : Array.isArray(row.hotel_rate_id) ? row.hotel_rate_id : [];
          if (!Array.isArray(parsedRateIds) || !parsedRateIds.every(id => typeof id === 'number')) {
            if (process.env.NODE_ENV === 'development'){
              console.warn(`[listRoomsForBranch] Parsed hotel_rate_id for room ${row.id} is not a valid number array:`, parsedRateIds);
            }
            parsedRateIds = [];
          }
        } catch (parseError) {
          console.error(`Error parsing hotel_rate_id JSON for room ${row.id}:`, row.hotel_rate_id, parseError);
          parsedRateIds = [];
        }
      } else {
        parsedRateIds = [];
      }
      return {
        id: row.id,
        tenant_id: row.tenant_id,
        branch_id: row.branch_id,
        branch_name: row.branch_name,
        hotel_rate_id: parsedRateIds,
        transaction_id: row.transaction_id ? Number(row.transaction_id) : null,
        room_name: row.room_name,
        room_code: row.room_code,
        floor: row.floor,
        room_type: row.room_type,
        bed_type: row.bed_type,
        capacity: row.capacity,
        is_available: Number(row.is_available),
        cleaning_status: row.cleaning_status || ROOM_CLEANING_STATUS.CLEAN,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
        active_transaction_id: row.transaction_id ? Number(row.transaction_id) : null, // Added this for consistency
        active_transaction_client_name: row.active_transaction_client_name || null,
        active_transaction_check_in_time: row.active_transaction_check_in_time || null,
        active_transaction_rate_name: row.active_transaction_rate_name || null,
        active_transaction_rate_hours: row.active_transaction_rate_hours ? parseInt(row.active_transaction_rate_hours, 10) : null,
        active_transaction_status: row.active_transaction_status || null,
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

  const { hotel_rate_ids, room_name, room_code, floor, room_type, bed_type, capacity, is_available, cleaning_status } = validatedFields.data;
  const client = await pool.connect();
  try {
    const rateIdsToStore = Array.isArray(hotel_rate_ids) ? hotel_rate_ids : [];
    const hotelRateIdJson = JSON.stringify(rateIdsToStore);
    const res = await client.query(
      `INSERT INTO hotel_room (tenant_id, branch_id, hotel_rate_id, room_name, room_code, floor, room_type, bed_type, capacity, is_available, cleaning_status, status, transaction_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, '1', NULL, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'))
       RETURNING id, tenant_id, branch_id, hotel_rate_id, transaction_id, room_name, room_code, floor, room_type, bed_type, capacity, is_available, cleaning_status, status, created_at, updated_at`,
      [tenantId, branchId, hotelRateIdJson, room_name, room_code, floor, room_type, bed_type, capacity, is_available, cleaning_status || ROOM_CLEANING_STATUS.CLEAN]
    );
    if (res.rows.length > 0) {
      const newRow = res.rows[0];
      const branchRes = await client.query('SELECT branch_name FROM tenant_branch WHERE id = $1', [branchId]);
      const branch_name = branchRes.rows.length > 0 ? branchRes.rows[0].branch_name : null;

      let parsedRateIds: number[] | null = null;
      if (newRow.hotel_rate_id) {
         try {
          parsedRateIds = typeof newRow.hotel_rate_id === 'string' ? JSON.parse(newRow.hotel_rate_id) : Array.isArray(newRow.hotel_rate_id) ? newRow.hotel_rate_id : [];
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
          cleaning_status: newRow.cleaning_status || ROOM_CLEANING_STATUS.CLEAN,
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

  const { hotel_rate_ids, room_name, room_code, floor, room_type, bed_type, capacity, is_available, cleaning_status, status } = validatedFields.data;

  const client = await pool.connect();
  try {
    const rateIdsToStore = Array.isArray(hotel_rate_ids) ? hotel_rate_ids : [];
    const hotelRateIdJson = JSON.stringify(rateIdsToStore);

    const transactionIdUpdate = (is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE) ? ', transaction_id = NULL' : '';


    const res = await client.query(
      `UPDATE hotel_room
       SET hotel_rate_id = $1, room_name = $2, room_code = $3, floor = $4, room_type = $5, bed_type = $6, capacity = $7, is_available = $8, cleaning_status = $9, status = $10, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') ${transactionIdUpdate}
       WHERE id = $11 AND tenant_id = $12 AND branch_id = $13
       RETURNING id, tenant_id, branch_id, hotel_rate_id, transaction_id, room_name, room_code, floor, room_type, bed_type, capacity, is_available, cleaning_status, status, created_at, updated_at`,
      [hotelRateIdJson, room_name, room_code, floor, room_type, bed_type, capacity, is_available, cleaning_status || ROOM_CLEANING_STATUS.CLEAN, status, roomId, tenantId, branchId]
    );
    if (res.rows.length > 0) {
      const updatedRow = res.rows[0];
      const branchRes = await client.query('SELECT branch_name FROM tenant_branch WHERE id = $1', [branchId]);
      const branch_name = branchRes.rows.length > 0 ? branchRes.rows[0].branch_name : null;

      let parsedRateIds: number[] | null = null;
      if (updatedRow.hotel_rate_id) {
         try {
          parsedRateIds = typeof updatedRow.hotel_rate_id === 'string' ? JSON.parse(updatedRow.hotel_rate_id) : Array.isArray(updatedRow.hotel_rate_id) ? updatedRow.hotel_rate_id : [];
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
          cleaning_status: updatedRow.cleaning_status || ROOM_CLEANING_STATUS.CLEAN,
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

// Notification Actions
export async function listNotificationsForTenant(tenantId: number): Promise<Notification[]> {
  if (isNaN(tenantId) || tenantId <= 0) return [];
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT
        n.id, n.tenant_id, n.message, n.status,
        n.target_branch_id, tb.branch_name as target_branch_name,
        n.creator_user_id, u.username as creator_username,
        n.transaction_id, t.is_accepted as transaction_is_accepted, t.status as linked_transaction_status,
        n.created_at, n.read_at, n.transaction_status
       FROM notification n
       LEFT JOIN tenant_branch tb ON n.target_branch_id = tb.id AND tb.tenant_id = n.tenant_id
       LEFT JOIN users u ON n.creator_user_id = u.id
       LEFT JOIN transactions t ON n.transaction_id = t.id AND t.tenant_id = n.tenant_id
       WHERE n.tenant_id = $1
       ORDER BY n.created_at DESC`,
      [tenantId]
    );
    return res.rows.map(row => ({
        ...row,
        status: Number(row.status),
        transaction_status: Number(row.transaction_status),
        transaction_is_accepted: row.transaction_is_accepted !== null ? Number(row.transaction_is_accepted) : null,
        linked_transaction_status: row.linked_transaction_status,
    })) as Notification[];
  } catch (error) {
    console.error(`Failed to fetch notifications for tenant ${tenantId}:`, error);
    throw new Error(`Database error: Could not fetch notifications. ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}

export async function markNotificationAsRead(notificationId: number, tenantId: number): Promise<{ success: boolean; message?: string; notification?: Notification }> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE notification
       SET status = $1, read_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $2 AND tenant_id = $3
       RETURNING id`,
      [NOTIFICATION_STATUS.READ, notificationId, tenantId]
    );
    if (res.rows.length > 0) {
      const fullNotificationRes = await client.query(
        `SELECT
          n.id, n.tenant_id, n.message, n.status,
          n.target_branch_id, tb.branch_name as target_branch_name,
          n.creator_user_id, u.username as creator_username,
          n.transaction_id, t.is_accepted as transaction_is_accepted, t.status as linked_transaction_status,
          n.created_at, n.read_at, n.transaction_status
         FROM notification n
         LEFT JOIN tenant_branch tb ON n.target_branch_id = tb.id AND tb.tenant_id = n.tenant_id
         LEFT JOIN users u ON n.creator_user_id = u.id
         LEFT JOIN transactions t ON n.transaction_id = t.id AND t.tenant_id = n.tenant_id
         WHERE n.id = $1`, [res.rows[0].id]
      );
      return {
        success: true,
        message: "Notification marked as read.",
        notification: {
            ...fullNotificationRes.rows[0],
            status: Number(fullNotificationRes.rows[0].status),
            transaction_status: Number(fullNotificationRes.rows[0].transaction_status),
            transaction_is_accepted: fullNotificationRes.rows[0].transaction_is_accepted !== null ? Number(fullNotificationRes.rows[0].transaction_is_accepted) : null,
            linked_transaction_status: fullNotificationRes.rows[0].linked_transaction_status,
        } as Notification
      };
    }
    return { success: false, message: "Notification not found or no change made." };
  } catch (error) {
    console.error(`Failed to mark notification ${notificationId} as read:`, error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}

export async function updateNotificationTransactionStatus(
  notificationId: number,
  newTransactionStatus: number,
  linkedTransactionId: number | null,
  tenantId: number
): Promise<{ success: boolean; message?: string; notification?: Notification }> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE notification
       SET transaction_status = $1, transaction_id = $2, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
       WHERE id = $3 AND tenant_id = $4
       RETURNING id`,
      [newTransactionStatus, linkedTransactionId, notificationId, tenantId]
    );
     if (res.rows.length > 0) {
      const fullNotificationRes = await client.query(
        `SELECT
          n.id, n.tenant_id, n.message, n.status,
          n.target_branch_id, tb.branch_name as target_branch_name,
          n.creator_user_id, u.username as creator_username,
          n.transaction_id, t.is_accepted as transaction_is_accepted, t.status as linked_transaction_status,
          n.created_at, n.read_at, n.transaction_status
         FROM notification n
         LEFT JOIN tenant_branch tb ON n.target_branch_id = tb.id AND tb.tenant_id = n.tenant_id
         LEFT JOIN users u ON n.creator_user_id = u.id
         LEFT JOIN transactions t ON n.transaction_id = t.id AND t.tenant_id = n.tenant_id
         WHERE n.id = $1`, [res.rows[0].id]
      );
      return {
        success: true,
        message: "Notification transaction status updated.",
        notification: {
            ...fullNotificationRes.rows[0],
            status: Number(fullNotificationRes.rows[0].status),
            transaction_status: Number(fullNotificationRes.rows[0].transaction_status),
            transaction_is_accepted: fullNotificationRes.rows[0].transaction_is_accepted !== null ? Number(fullNotificationRes.rows[0].transaction_is_accepted) : null,
            linked_transaction_status: fullNotificationRes.rows[0].linked_transaction_status,
        } as Notification
       };
    }
    return { success: false, message: "Notification not found or no change made." };
  } catch (error) {
    console.error(`Failed to update transaction status for notification ${notificationId}:`, error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}

export async function createNotification(
  data: NotificationCreateData,
  tenantId: number,
  creatorUserId: number
): Promise<{ success: boolean; message?: string; notification?: Notification, createdTransactionId?: number | null }> {
  const validatedFields = notificationCreateSchema.safeParse(data);
  if (!validatedFields.success) {
    return { success: false, message: `Invalid data: ${JSON.stringify(validatedFields.error.flatten().fieldErrors)}` };
  }
  const { message, target_branch_id, do_reservation, ...reservationFields } = validatedFields.data;
  const client = await pool.connect();
  let createdReservationId: number | null = null;
  let finalTransactionStatus = NOTIFICATION_TRANSACTION_STATUS.PENDING_ACTION;

  try {
    await client.query('BEGIN');

    if (do_reservation && target_branch_id) {
        const reservationData: TransactionCreateData = {
            client_name: reservationFields.reservation_client_name || `Reservation: ${message.substring(0,30)}...`,
            selected_rate_id: reservationFields.reservation_selected_rate_id, // Now optional
            client_payment_method: reservationFields.reservation_client_payment_method,
            notes: reservationFields.reservation_notes,
            is_advance_reservation: reservationFields.reservation_is_advance,
            reserved_check_in_datetime: reservationFields.reservation_check_in_datetime,
            reserved_check_out_datetime: reservationFields.reservation_check_out_datetime,
        };
        const reservationResult = await createUnassignedReservation(reservationData, tenantId, target_branch_id, creatorUserId, true);
        if (reservationResult.success && reservationResult.transaction) {
            createdReservationId = reservationResult.transaction.id;
            finalTransactionStatus = NOTIFICATION_TRANSACTION_STATUS.RESERVATION_CREATED;
        } else {
            await client.query('ROLLBACK');
            return { success: false, message: `Failed to create linked reservation: ${reservationResult.message || 'Unknown error'}` };
        }
    }

    const res = await client.query(
      `INSERT INTO notification (tenant_id, message, status, target_branch_id, creator_user_id, transaction_id, transaction_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'))
       RETURNING id`,
      [
        tenantId,
        message,
        NOTIFICATION_STATUS.UNREAD,
        target_branch_id,
        creatorUserId,
        createdReservationId,
        finalTransactionStatus,
      ]
    );
    if (res.rows.length > 0) {
      const newNotificationId = res.rows[0].id;
      const fullNotificationRes = await client.query(
        `SELECT
          n.id, n.tenant_id, n.message, n.status,
          n.target_branch_id, tb.branch_name as target_branch_name,
          n.creator_user_id, u.username as creator_username,
          n.transaction_id, t.is_accepted as transaction_is_accepted, t.status as linked_transaction_status,
          n.created_at, n.read_at, n.transaction_status
         FROM notification n
         LEFT JOIN tenant_branch tb ON n.target_branch_id = tb.id AND tb.tenant_id = n.tenant_id
         LEFT JOIN users u ON n.creator_user_id = u.id
         LEFT JOIN transactions t ON n.transaction_id = t.id AND t.tenant_id = n.tenant_id
         WHERE n.id = $1`, [newNotificationId]
      );
      await client.query('COMMIT');
      return {
        success: true,
        message: "Notification created successfully." + (createdReservationId ? " Linked reservation also created." : ""),
        notification: {
            ...fullNotificationRes.rows[0],
            status: Number(fullNotificationRes.rows[0].status),
            transaction_status: Number(fullNotificationRes.rows[0].transaction_status),
            transaction_is_accepted: fullNotificationRes.rows[0].transaction_is_accepted !== null ? Number(fullNotificationRes.rows[0].transaction_is_accepted) : null,
            linked_transaction_status: fullNotificationRes.rows[0].linked_transaction_status,
        } as Notification,
        createdTransactionId: createdReservationId
      };
    }
    await client.query('ROLLBACK');
    return { success: false, message: "Notification creation failed." };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to create notification:', error);
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}

export async function deleteNotification(notificationId: number, tenantId: number): Promise<{ success: boolean; message?: string }> {
  if (isNaN(notificationId) || notificationId <= 0 || isNaN(tenantId) || tenantId <= 0) {
    return { success: false, message: "Invalid notification ID or tenant ID." };
  }
  const client = await pool.connect();
  try {
    const res = await client.query(
      'DELETE FROM notification WHERE id = $1 AND tenant_id = $2',
      [notificationId, tenantId]
    );
    if (res.rowCount > 0) {
      return { success: true, message: "Notification deleted successfully." };
    }
    return { success: false, message: "Notification not found or not authorized to delete." };
  } catch (error) {
    console.error(`Failed to delete notification ${notificationId}:`, error);
    if (error instanceof Error && (error as any).code === '23503') {
        return { success: false, message: "Cannot delete notification. It might be linked to an existing transaction. Please resolve the transaction first or contact support." };
    }
    return { success: false, message: `Database error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    client.release();
  }
}
