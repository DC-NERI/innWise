
"use server";

import pg from 'pg';
// Configure pg to return numeric types as numbers instead of strings
pg.types.setTypeParser(20, (val) => parseInt(val, 10)); // int8/bigint
pg.types.setTypeParser(21, (val) => parseInt(val, 10)); // int2/smallint
pg.types.setTypeParser(23, (val) => parseInt(val, 10)); // int4/integer
pg.types.setTypeParser(1700, (val) => parseFloat(val)); // numeric/decimal

// Configure pg to return timestamp without timezone as strings
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE

import { Pool } from 'pg';
import type { AdminDashboardSummary } from '@/lib/types';
import { TRANSACTION_LIFECYCLE_STATUS, TRANSACTION_PAYMENT_STATUS } from '../../../lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in getAdminDashboardSummary action', err);
});

export async function getAdminDashboardSummary(tenantId: number): Promise<{ success: boolean; message?: string; summary?: AdminDashboardSummary }> {
  if (!tenantId || typeof tenantId !== 'number') {
    return { success: false, message: "Invalid tenant ID." };
  }

  if (
    typeof TRANSACTION_LIFECYCLE_STATUS?.CHECKED_OUT === 'undefined' ||
    typeof TRANSACTION_PAYMENT_STATUS?.PAID === 'undefined'
  ) {
    console.error("[getAdminDashboardSummary] CRITICAL: Status constants are undefined.");
    return { success: false, message: "Server configuration error." };
  }

  const client = await pool.connect();
  try {
    // Calculate Total Sales for the tenant
    const totalSalesQuery = `
      SELECT SUM(total_amount) as total_sales
      FROM transactions
      WHERE tenant_id = $1
        AND status::INTEGER = $2
        AND is_paid = $3;
    `;
    const totalSalesRes = await client.query(totalSalesQuery, [
      tenantId,
      TRANSACTION_LIFECYCLE_STATUS.CHECKED_OUT,
      TRANSACTION_PAYMENT_STATUS.PAID
    ]);
    const totalSales = totalSalesRes.rows[0]?.total_sales || 0;

    // Calculate Branch Performance
    const branchPerformanceQuery = `
      SELECT
        tb.id as branch_id,
        tb.branch_name,
        COUNT(t.id) as transaction_count,
        SUM(CASE WHEN t.status::INTEGER = $2 AND t.is_paid = $3 THEN t.total_amount ELSE 0 END) as total_sales
      FROM tenant_branch tb
      LEFT JOIN transactions t ON tb.id = t.branch_id AND t.tenant_id = tb.tenant_id
      WHERE tb.tenant_id = $1
      GROUP BY tb.id, tb.branch_name
      ORDER BY tb.branch_name;
    `;
    const branchPerformanceRes = await client.query(branchPerformanceQuery, [
      tenantId,
      TRANSACTION_LIFECYCLE_STATUS.CHECKED_OUT,
      TRANSACTION_PAYMENT_STATUS.PAID
    ]);

    const summary: AdminDashboardSummary = {
      totalSales: parseFloat(totalSales),
      branchPerformance: branchPerformanceRes.rows.map(row => ({
        branch_id: Number(row.branch_id),
        branch_name: String(row.branch_name),
        transaction_count: Number(row.transaction_count),
        total_sales: parseFloat(row.total_sales || '0'),
      })),
    };

    return { success: true, summary };
  } catch (dbError: any) {
    console.error('[getAdminDashboardSummary DB Error]', dbError);
    return { success: false, message: `Database error while fetching dashboard summary: ${dbError.message}` };
  } finally {
    client.release();
  }
}
