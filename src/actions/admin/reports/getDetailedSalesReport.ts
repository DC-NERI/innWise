
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
import type { AdminDashboardSummary, PaymentMethodSaleSummary, RateTypeSaleSummary, DailySaleSummary, Transaction } from '@/lib/types';
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
    let queryParams: any[] = [
        tenantId, 
        TRANSACTION_LIFECYCLE_STATUS.CHECKED_OUT.toString(), 
        TRANSACTION_PAYMENT_STATUS.PAID
    ];
    let dateFilterClause = "";
    let dateParamIndex = queryParams.length + 1; // Start from the next available parameter index

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
        sale_date: String(row.sale_date),
        total_sales: parseFloat(row.total_sales || '0'),
        transaction_count: Number(row.transaction_count || 0),
    }));

    // Query for detailed transactions
    const detailedTransactionsQuery = `
      SELECT
        t.id,
        t.tenant_id,
        t.branch_id,
        tb.branch_name,
        t.hotel_room_id,
        hr_room.room_name,
        t.hotel_rate_id,
        hrt.name as rate_name,
        t.client_name,
        t.client_payment_method,
        t.notes,
        t.check_in_time,
        t.check_out_time,
        t.hours_used,
        t.total_amount,
        t.tender_amount,
        t.is_paid,
        t.created_by_user_id,
        cb_user.username as created_by_username,
        t.check_out_by_user_id,
        co_user.username as checked_out_by_username,
        t.status,
        t.created_at,
        t.updated_at,
        t.reserved_check_in_datetime,
        t.reserved_check_out_datetime,
        t.is_admin_created,
        t.is_accepted
      FROM transactions t
      LEFT JOIN tenant_branch tb ON t.branch_id = tb.id AND t.tenant_id = tb.tenant_id
      LEFT JOIN hotel_room hr_room ON t.hotel_room_id = hr_room.id AND t.tenant_id = hr_room.tenant_id
      LEFT JOIN hotel_rates hrt ON t.hotel_rate_id = hrt.id AND t.tenant_id = hrt.tenant_id
      LEFT JOIN users cb_user ON t.created_by_user_id = cb_user.id
      LEFT JOIN users co_user ON t.check_out_by_user_id = co_user.id
      WHERE t.tenant_id = $1
        AND t.status::INTEGER = $2 -- Checked-out
        AND t.is_paid = $3         -- Paid
        ${dateFilterClause}
      ORDER BY t.check_out_time DESC, t.id DESC;
    `;
    const detailedTransactionsRes = await client.query(detailedTransactionsQuery, queryParams);
    const detailedTransactions: Transaction[] = detailedTransactionsRes.rows.map(row => ({
        id: Number(row.id),
        tenant_id: Number(row.tenant_id),
        branch_id: Number(row.branch_id),
        branch_name: String(row.branch_name),
        hotel_room_id: row.hotel_room_id ? Number(row.hotel_room_id) : null,
        room_name: row.room_name ? String(row.room_name) : null,
        hotel_rate_id: row.hotel_rate_id ? Number(row.hotel_rate_id) : null,
        rate_name: row.rate_name ? String(row.rate_name) : null,
        client_name: String(row.client_name),
        client_payment_method: row.client_payment_method ? String(row.client_payment_method) : null,
        notes: row.notes ? String(row.notes) : null,
        check_in_time: String(row.check_in_time),
        check_out_time: row.check_out_time ? String(row.check_out_time) : null,
        hours_used: row.hours_used ? Number(row.hours_used) : null,
        total_amount: row.total_amount ? parseFloat(row.total_amount) : null,
        tender_amount: row.tender_amount ? parseFloat(row.tender_amount) : null,
        is_paid: Number(row.is_paid),
        created_by_user_id: Number(row.created_by_user_id),
        created_by_username: row.created_by_username ? String(row.created_by_username) : null,
        check_out_by_user_id: row.check_out_by_user_id ? Number(row.check_out_by_user_id) : null,
        checked_out_by_username: row.checked_out_by_username ? String(row.checked_out_by_username) : null,
        status: Number(row.status),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
        reserved_check_in_datetime: row.reserved_check_in_datetime ? String(row.reserved_check_in_datetime) : null,
        reserved_check_out_datetime: row.reserved_check_out_datetime ? String(row.reserved_check_out_datetime) : null,
        is_admin_created: row.is_admin_created !== null ? Number(row.is_admin_created) : null,
        is_accepted: row.is_accepted !== null ? Number(row.is_accepted) : null,
    }));


    const summary: AdminDashboardSummary = {
      totalSales: dailySales.reduce((acc, curr) => acc + curr.total_sales, 0),
      branchPerformance: [], // Existing AdminDashboardSummary action handles branch performance
      salesByPaymentMethod,
      salesByRateType,
      dailySales,
      detailedTransactions,
    };

    return { success: true, summary };
  } catch (dbError: any) {
    console.error('[getDetailedSalesReport DB Error]', dbError);
    return { success: false, message: `Database error while fetching detailed sales report: ${dbError.message}` };
  } finally {
    client.release();
  }
}
