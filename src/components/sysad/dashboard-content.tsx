
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, Building2, Network, Users as UsersIcon } from 'lucide-react'; // Use UsersIcon alias consistently
import { useToast } from '@/hooks/use-toast';
import { getSystemOverviewData } from '@/actions/sysad/dashboard/getSystemOverviewData';
import type { SystemOverviewData } from '@/lib/types';

export default function SysAdDashboardContent() {
  const [overviewData, setOverviewData] = useState<SystemOverviewData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const fetchOverview = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getSystemOverviewData();
      if (result.success && result.overview) {
        setOverviewData(result.overview);
      } else {
        toast({ title: "Error", description: result.message || "Could not fetch system overview.", variant: "destructive" });
        setOverviewData(null);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred.";
      toast({ title: "Error Fetching Overview", description: errorMessage, variant: "destructive" });
      setOverviewData(null);
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="ml-3 text-muted-foreground">Loading System Overview...</p>
      </div>
    );
  }

  if (!overviewData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>System Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Could not load system overview data.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
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
          <UsersIcon className="h-4 w-4 text-muted-foreground" /> {/* Using UsersIcon alias */}
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
    </div>
  );
}

    