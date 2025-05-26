
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from '@/components/ui/button'; // Added Button
import { Loader2, Building2, Network, Users as UsersIcon, History, RefreshCw } from 'lucide-react'; // Added RefreshCw
import { useToast } from '@/hooks/use-toast';
import { getSystemOverviewData } from '@/actions/sysad/dashboard/getSystemOverviewData';
import { listLoginAttempts } from '@/actions/sysad/logs/listLoginAttempts';
import type { SystemOverviewData, LoginLog } from '@/lib/types';
import { LOGIN_LOG_STATUS_TEXT } from '@/lib/constants';
import { format, parseISO } from 'date-fns';

const RECENT_LOGS_LIMIT = 5;

export default function SysAdDashboardContent() {
  const [overviewData, setOverviewData] = useState<SystemOverviewData | null>(null);
  const [recentLoginLogs, setRecentLoginLogs] = useState<LoginLog[]>([]);
  const [isLoadingOverview, setIsLoadingOverview] = useState(true);
  const [isLoadingRecentLogs, setIsLoadingRecentLogs] = useState(true);
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

  const fetchRecentLogs = useCallback(async () => {
    setIsLoadingRecentLogs(true);
    try {
      const logsResult = await listLoginAttempts(1, RECENT_LOGS_LIMIT);
      if (logsResult.success && logsResult.logs) {
        setRecentLoginLogs(logsResult.logs);
      } else {
        toast({ title: "Error Fetching Recent Logs", description: logsResult.message || "Could not fetch recent login logs.", variant: "destructive" });
        setRecentLoginLogs([]);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred.";
      toast({ title: "Error Fetching Recent Logs Data", description: errorMessage, variant: "destructive" });
      setRecentLoginLogs([]);
    } finally {
      setIsLoadingRecentLogs(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchSystemOverview();
    fetchRecentLogs();
  }, [fetchSystemOverview, fetchRecentLogs]);

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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div className="flex items-center space-x-2">
            <History className="h-5 w-5 text-primary" />
            <CardTitle>Recent Login Attempts</CardTitle>
          </div>
          <Button variant="outline" size="sm" onClick={fetchRecentLogs} disabled={isLoadingRecentLogs}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoadingRecentLogs ? 'animate-spin' : ''}`} /> Refresh Logs
          </Button>
        </CardHeader>
        <CardDescription className="px-6 pb-2 text-sm text-muted-foreground">A quick view of the latest login attempts to the system.</CardDescription>
        <CardContent>
          {isLoadingRecentLogs ? (
            <div className="flex justify-center items-center h-32">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="ml-2 text-muted-foreground">Loading recent logs...</p>
            </div>
          ) : recentLoginLogs.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No recent login attempts found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentLoginLogs.map(log => (
                  <TableRow key={log.id}>
                    <TableCell>{log.login_time ? format(parseISO(log.login_time), 'yyyy-MM-dd HH:mm:ss') : 'N/A'}</TableCell>
                    <TableCell>{log.username || (log.user_id ? `User ID: ${log.user_id}`: 'N/A')}</TableCell>
                    <TableCell>
                      <span className={log.status === 1 ? 'text-green-600' : 'text-red-600'}>
                        {LOGIN_LOG_STATUS_TEXT[log.status as keyof typeof LOGIN_LOG_STATUS_TEXT] || 'Unknown'}
                      </span>
                    </TableCell>
                    <TableCell>{log.ip_address || '-'}</TableCell>
                    <TableCell className="truncate max-w-xs" title={log.error_details || undefined}>{log.error_details || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

