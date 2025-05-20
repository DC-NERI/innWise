
"use client";

import type { NextPage } from 'next';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarInset, SidebarFooter } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Settings, LogOut, BedDouble, Building, CalendarPlus } from 'lucide-react';
import { getTenantDetails } from '@/actions/admin';
import type { UserRole } from '@/lib/types';
import RoomStatusContent from '@/components/staff/room-status-content';
import ReservationsContent from '@/components/staff/reservations-content';

const StaffSettingsContent = () => (
  <div>
    <h2 className="text-2xl font-semibold">Settings</h2>
    <p className="text-muted-foreground">Staff-specific settings will be managed here.</p>
  </div>
);


const StaffDashboardPage: NextPage = () => {
  const [activeView, setActiveView] = useState<'room-status' | 'reservations' | 'settings'>('room-status');
  const [dateTime, setDateTime] = useState({ date: '', time: '' });

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

  useEffect(() => {
    console.log("[staff/page.tsx] useEffect running to retrieve localStorage data");
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

      console.log("[staff/page.tsx] Retrieved from localStorage:", {
        storedRole, storedTenantId, storedTenantName, storedUsername, storedFirstName, storedLastName, storedBranchId, storedBranchName, storedUserId
      });

      if (storedRole) {
        setUserRole(storedRole);
        if (storedRole !== 'staff') {
            console.warn("[staff/page.tsx] Role is not staff, redirecting to /");
            router.push('/');
            return;
        }
      } else {
        console.warn("[staff/page.tsx] No role found, redirecting to /");
        router.push('/');
        return;
      }

      if (storedTenantId) setTenantId(parseInt(storedTenantId, 10));
      if (storedUsername) setUsername(storedUsername);
      if (storedFirstName) setFirstName(storedFirstName);
      if (storedLastName) setLastName(storedLastName);
      if (storedBranchId) setBranchId(parseInt(storedBranchId, 10));
      if (storedBranchName) setBranchName(storedBranchName);

      if (storedUserId && !isNaN(parseInt(storedUserId, 10))) {
        const parsedUserId = parseInt(storedUserId, 10);
        if (parsedUserId > 0) {
          setUserId(parsedUserId);
          console.log("[staff/page.tsx] Set userId from localStorage:", parsedUserId);
        } else {
          console.warn("[staff/page.tsx] Parsed userId from localStorage is not a positive number:", parsedUserId);
        }
      } else {
        console.warn("[staff/page.tsx] userId not found or invalid in localStorage:", storedUserId);
      }


      if (storedTenantName) {
        setTenantName(storedTenantName);
      } else if (storedTenantId) {
        getTenantDetails(parseInt(storedTenantId, 10)).then(tenant => {
          if (tenant) {
            setTenantName(tenant.tenant_name);
            if (typeof window !== 'undefined') {
                localStorage.setItem('userTenantName', tenant.tenant_name);
            }
          } else {
            setTenantName("Tenant Not Found");
          }
        }).catch(error => {
          console.error("Failed to fetch tenant details on mount:", error);
          setTenantName("Error Fetching Tenant Info");
        });
      } else {
        setTenantName("Tenant Information Unavailable");
      }
    }

    const intervalId = setInterval(() => {
      const now = new Date();
      const optionsDate: Intl.DateTimeFormatOptions = {
        year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Manila'
      };
      const optionsTime: Intl.DateTimeFormatOptions = {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Asia/Manila'
      };
      setDateTime({
        date: now.toLocaleDateString('en-US', optionsDate),
        time: now.toLocaleTimeString('en-US', optionsTime),
      });
    }, 1000);
    return () => clearInterval(intervalId);
  }, [router]);

  const handleLogout = () => {
    if (typeof window !== 'undefined') {
      console.log("[staff/page.tsx] Logging out, clearing localStorage");
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
      <Sidebar>
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
                onClick={() => setActiveView('room-status')}
                isActive={activeView === 'room-status'}
                className="justify-start"
              >
                <BedDouble className="h-5 w-5" />
                Room Status
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setActiveView('reservations')}
                isActive={activeView === 'reservations'}
                className="justify-start"
              >
                <CalendarPlus className="h-5 w-5" />
                Reservations
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter>
          <div className="p-2 border-t border-sidebar-border">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => setActiveView('settings')}
                  isActive={activeView === 'settings'}
                  className="justify-start"
                >
                  <Settings className="h-5 w-5" />
                   Settings
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex justify-between items-center p-4 border-b bg-card text-card-foreground shadow-sm">
          <div className="text-sm font-bold text-foreground">
            {branchName && <span className="mr-2">{branchName} -</span>}
            {dateTime.date && dateTime.time ? `${dateTime.date} - ${dateTime.time}` : 'Loading date and time...'}
          </div>
           <Button variant="outline" size="sm" onClick={handleLogout}>
             <LogOut className="mr-2 h-4 w-4" /> Logout
           </Button>
        </header>
        <main className="p-4 lg:p-6">
          {activeView === 'room-status' && tenantId && branchId && (
            <RoomStatusContent tenantId={tenantId} branchId={branchId} staffUserId={userId} />
          )}
          {activeView === 'reservations' && tenantId && branchId && userId && (
            <ReservationsContent tenantId={tenantId} branchId={branchId} staffUserId={userId} />
          )}
          {(activeView === 'room-status' || activeView === 'reservations') && (!tenantId || !branchId) && (
             <Card>
              <CardHeader>
                <div className="flex items-center space-x-2">
                  <Building className="h-6 w-6 text-primary" />
                  <CardTitle>{activeView === 'room-status' ? 'Room Status' : 'Reservations'}</CardTitle>
                </div>
                 <CardDescription>Manage room availability or reservations.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Branch information not available. Please ensure you are assigned to a branch.
                </p>
              </CardContent>
            </Card>
          )}
          {activeView === 'settings' && <StaffSettingsContent />}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
};

export default StaffDashboardPage;
