
"use server";

import pg from 'pg';
// Configure pg to return numeric types as numbers instead of strings
pg.types.setTypeParser(20, (val) => parseInt(val, 10)); // int8
pg.types.setTypeParser(21, (val) => parseInt(val, 10)); // int2
pg.types.setTypeParser(23, (val) => parseInt(val, 10)); // int4
pg.types.setTypeParser(1700, (val) => parseFloat(val)); // numeric

// Configure pg to return timestamp and date types as strings
pg.types.setTypeParser(1114, (stringValue) => stringValue); // TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1184, (stringValue) => stringValue); // TIMESTAMP WITH TIME ZONE
pg.types.setTypeParser(1082, (stringValue) => stringValue); // DATE

import { Pool } from 'pg';
import type { AdminDashboardSummary, PaymentMethodSaleSummary, RateTypeSaleSummary, DailySaleSummary } from '@/lib/types';
import { TRANSACTION_LIFECYCLE_STATUS, TRANSACTION_PAYMENT_STATUS } from '../../../lib/constants';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client in admin/reports/getDetailedSalesReport action', err);
});

export async function getDetailedSalesReport(
  tenantId: number,
  startDate?: string, // YYYY-MM-DD
  endDate?: string    // YYYY-MM-DD
): Promise<{ success: boolean; message?: string; summary?: AdminDashboardSummary }> {
  if (!tenantId || typeof tenantId !== 'number') {
    return { success: false, message: "Invalid tenant ID." };
  }
  if (typeof TRANSACTION_LIFECYCLE_STATUS?.CHECKED_OUT === 'undefined' || typeof TRANSACTION_PAYMENT_STATUS?.PAID === 'undefined') {
    console.error("[getDetailedSalesReport] CRITICAL: Status constants are undefined.");
    return { success: false, message: "Server configuration error." };
  }

  const client = await pool.connect();
  try {
    let queryParams: any[] = [tenantId, TRANSACTION_LIFECYCLE_STATUS.CHECKED_OUT.toString(), TRANSACTION_PAYMENT_STATUS.PAID.toString()];
    let dateFilterClause = "";
    let dateParamIndex = queryParams.length + 1;

    if (startDate && endDate) {
      dateFilterClause = `AND DATE(t.check_out_time AT TIME ZONE 'Asia/Manila') BETWEEN $${dateParamIndex} AND $${dateParamIndex + 1}`;
      queryParams.push(startDate, endDate);
    } else if (startDate) {
      dateFilterClause = `AND DATE(t.check_out_time AT TIME ZONE 'Asia/Manila') >= $${dateParamIndex}`;
      queryParams.push(startDate);
    } else if (endDate) {
      dateFilterClause = `AND DATE(t.check_out_time AT TIME ZONE 'Asia/Manila') <= $${dateParamIndex}`;
      queryParams.push(endDate);
    }

    // Query for sales by payment method
    const salesByPaymentMethodQuery = `
      SELECT
        COALESCE(t.client_payment_method, 'Unknown') as payment_method,
        SUM(t.total_amount) as total_sales,
        COUNT(t.id) as transaction_count
      FROM transactions t
      WHERE t.tenant_id = $1
        AND t.status::INTEGER = $2
        AND t.is_paid = $3
        ${dateFilterClause}
      GROUP BY COALESCE(t.client_payment_method, 'Unknown')
      ORDER BY total_sales DESC;
    `;
    const salesByPaymentMethodRes = await client.query(salesByPaymentMethodQuery, queryParams);
    const salesByPaymentMethod: PaymentMethodSaleSummary[] = salesByPaymentMethodRes.rows.map(row => ({
      payment_method: String(row.payment_method),
      total_sales: parseFloat(row.total_sales || '0'),
      transaction_count: Number(row.transaction_count || 0),
    }));

    // Query for sales by rate type
    const salesByRateTypeQuery = `
      SELECT
        t.hotel_rate_id,
        COALESCE(hr.name, 'Unspecified Rate') as rate_name,
        SUM(t.total_amount) as total_sales,
        COUNT(t.id) as transaction_count
      FROM transactions t
      LEFT JOIN hotel_rates hr ON t.hotel_rate_id = hr.id AND hr.tenant_id = t.tenant_id
      WHERE t.tenant_id = $1
        AND t.status::INTEGER = $2
        AND t.is_paid = $3
        ${dateFilterClause}
      GROUP BY t.hotel_rate_id, hr.name
      ORDER BY total_sales DESC;
    `;
    const salesByRateTypeRes = await client.query(salesByRateTypeQuery, queryParams);
    const salesByRateType: RateTypeSaleSummary[] = salesByRateTypeRes.rows.map(row => ({
      rate_id: row.hotel_rate_id ? Number(row.hotel_rate_id) : null,
      rate_name: String(row.rate_name),
      total_sales: parseFloat(row.total_sales || '0'),
      transaction_count: Number(row.transaction_count || 0),
    }));

    // Query for daily sales summary
    const dailySalesQuery = `
        SELECT
            DATE(t.check_out_time AT TIME ZONE 'Asia/Manila') as sale_date,
            SUM(t.total_amount) as total_sales,
            COUNT(t.id) as transaction_count
        FROM transactions t
        WHERE t.tenant_id = $1
            AND t.status::INTEGER = $2
            AND t.is_paid = $3
            ${dateFilterClause}
        GROUP BY DATE(t.check_out_time AT TIME ZONE 'Asia/Manila')
        ORDER BY sale_date ASC;
    `;
    const dailySalesRes = await client.query(dailySalesQuery, queryParams);
    const dailySales: DailySaleSummary[] = dailySalesRes.rows.map(row => ({
        sale_date: String(row.sale_date), // Ensure sale_date is treated as a string
        total_sales: parseFloat(row.total_sales || '0'),
        transaction_count: Number(row.transaction_count || 0),
    }));


    const summary: AdminDashboardSummary = {
      totalSales: dailySales.reduce((acc, curr) => acc + curr.total_sales, 0), // Recalculate total sales from daily for consistency
      branchPerformance: [], // Keep existing branch performance logic from getAdminDashboardSummary if needed, or remove if this is the sole report
      salesByPaymentMethod,
      salesByRateType,
      dailySales,
    };

    return { success: true, summary };
  } catch (dbError: any) {
    console.error('[getDetailedSalesReport DB Error]', dbError);
    return { success: false, message: `Database error while fetching detailed sales report: ${dbError.message}` };
  } finally {
    client.release();
  }
}
