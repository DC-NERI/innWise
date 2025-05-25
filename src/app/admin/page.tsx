
"use client";

import type { NextPage } from 'next';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarInset, SidebarFooter, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Users as UsersIcon, Building, LogOut, PanelLeft, Tags, BedDouble, Bell, Archive as LostAndFoundIcon, LayoutDashboard, BarChart3 } from 'lucide-react';
import UsersContent from '@/components/admin/users-content';
import BranchesContent from '@/components/admin/branches-content';
import RatesContent from '@/components/admin/rates-content';
import RoomsContent from '@/components/admin/rooms-content';
import NotificationsContent from '@/components/admin/notifications-content';
import LostAndFoundAdminContent from '@/components/admin/lost-and-found-admin-content';
import DashboardAdminContent from '@/components/admin/dashboard-admin-content';
import DetailedSalesReport from '@/components/admin/reports/detailed-sales-report';
import { getTenantDetails } from '@/actions/admin/tenants/getTenantDetails';
import type { UserRole } from '@/lib/types';
import { format as formatDateTime, toZonedTime } from 'date-fns-tz';

type AdminActiveView = 'dashboard' | 'reports' | 'users' | 'branches' | 'rates' | 'rooms' | 'notifications' | 'lost-and-found';

const AdminDashboardPage: NextPage = () => {
  const [activeView, setActiveView] = useState<AdminActiveView>('dashboard');
  const [dateTimeDisplay, setDateTimeDisplay] = useState<string>('Loading date and time...');

  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [tenantId, setTenantId] = useState<number | null>(null);
  const [tenantName, setTenantName] = useState<string>("Loading Tenant...");
  const [username, setUsername] = useState<string | null>(null);
  const [firstName, setFirstName] = useState<string | null>(null);
  const [lastName, setLastName] = useState<string | null>(null);
  const [userId, setUserId] = useState<number | null>(null); // For admin's own ID

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
      const storedUserId = localStorage.getItem('userId'); // For admin's own ID

      if (storedRole) {
        setUserRole(storedRole);
        if (storedRole !== 'admin') {
            router.push('/');
            return;
        }
      } else {
        router.push('/');
        return;
      }

      if (storedTenantId) {
        const parsedTenantId = parseInt(storedTenantId, 10);
         if (isNaN(parsedTenantId) || parsedTenantId <= 0) {
          console.error("[AdminDashboardPage] Invalid tenantId found in localStorage:", storedTenantId);
          setTenantId(null);
          setTenantName("Tenant Info Error");
        } else {
          setTenantId(parsedTenantId);
           if (storedTenantName) {
            setTenantName(storedTenantName);
          } else {
            const fetchDetails = async () => {
              try {
                const tenant = await getTenantDetails(parsedTenantId);
                if (tenant) {
                  setTenantName(tenant.tenant_name);
                  if (typeof window !== 'undefined') {
                      localStorage.setItem('userTenantName', tenant.tenant_name);
                  }
                } else {
                  setTenantName("Tenant Not Found");
                }
              } catch (error) {
                 console.error("[AdminDashboardPage] Error fetching tenant details:", error);
                 setTenantName("Error Fetching Tenant Info");
              }
            };
            fetchDetails();
          }
        }
      } else {
         setTenantId(null);
         setTenantName("Tenant Information Unavailable");
         console.error("[AdminDashboardPage] No tenantId found in localStorage.");
      }

      if (storedUsername) setUsername(storedUsername);
      if (storedFirstName) setFirstName(storedFirstName);
      if (storedLastName) setLastName(storedLastName);
      
      if (storedUserId && !isNaN(parseInt(storedUserId, 10))) {
        const parsedUserId = parseInt(storedUserId, 10);
        if (parsedUserId > 0) {
            setUserId(parsedUserId);
        } else {
            setUserId(null);
            console.warn("[AdminDashboardPage] Invalid userId (for admin) found in localStorage:", storedUserId);
        }
      } else {
          setUserId(null);
          console.warn("[AdminDashboardPage] No valid userId (for admin) found in localStorage.");
      }
    }

    const intervalId = setInterval(() => {
      const nowInManila = toZonedTime(new Date(), manilaTimeZone);
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
                onClick={() => setActiveView('dashboard')}
                isActive={activeView === 'dashboard'}
                tooltip="Dashboard"
              >
                <LayoutDashboard />
                <span>Dashboard</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setActiveView('reports')}
                isActive={activeView === 'reports'}
                tooltip="Reports"
              >
                <BarChart3 /> 
                <span>Reports</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setActiveView('users')}
                isActive={activeView === 'users'}
                tooltip="Users"
              >
                <UsersIcon />
                <span>Users</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setActiveView('branches')}
                isActive={activeView === 'branches'}
                tooltip="Branches"
              >
                <Building />
                <span>Branches</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
             <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setActiveView('rates')}
                isActive={activeView === 'rates'}
                tooltip="Rates"
              >
                <Tags />
                <span>Rates</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
             <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setActiveView('rooms')}
                isActive={activeView === 'rooms'}
                tooltip="Rooms"
              >
                <BedDouble />
                <span>Rooms</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setActiveView('notifications')}
                isActive={activeView === 'notifications'}
                tooltip="Notifications"
              >
                <Bell />
                <span>Notifications</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setActiveView('lost-and-found')}
                isActive={activeView === 'lost-and-found'}
                tooltip="Lost & Found"
              >
                <LostAndFoundIcon />
                <span>Lost & Found</span>
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
              {dateTimeDisplay}
            </div>
          </div>
           <Button variant="outline" size="sm" onClick={handleLogout}>
             <LogOut className="mr-2 h-4 w-4" /> Logout
           </Button>
        </header>
        <main className="p-4 lg:p-6">
          {activeView === 'dashboard' && userRole === 'admin' && tenantId !== null && <DashboardAdminContent tenantId={tenantId} />}
          {activeView === 'dashboard' && tenantId === null && <p>Loading tenant information for dashboard...</p>}

          {activeView === 'reports' && userRole === 'admin' && tenantId !== null && <DetailedSalesReport tenantId={tenantId} />}
          {activeView === 'reports' && tenantId === null && <p>Loading tenant information for reports...</p>}

          {activeView === 'users' && userRole === 'admin' && tenantId !== null && userId && userId > 0 && <UsersContent tenantId={tenantId} adminUserId={userId} />}
          {activeView === 'users' && (tenantId === null || !userId || userId <=0) && <p>Loading tenant or user information for user management...</p>}

          {activeView === 'branches' && userRole === 'admin' && tenantId !== null && userId && userId > 0 && <BranchesContent tenantId={tenantId} adminUserId={userId} />}
          {activeView === 'branches' && (tenantId === null || !userId || userId <=0) && <p>Loading tenant information for branch management...</p>}

          {activeView === 'rates' && userRole === 'admin' && tenantId !== null && userId && userId > 0 && <RatesContent tenantId={tenantId} adminUserId={userId} />}
          {activeView === 'rates' && (tenantId === null || !userId || userId <=0) && <p>Loading tenant information for rate management...</p>}

          {activeView === 'rooms' && userRole === 'admin' && tenantId !== null && userId && userId > 0 && <RoomsContent tenantId={tenantId} adminUserId={userId} />}
          {activeView === 'rooms' && (tenantId === null || !userId || userId <=0) && <p>Loading tenant information for room management...</p>}

          {activeView === 'notifications' && userRole === 'admin' && tenantId !== null && userId && userId > 0 && (
            <NotificationsContent tenantId={tenantId} adminUserId={userId} />
          )}
          {activeView === 'notifications' && (tenantId === null || !userId || userId <= 0) && (
            <p>Loading tenant or user information for notifications...</p>
          )}

          {activeView === 'lost-and-found' && userRole === 'admin' && tenantId !== null && userId && userId > 0 && <LostAndFoundAdminContent tenantId={tenantId} adminUserId={userId} />}
          {activeView === 'lost-and-found' && (tenantId === null || !userId || userId <=0) && <p>Loading information for Lost & Found...</p>}

        </main>
      </SidebarInset>
    </SidebarProvider>
  );
};

export default AdminDashboardPage;
