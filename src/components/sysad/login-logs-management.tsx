
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Loader2, History, ChevronLeft, ChevronRight, Filter, XCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { listLoginAttempts } from '@/actions/sysad/logs/listLoginAttempts';
import type { LoginLog } from '@/lib/types';
import { LOGIN_LOG_STATUS_TEXT } from '@/lib/constants';
import { format, parseISO } from 'date-fns';

const ITEMS_PER_PAGE = 10;

export default function LoginLogsManagement() {
  const [logs, setLogs] = useState<LoginLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  
  const [usernameFilter, setUsernameFilter] = useState("");
  const [startDateFilter, setStartDateFilter] = useState<Date | undefined>(undefined);
  const [endDateFilter, setEndDateFilter] = useState<Date | undefined>(undefined);
  
  const { toast } = useToast();

  const fetchLoginLogs = useCallback(async (page: number) => {
    setIsLoading(true);
    try {
      const formattedStartDate = startDateFilter ? format(startDateFilter, "yyyy-MM-dd") : undefined;
      const formattedEndDate = endDateFilter ? format(endDateFilter, "yyyy-MM-dd") : undefined;
      
      const result = await listLoginAttempts(page, ITEMS_PER_PAGE, usernameFilter, formattedStartDate, formattedEndDate);
      if (result.success && result.logs) {
        setLogs(result.logs);
        setTotalCount(result.totalCount || 0);
      } else {
        toast({ title: "Error", description: result.message || "Could not fetch login logs.", variant: "destructive" });
        setLogs([]);
        setTotalCount(0);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred.";
      toast({ title: "Error Fetching Logs", description: errorMessage, variant: "destructive" });
      setLogs([]);
      setTotalCount(0);
    } finally {
      setIsLoading(false);
    }
  }, [toast, usernameFilter, startDateFilter, endDateFilter]);

  useEffect(() => {
    fetchLoginLogs(currentPage);
  }, [fetchLoginLogs, currentPage]);

  const handleApplyFilters = () => {
    setCurrentPage(1); // Reset to first page when applying new filters
    fetchLoginLogs(1);
  };

  const handleClearFilters = () => {
    setUsernameFilter("");
    setStartDateFilter(undefined);
    setEndDateFilter(undefined);
    setCurrentPage(1);
    // Fetch logs with cleared filters (useEffect will trigger this if we directly call fetchLoginLogs without arguments)
    // To be explicit, we can call it:
    // setIsLoading(true); listLoginAttempts(1, ITEMS_PER_PAGE).then(res => {...})
    // but relying on useEffect after state change is cleaner
  };
   // Re-fetch when filters are cleared and component re-renders
   useEffect(() => {
    if (!usernameFilter && !startDateFilter && !endDateFilter) {
        fetchLoginLogs(1);
    }
   }, [usernameFilter, startDateFilter, endDateFilter, fetchLoginLogs]);


  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  const handlePreviousPage = () => {
    setCurrentPage(prev => Math.max(1, prev - 1));
  };

  const handleNextPage = () => {
    setCurrentPage(prev => Math.min(totalPages, prev + 1));
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center space-x-2">
          <History className="h-6 w-6 text-primary" />
          <CardTitle>System Login Attempts</CardTitle>
        </div>
        <CardDescription>Review all login attempts made to the system. Filter by username and date range.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-6 p-4 border rounded-lg bg-muted/50">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
            <div className="space-y-1">
              <label htmlFor="usernameFilter" className="text-sm font-medium">Username</label>
              <Input
                id="usernameFilter"
                placeholder="Filter by username..."
                value={usernameFilter}
                onChange={(e) => setUsernameFilter(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="startDateFilter" className="text-sm font-medium">Start Date</label>
              <DatePicker date={startDateFilter} setDate={setStartDateFilter} placeholder="Start date" />
            </div>
            <div className="space-y-1">
              <label htmlFor="endDateFilter" className="text-sm font-medium">End Date</label>
              <DatePicker date={endDateFilter} setDate={setEndDateFilter} placeholder="End date" />
            </div>
            <div className="flex items-end space-x-2">
              <Button onClick={handleApplyFilters} size="sm" className="flex-1">
                <Filter className="mr-2 h-4 w-4" /> Apply Filters
              </Button>
              <Button onClick={handleClearFilters} variant="outline" size="sm" className="flex-1">
                <XCircle className="mr-2 h-4 w-4" /> Clear
              </Button>
            </div>
          </div>
        </div>

        {isLoading && logs.length === 0 ? (
          <div className="flex justify-center items-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-2 text-muted-foreground">Loading login logs...</p>
          </div>
        ) : !isLoading && logs.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No login attempts found matching your criteria.</p>
        ) : (
          <>
            <div className="max-h-[60vh] overflow-y-auto border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>User ID</TableHead>
                    <TableHead>Username</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>IP Address</TableHead>
                    <TableHead className="min-w-[200px]">User Agent</TableHead>
                    <TableHead className="min-w-[250px]">Error Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map(log => (
                    <TableRow key={log.id}>
                      <TableCell className="whitespace-nowrap">{log.login_time ? format(parseISO(log.login_time), 'yyyy-MM-dd HH:mm:ss xxx') : 'N/A'}</TableCell>
                      <TableCell>{log.user_id || 'N/A'}</TableCell>
                      <TableCell>{log.username || (log.user_id ? `User ID: ${log.user_id}`: 'N/A')}</TableCell>
                      <TableCell>
                        <span className={log.status === 1 ? 'text-green-600' : 'text-red-600'}>
                          {LOGIN_LOG_STATUS_TEXT[log.status as keyof typeof LOGIN_LOG_STATUS_TEXT] || 'Unknown'}
                        </span>
                      </TableCell>
                      <TableCell>{log.ip_address || '-'}</TableCell>
                      <TableCell className="truncate max-w-xs" title={log.user_agent || undefined}>{log.user_agent || '-'}</TableCell>
                      <TableCell className="truncate max-w-md" title={log.error_details || undefined}>{log.error_details || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-end space-x-2 py-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePreviousPage}
                  disabled={currentPage === 1 || isLoading}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {currentPage} of {totalPages} ({totalCount} logs)
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleNextPage}
                  disabled={currentPage === totalPages || isLoading}
                >
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
    