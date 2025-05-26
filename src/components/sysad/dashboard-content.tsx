
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { Loader2, Building2, Network, Users as UsersIcon, History, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getSystemOverviewData } from '@/actions/sysad/dashboard/getSystemOverviewData';
import type { SystemOverviewData } from '@/lib/types';
import LoginLogsManagement from './login-logs-management'; // Import the full component

export default function SysAdDashboardContent() {
  const [overviewData, setOverviewData] = useState<SystemOverviewData | null>(null);
  const [isLoadingOverview, setIsLoadingOverview] = useState(true);
  const { toast } = useToast();

  const fetchSystemOverview = useCallback(async () => {
    setIsLoadingOverview(true);
    try {
      const overviewResult = await getSystemOverviewData();
      if (overviewResult.success && overviewResult.overview) {
        setOverviewData(overviewResult.overview);
      } else {
        toast({ title: "Error Fetching Overview", description: overviewResult.message || "Could not fetch system overview.", variant: "destructive" });
        setOverviewData(null);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred.";
      toast({ title: "Error Fetching Overview Data", description: errorMessage, variant: "destructive" });
      setOverviewData(null);
    } finally {
      setIsLoadingOverview(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchSystemOverview();
  }, [fetchSystemOverview]);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {isLoadingOverview ? (
          <>
            <Card><CardHeader><CardTitle><Loader2 className="h-5 w-5 animate-spin" /></CardTitle></CardHeader><CardContent><p>Loading tenant data...</p></CardContent></Card>
            <Card><CardHeader><CardTitle><Loader2 className="h-5 w-5 animate-spin" /></CardTitle></CardHeader><CardContent><p>Loading branch data...</p></CardContent></Card>
            <Card><CardHeader><CardTitle><Loader2 className="h-5 w-5 animate-spin" /></CardTitle></CardHeader><CardContent><p>Loading user data...</p></CardContent></Card>
          </>
        ) : overviewData ? (
          <>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Tenants</CardTitle>
                <Building2 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{overviewData.totalActiveTenants}</div>
                <p className="text-xs text-muted-foreground">Currently active tenant accounts</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Branches</CardTitle>
                <Network className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{overviewData.totalActiveBranches}</div>
                <p className="text-xs text-muted-foreground">Total active branches across all tenants</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Users</CardTitle>
                <UsersIcon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {Object.values(overviewData.userCountsByRole).reduce((sum, count) => sum + count, 0)}
                </div>
                <div className="text-xs text-muted-foreground">
                  <p>SysAd: {overviewData.userCountsByRole.sysad}</p>
                  <p>Admin: {overviewData.userCountsByRole.admin}</p>
                  <p>Staff: {overviewData.userCountsByRole.staff}</p>
                  <p>Housekeeping: {overviewData.userCountsByRole.housekeeping}</p>
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card className="md:col-span-3"><CardContent><p className="text-muted-foreground text-center py-8">Could not load system overview data.</p></CardContent></Card>
        )}
      </div>

      {/* Login Logs Management is now directly embedded */}
      <LoginLogsManagement />
    </div>
  );
}
    