
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, DollarSign, ListChecks, Building } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getAdminDashboardSummary } from '@/actions/admin/dashboard/getAdminDashboardSummary'; // New action path
import type { AdminDashboardSummary } from '@/lib/types'; // New type

interface DashboardAdminContentProps {
  tenantId: number;
}

export default function DashboardAdminContent({ tenantId }: DashboardAdminContentProps) {
  const [summary, setSummary] = useState<AdminDashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const fetchSummary = useCallback(async () => {
    if (!tenantId) {
      setIsLoading(false);
      setSummary(null);
      return;
    }
    setIsLoading(true);
    try {
      const result = await getAdminDashboardSummary(tenantId);
      if (result.success && result.summary) {
        setSummary(result.summary);
      } else {
        toast({ title: "Error", description: result.message || "Could not fetch dashboard summary.", variant: "destructive" });
        setSummary(null);
      }
    } catch (error) {
      toast({ title: "Error", description: "An unexpected error occurred while fetching dashboard summary.", variant: "destructive" });
      setSummary(null);
    } finally {
      setIsLoading(false);
    }
  }, [tenantId, toast]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">Loading dashboard data...</p>
      </div>
    );
  }

  if (!summary) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <LayoutDashboard className="h-6 w-6 text-primary" />
            <CardTitle>Admin Dashboard</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">No summary data available or failed to load.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <DollarSign className="h-6 w-6 text-primary" />
            <CardTitle>Total Sales Overview</CardTitle>
          </div>
          <CardDescription>Total sales for your tenant.</CardDescription>
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
          <CardDescription>Sales and transaction counts per branch.</CardDescription>
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
            <p className="text-muted-foreground">No branch performance data available.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
