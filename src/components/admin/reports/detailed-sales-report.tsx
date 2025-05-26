
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Loader2, BarChart3, CalendarDays, RefreshCw, Download, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getDetailedSalesReport } from '@/actions/admin/reports/getDetailedSalesReport';
import type { AdminDashboardSummary, PaymentMethodSaleSummary, RateTypeSaleSummary, DailySaleSummary, Transaction } from '@/lib/types';
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
    if (tenantId) {
        fetchReport();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

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
            return null; 
          }
          return {
            name: format(date, 'MMM dd'),
            Sales: item.total_sales,
          };
        } catch (e) {
          return null;
        }
      })
      .filter(item => item !== null) as { name: string; Sales: number }[] || []; 
  }, [reportData?.dailySales]);

  const escapeCSVField = (field: any): string => {
    if (field == null) {
        return '';
    }
    const stringField = String(field);
    if (stringField.includes(',') || stringField.includes('"') || stringField.includes('\n') || stringField.includes('\r')) {
        return `"${stringField.replace(/"/g, '""')}"`;
    }
    return stringField;
  };

  const convertArrayToCSV = (data: any[], headers: string[], keys: string[]): string => {
    let csvString = headers.map(header => escapeCSVField(header)).join(',') + '\r\n';
    data.forEach(row => {
        csvString += keys.map(key => escapeCSVField(row[key])).join(',') + '\r\n';
    });
    return csvString;
  };

  const handleExportData = () => {
    if (!reportData) {
      toast({
        title: "No Data",
        description: "No data available to export. Please apply a date range first.",
        variant: "default",
      });
      return;
    }

    let csvContent = "Detailed Sales Report\r\n";
    const sDate = startDate ? format(startDate, "yyyy-MM-dd") : "N/A";
    const eDate = endDate ? format(endDate, "yyyy-MM-dd") : "N/A";
    csvContent += `Date Range: ${sDate} - ${eDate}\r\n\r\n`;

    csvContent += `Overall Total Sales: ${escapeCSVField(reportData.totalSales?.toFixed(2) || '0.00')}\r\n\r\n`;

    // Branch Performance (if this data source is still desired, or taken from AdminDashboardSummary)
    // For now, assuming it's part of the main reportData structure if needed.
    // If it's fetched separately or not part of detailedSalesReport, this section might need adjustment.

    if (reportData.salesByPaymentMethod && reportData.salesByPaymentMethod.length > 0) {
        csvContent += "Sales By Payment Method\r\n";
        csvContent += convertArrayToCSV(
            reportData.salesByPaymentMethod,
            ["Payment Method", "Total Sales (PHP)", "Transaction Count"],
            ["payment_method", "total_sales", "transaction_count"]
        );
        csvContent += "\r\n";
    }

    if (reportData.salesByRateType && reportData.salesByRateType.length > 0) {
        csvContent += "Sales By Rate Type\r\n";
        csvContent += convertArrayToCSV(
            reportData.salesByRateType,
            ["Rate Name", "Total Sales (PHP)", "Transaction Count"],
            ["rate_name", "total_sales", "transaction_count"]
        );
        csvContent += "\r\n";
    }

    if (reportData.dailySales && reportData.dailySales.length > 0) {
        csvContent += "Daily Sales\r\n";
        csvContent += convertArrayToCSV(
            reportData.dailySales,
            ["Date", "Total Sales (PHP)", "Transaction Count"],
            ["sale_date", "total_sales", "transaction_count"]
        );
        csvContent += "\r\n";
    }

    if (reportData.detailedTransactions && reportData.detailedTransactions.length > 0) {
      csvContent += "Detailed Transactions\r\n";
      csvContent += convertArrayToCSV(
          reportData.detailedTransactions,
          ["Tx ID", "Branch", "Check-out", "Client", "Room", "Rate", "Amount (PHP)", "Payment Method", "Staff"],
          ["id", "branch_name", "check_out_time", "client_name", "room_name", "rate_name", "total_amount", "client_payment_method", "checked_out_by_username"]
      );
      csvContent += "\r\n";
    }


    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' }); // Added BOM for Excel
    const link = document.createElement("a");
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        const reportDate = startDate ? format(startDate, "yyyyMMdd") : "report";
        const reportEndDate = endDate && endDate !== startDate ? `_to_${format(endDate, "yyyyMMdd")}` : "";
        link.setAttribute("href", url);
        link.setAttribute("download", `detailed_sales_report_${reportDate}${reportEndDate}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast({
          title: "Export Successful",
          description: "The sales report has been downloaded as a CSV file.",
        });
    } else {
        toast({
            title: "Export Failed",
            description: "Your browser does not support this type of download.",
            variant: "destructive",
        });
    }
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
              <DatePicker date={startDate} setDate={setStartDate} placeholder="Start Date" className="w-full sm:w-auto" buttonSize="sm" />
              <span className="text-muted-foreground hidden sm:inline">-</span>
              <DatePicker date={endDate} setDate={setEndDate} placeholder="End Date" className="w-full sm:w-auto" buttonSize="sm" />
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
                  <TableHeader><TableRow><TableHead>Payment Method</TableHead><TableHead className="text-right">Total Sales (PHP)</TableHead><TableHead className="text-right">Tx Count</TableHead></TableRow></TableHeader>
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
                  <TableHeader><TableRow><TableHead>Rate Name</TableHead><TableHead className="text-right">Total Sales (PHP)</TableHead><TableHead className="text-right">Tx Count</TableHead></TableRow></TableHeader>
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
                        <YAxis tickFormatter={(value) => `₱${value}`} />
                        <Tooltip formatter={(value: number) => `₱${value.toFixed(2)}`} />
                        <Legend />
                        <Bar dataKey="Sales" fill="hsl(var(--primary))" />
                        </RechartsBarChart>
                    </ResponsiveContainer>
                ) : <p className="text-muted-foreground text-center py-8">No daily sales data to display chart for the selected period.</p>}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
               <div className="flex items-center space-x-2">
                  <FileText className="h-5 w-5 text-primary" />
                  <CardTitle>Detailed Transactions</CardTitle>
                </div>
              <CardDescription>All completed and paid transactions within the selected date range.</CardDescription>
            </CardHeader>
            <CardContent>
              {(reportData.detailedTransactions && reportData.detailedTransactions.length > 0) ? (
                <div className="max-h-[500px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tx ID</TableHead>
                        <TableHead>Branch</TableHead>
                        <TableHead>Check-out</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead>Room</TableHead>
                        <TableHead>Rate</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Payment</TableHead>
                        <TableHead>Staff</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reportData.detailedTransactions.map((tx) => (
                        <TableRow key={tx.id}>
                          <TableCell>{tx.id}</TableCell>
                          <TableCell>{tx.branch_name || 'N/A'}</TableCell>
                          <TableCell>{tx.check_out_time ? format(parseISO(tx.check_out_time), 'yyyy-MM-dd HH:mm') : 'N/A'}</TableCell>
                          <TableCell>{tx.client_name}</TableCell>
                          <TableCell>{tx.room_name || 'N/A'}</TableCell>
                          <TableCell>{tx.rate_name || 'N/A'}</TableCell>
                          <TableCell className="text-right">₱{tx.total_amount?.toFixed(2) || '0.00'}</TableCell>
                          <TableCell>{tx.client_payment_method || 'N/A'}</TableCell>
                          <TableCell>{tx.checked_out_by_username || 'N/A'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : <p className="text-muted-foreground">No detailed transaction data for the selected period.</p>}
            </CardContent>
          </Card>

        </div>
      )}
    </div>
  );
}
