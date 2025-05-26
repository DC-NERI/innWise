
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Loader2, DollarSign, Building, LayoutDashboard, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getAdminDashboardSummary } from '@/actions/admin/dashboard/getAdminDashboardSummary';
import type { AdminDashboardSummary } from '@/lib/types';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';

interface DashboardAdminContentProps {
  tenantId: number;
}

export default function DashboardAdminContent({ tenantId }: DashboardAdminContentProps) {
  const [summary, setSummary] = useState<AdminDashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [startDate, setStartDate] = useState<Date | undefined>(new Date()); // Default to current date
  const [endDate, setEndDate] = useState<Date | undefined>(new Date());   // Default to current date
  const { toast } = useToast();

  const fetchSummary = useCallback(async () => {
    if (!tenantId) {
      setIsLoading(false);
      setSummary(null);
      return;
    }
    setIsLoading(true);
    try {
      const formattedStartDate = startDate ? format(startDate, "yyyy-MM-dd") : undefined;
      const formattedEndDate = endDate ? format(endDate, "yyyy-MM-dd") : undefined;

      const result = await getAdminDashboardSummary(tenantId, formattedStartDate, formattedEndDate);
      if (result.success && result.summary) {
        setSummary(result.summary);
      } else {
        toast({ title: "Error", description: result.message || "Could not fetch dashboard summary.", variant: "destructive" });
        setSummary(null);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred.";
      toast({ title: "Error Fetching Summary", description: errorMessage, variant: "destructive" });
      setSummary(null);
    } finally {
      setIsLoading(false);
    }
  }, [tenantId, startDate, endDate, toast]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

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

  const handleSetToday = () => {
    const today = new Date();
    setStartDate(today);
    setEndDate(today);
  };

  if (!tenantId) {
     return (
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <LayoutDashboard className="h-6 w-6 text-primary" />
            <CardTitle>Admin Dashboard</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Tenant information not available. Cannot load dashboard.</p>
        </CardContent>
      </Card>
    );
  }


  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <LayoutDashboard className="h-6 w-6 text-primary" />
            <CardTitle>Admin Dashboard</CardTitle>
          </div>
          <CardDescription>Overview of sales and branch performance for your tenant.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between p-4 border bg-muted/50 rounded-lg">
            <div className="flex flex-col sm:flex-row gap-2 items-center w-full sm:w-auto">
              <DatePicker date={startDate} setDate={setStartDate} placeholder="Start Date" className="w-full sm:w-auto" />
              <span className="text-muted-foreground hidden sm:inline">-</span>
              <DatePicker date={endDate} setDate={setEndDate} placeholder="End Date" className="w-full sm:w-auto" />
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <Button onClick={handleSetToday} variant="outline" size="sm" className="flex-1 sm:flex-initial">Today</Button>
              <Button onClick={handleSetThisWeek} variant="outline" size="sm" className="flex-1 sm:flex-initial">This Week</Button>
              <Button onClick={handleSetThisMonth} variant="outline" size="sm" className="flex-1 sm:flex-initial">This Month</Button>
              <Button onClick={fetchSummary} variant="outline" size="sm" className="flex-1 sm:flex-initial" disabled={isLoading}>
                <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin':''}`} /> Apply
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {isLoading ? (
         <div className="flex justify-center items-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-2 text-muted-foreground">Loading dashboard data...</p>
        </div>
      ) : !summary ? (
        <Card>
            <CardHeader><CardTitle>No Data</CardTitle></CardHeader>
            <CardContent><p className="text-muted-foreground">No summary data available for the selected period or failed to load.</p></CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-center space-x-2">
                <DollarSign className="h-6 w-6 text-primary" />
                <CardTitle>Total Sales Overview</CardTitle>
              </div>
              <CardDescription>Total sales for your tenant within the selected date range.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-primary">
                ₱{summary.totalSales?.toFixed(2) || '0.00'}
              </p>
              <p className="text-sm text-muted-foreground">
                Based on completed and paid transactions.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center space-x-2">
                <Building className="h-6 w-6 text-primary" />
                <CardTitle>Branch Performance</CardTitle>
              </div>
              <CardDescription>Sales and transaction counts per branch within the selected date range.</CardDescription>
            </CardHeader>
            <CardContent>
              {summary.branchPerformance && summary.branchPerformance.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Branch Name</TableHead>
                      <TableHead className="text-right">Total Sales</TableHead>
                      <TableHead className="text-right">Transaction Count</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.branchPerformance.map(branch => (
                      <TableRow key={branch.branch_id}>
                        <TableCell className="font-medium">{branch.branch_name}</TableCell>
                        <TableCell className="text-right">₱{branch.total_sales?.toFixed(2) || '0.00'}</TableCell>
                        <TableCell className="text-right">{branch.transaction_count || 0}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground">No branch performance data available for the selected period.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
