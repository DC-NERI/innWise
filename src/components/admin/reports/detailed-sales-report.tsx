
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Loader2, BarChart3, CalendarDays, RefreshCw, Download } from 'lucide-react'; // Added Download icon
import { useToast } from '@/hooks/use-toast';
import { getDetailedSalesReport } from '@/actions/admin/reports/getDetailedSalesReport';
import type { AdminDashboardSummary, PaymentMethodSaleSummary, RateTypeSaleSummary, DailySaleSummary } from '@/lib/types';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, parseISO, isValid } from 'date-fns';
import { BarChart as RechartsBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';


interface DetailedSalesReportProps {
  tenantId: number;
}

export default function DetailedSalesReport({ tenantId }: DetailedSalesReportProps) {
  const [reportData, setReportData] = useState<AdminDashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [startDate, setStartDate] = useState<Date | undefined>(new Date());
  const [endDate, setEndDate] = useState<Date | undefined>(new Date());
  const { toast } = useToast();

  const fetchReport = useCallback(async () => {
    if (!tenantId) {
      setIsLoading(false);
      setReportData(null);
      return;
    }
    setIsLoading(true);
    try {
      const formattedStartDate = startDate ? format(startDate, "yyyy-MM-dd") : undefined;
      const formattedEndDate = endDate ? format(endDate, "yyyy-MM-dd") : undefined;

      const result = await getDetailedSalesReport(tenantId, formattedStartDate, formattedEndDate);
      if (result.success && result.summary) {
        setReportData(result.summary);
      } else {
        toast({ title: "Error", description: result.message || "Could not fetch sales report.", variant: "destructive" });
        setReportData(null);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred.";
      toast({ title: "Error Fetching Report", description: errorMessage, variant: "destructive" });
      setReportData(null);
    } finally {
      setIsLoading(false);
    }
  }, [tenantId, startDate, endDate, toast]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]); // Removed startDate, endDate from deps to rely on Apply button

  const handleSetToday = () => {
    const today = new Date();
    setStartDate(today);
    setEndDate(today);
  };

  const handleSetThisWeek = () => {
    const today = new Date();
    setStartDate(startOfWeek(today, { weekStartsOn: 1 }));
    setEndDate(endOfWeek(today, { weekStartsOn: 1 }));
  };

  const handleSetThisMonth = () => {
    const today = new Date();
    setStartDate(startOfMonth(today));
    setEndDate(endOfMonth(today));
  };
  
  const chartData = useMemo(() => {
    return reportData?.dailySales
      ?.filter(item => item.sale_date && typeof item.sale_date === 'string') 
      .map(item => {
        try {
          const date = parseISO(item.sale_date); 
          if (!isValid(date)) {
            console.warn(`Invalid date string encountered in dailySales: ${item.sale_date}`);
            return null; 
          }
          return {
            name: format(date, 'MMM dd'),
            Sales: item.total_sales,
          };
        } catch (e) {
          console.error(`Error parsing date string: ${item.sale_date}`, e);
          return null;
        }
      })
      .filter(item => item !== null) || []; 
  }, [reportData?.dailySales]);

  const handleExportData = () => {
    if (!reportData) {
      toast({
        title: "No Data",
        description: "No data available to export. Please apply a date range first.",
        variant: "default",
      });
      return;
    }
    // Placeholder for actual export logic
    console.log("Exporting data:", reportData);
    toast({
      title: "Export Started (Placeholder)",
      description: "Data export functionality is not yet fully implemented. Data logged to console.",
      variant: "default",
    });
    // Example: Convert to CSV and download (requires a library like 'papaparse' or custom logic)
    // For simplicity, we'll just log for now.
  };


  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            <CardTitle>Detailed Sales Report</CardTitle>
          </div>
          <CardDescription>View sales data by various metrics. Select a date range and click 'Apply' to update.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between p-4 border bg-muted/50 rounded-lg">
            <div className="flex flex-col sm:flex-row gap-2 items-center w-full sm:w-auto">
              <DatePicker date={startDate} setDate={setStartDate} placeholder="Start Date" className="w-full sm:w-auto" />
              <span className="text-muted-foreground hidden sm:inline">-</span>
              <DatePicker date={endDate} setDate={setEndDate} placeholder="End Date" className="w-full sm:w-auto" />
            </div>
            <div className="flex flex-wrap gap-2 w-full sm:w-auto">
              <Button onClick={handleSetToday} variant="outline" size="sm" className="flex-1 sm:flex-initial">Today</Button>
              <Button onClick={handleSetThisWeek} variant="outline" size="sm" className="flex-1 sm:flex-initial">This Week</Button>
              <Button onClick={handleSetThisMonth} variant="outline" size="sm" className="flex-1 sm:flex-initial">This Month</Button>
              <Button onClick={fetchReport} variant="default" size="sm" className="flex-1 sm:flex-initial" disabled={isLoading}>
                <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin':''}`} /> Apply
              </Button>
              <Button onClick={handleExportData} variant="outline" size="sm" className="flex-1 sm:flex-initial" disabled={isLoading || !reportData}>
                <Download className="mr-2 h-4 w-4" /> Export Data
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex justify-center items-center h-64">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
      ) : !reportData ? (
        <Card><CardContent><p className="text-muted-foreground text-center py-8">No report data available for the selected period. Please select a date range and click 'Apply'.</p></CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Sales by Payment Method</CardTitle>
              <CardDescription>Total sales and transaction count per payment method.</CardDescription>
            </CardHeader>
            <CardContent>
              {(reportData.salesByPaymentMethod && reportData.salesByPaymentMethod.length > 0) ? (
                <Table>
                  <TableHeader><TableRow><TableHead>Payment Method</TableHead><TableHead className="text-right">Total Sales</TableHead><TableHead className="text-right">Tx Count</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {reportData.salesByPaymentMethod.map((item) => (
                      <TableRow key={item.payment_method}>
                        <TableCell className="font-medium">{item.payment_method}</TableCell>
                        <TableCell className="text-right">₱{item.total_sales.toFixed(2)}</TableCell>
                        <TableCell className="text-right">{item.transaction_count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : <p className="text-muted-foreground">No sales data by payment method for the selected period.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sales by Rate Type</CardTitle>
              <CardDescription>Total sales and transaction count per rate type.</CardDescription>
            </CardHeader>
            <CardContent>
              {(reportData.salesByRateType && reportData.salesByRateType.length > 0) ? (
                <Table>
                  <TableHeader><TableRow><TableHead>Rate Name</TableHead><TableHead className="text-right">Total Sales</TableHead><TableHead className="text-right">Tx Count</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {reportData.salesByRateType.map((item) => (
                      <TableRow key={item.rate_id || item.rate_name}>
                        <TableCell className="font-medium">{item.rate_name}</TableCell>
                        <TableCell className="text-right">₱{item.total_sales.toFixed(2)}</TableCell>
                        <TableCell className="text-right">{item.transaction_count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : <p className="text-muted-foreground">No sales data by rate type for the selected period.</p>}
            </CardContent>
          </Card>
          
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Daily Sales Trend</CardTitle>
              <CardDescription>Total sales per day within the selected period.</CardDescription>
            </CardHeader>
            <CardContent className="h-[350px]">
                {(chartData && chartData.length > 0) ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <RechartsBarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip formatter={(value: number) => `₱${value.toFixed(2)}`} />
                        <Legend />
                        <Bar dataKey="Sales" fill="hsl(var(--primary))" />
                        </RechartsBarChart>
                    </ResponsiveContainer>
                ) : <p className="text-muted-foreground text-center py-8">No daily sales data to display chart for the selected period.</p>}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
