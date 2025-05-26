
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Loader2, History, ChevronLeft, ChevronRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { listLoginAttempts } from '@/actions/sysad/logs/listLoginAttempts';
import type { LoginLog } from '@/lib/types';
import { LOGIN_LOG_STATUS_TEXT } from '@/lib/constants';
import { format, parseISO } from 'date-fns';

const ITEMS_PER_PAGE = 15;

export default function LoginLogsManagement() {
  const [logs, setLogs] = useState<LoginLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const { toast } = useToast();

  const fetchLoginLogs = useCallback(async (page: number) => {
    setIsLoading(true);
    try {
      const result = await listLoginAttempts(page, ITEMS_PER_PAGE);
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
  }, [toast]);

  useEffect(() => {
    fetchLoginLogs(currentPage);
  }, [fetchLoginLogs, currentPage]);

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  const handlePreviousPage = () => {
    setCurrentPage(prev => Math.max(1, prev - 1));
  };

  const handleNextPage = () => {
    setCurrentPage(prev => Math.min(totalPages, prev + 1));
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center space-x-2">
          <History className="h-6 w-6 text-primary" />
          <CardTitle>Login Attempt Logs</CardTitle>
        </div>
        <CardDescription>Review all login attempts made to the system.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && logs.length === 0 ? (
          <div className="flex justify-center items-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-2 text-muted-foreground">Loading login logs...</p>
          </div>
        ) : !isLoading && logs.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No login attempts found.</p>
        ) : (
          <>
            <div className="max-h-[60vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>User ID</TableHead>
                    <TableHead>Username</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>IP Address</TableHead>
                    <TableHead>User Agent</TableHead>
                    <TableHead>Error Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map(log => (
                    <TableRow key={log.id}>
                      <TableCell>{log.login_time ? format(parseISO(log.login_time), 'yyyy-MM-dd HH:mm:ss xxx') : 'N/A'}</TableCell>
                      <TableCell>{log.user_id || 'N/A'}</TableCell>
                      <TableCell>{log.username || (log.user_id ? `User ID: ${log.user_id}` : 'N/A')}</TableCell>
                      <TableCell>
                        <span className={log.status === 1 ? 'text-green-600' : 'text-red-600'}>
                          {LOGIN_LOG_STATUS_TEXT[log.status as keyof typeof LOGIN_LOG_STATUS_TEXT] || 'Unknown'}
                        </span>
                      </TableCell>
                      <TableCell>{log.ip_address || '-'}</TableCell>
                      <TableCell className="truncate max-w-xs" title={log.user_agent || undefined}>{log.user_agent || '-'}</TableCell>
                      <TableCell className="truncate max-w-xs" title={log.error_details || undefined}>{log.error_details || '-'}</TableCell>
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
                  Page {currentPage} of {totalPages}
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
