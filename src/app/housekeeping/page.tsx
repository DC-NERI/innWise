
"use client";

import type { NextPage } from 'next';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarInset, SidebarFooter, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { LogOut, PanelLeft, Wrench } from 'lucide-react';
import type { UserRole } from '@/lib/types';
import { format as formatDateTime, toZonedTime } from 'date-fns-tz';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import RoomCleaningDashboard from '@/components/housekeeping/room-cleaning-dashboard';


const HousekeepingDashboardPage: NextPage = () => {
  const [activeView, setActiveView] = useState<'cleaning-dashboard'>('cleaning-dashboard');
  const [dateTimeDisplay, setDateTimeDisplay] = useState<string>('Loading date and time...');

  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [tenantId, setTenantId] = useState<number | null>(null);
  const [tenantName, setTenantName] = useState<string>("Loading Tenant...");
  const [username, setUsername] = useState<string | null>(null);
  const [firstName, setFirstName] = useState<string | null>(null);
  const [lastName, setLastName] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<number | null>(null);
  const [branchName, setBranchName] = useState<string | null>(null);
  const [userId, setUserId] = useState<number | null>(null);

  const router = useRouter();
  const manilaTimeZone = 'Asia/Manila';

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedRole = localStorage.getItem('userRole') as UserRole | null;
      const storedTenantId = localStorage.getItem('userTenantId');
      const storedTenantName = localStorage.getItem('userTenantName');
      const storedUsername = localStorage.getItem('username');
      const storedFirstName = localStorage.getItem('userFirstName');
      const storedLastName = localStorage.getItem('userLastName');
      const storedBranchId = localStorage.getItem('userTenantBranchId');
      const storedBranchName = localStorage.getItem('userBranchName');
      const storedUserId = localStorage.getItem('userId');

      if (storedRole) {
        setUserRole(storedRole);
        if (storedRole !== 'housekeeping') {
            router.push('/'); 
            return;
        }
      } else {
        router.push('/'); 
        return;
      }

      if (storedTenantId) setTenantId(parseInt(storedTenantId, 10));
      if (storedTenantName) setTenantName(storedTenantName);
      if (storedUsername) setUsername(storedUsername);
      if (storedFirstName) setFirstName(storedFirstName);
      if (storedLastName) setLastName(storedLastName);
      if (storedBranchId) setBranchId(parseInt(storedBranchId, 10));
      if (storedBranchName) setBranchName(storedBranchName);
       if (storedUserId && !isNaN(parseInt(storedUserId, 10))) {
        const parsedUserId = parseInt(storedUserId, 10);
        if (parsedUserId > 0) setUserId(parsedUserId);
        else setUserId(null);
      } else {
        setUserId(null);
      }
    }

    const intervalId = setInterval(() => {
      const now = new Date();
      const nowInManila = toZonedTime(now, manilaTimeZone);
      setDateTimeDisplay(formatDateTime(nowInManila, 'yyyy-MM-dd hh:mm:ss aa'));
    }, 1000);
    return () => clearInterval(intervalId);
  }, [router]);

  const handleLogout = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('userRole');
      localStorage.removeItem('userTenantId');
      localStorage.removeItem('userTenantName');
      localStorage.removeItem('username');
      localStorage.removeItem('userFirstName');
      localStorage.removeItem('userLastName');
      localStorage.removeItem('userTenantBranchId');
      localStorage.removeItem('userBranchName');
      localStorage.removeItem('userId');
    }
    router.push('/');
  };

  const displayName = firstName || lastName ? `${firstName || ''} ${lastName || ''}`.trim() : username;

  return (
    <SidebarProvider defaultOpen>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="p-[3px] border-b border-sidebar-border flex flex-col space-y-1 text-center sm:text-left">
            <h2 className="text-lg font-semibold text-sidebar-foreground truncate" title={tenantName}>
              {tenantName}
            </h2>
            {displayName && (
              <p className="text-sm text-sidebar-foreground truncate" title={displayName}>
                {displayName}
              </p>
            )}
            {userRole && (
              <p className="text-xs text-sidebar-foreground/80 uppercase tracking-wider" title={`Role: ${userRole}`}>
                {userRole}
              </p>
            )}
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
             <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setActiveView('cleaning-dashboard')}
                isActive={activeView === 'cleaning-dashboard'}
                tooltip="Cleaning Dashboard"
              >
                <Wrench />
                <span>Cleaning Status</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex justify-between items-center p-4 border-b bg-card text-card-foreground shadow-sm">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="md:hidden" aria-label="Toggle Sidebar">
                <PanelLeft />
            </SidebarTrigger>
             <SidebarTrigger className="hidden md:flex" aria-label="Toggle Sidebar">
                <PanelLeft />
            </SidebarTrigger>
            <div className="text-sm font-bold text-foreground">
              {branchName && <span className="mr-2">{branchName} -</span>}
              {dateTimeDisplay}
            </div>
          </div>
           <Button variant="outline" size="sm" onClick={handleLogout}>
             <LogOut className="mr-2 h-4 w-4" /> Logout
           </Button>
        </header>
        <main className="p-4 lg:p-6">
          {activeView === 'cleaning-dashboard' && tenantId && branchId && userId && (
            <RoomCleaningDashboard tenantId={tenantId} branchId={branchId} staffUserId={userId} />
          )}
          {activeView === 'cleaning-dashboard' && (!tenantId || !branchId || !userId) && (
             <Card>
              <CardHeader>
                <div className="flex items-center space-x-2">
                  <Wrench className="h-6 w-6 text-primary" />
                  <CardTitle>Cleaning Dashboard</CardTitle>
                </div>
                 <CardDescription>Manage and view room cleaning statuses.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Required information (Tenant, Branch, or User ID) not available. Please ensure you are properly logged in and assigned.
                </p>
              </CardContent>
            </Card>
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
};

export default HousekeepingDashboardPage;
