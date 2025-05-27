
"use client";

import type { NextPage } from 'next';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarInset, SidebarFooter, SidebarMenuBadge, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { LogOut, BedDouble, CalendarPlus, MessageSquare, LayoutDashboard, Users as UsersIcon, PanelLeft, Eye, Archive as LostAndFoundIcon, Wrench } from 'lucide-react';
import { getTenantDetails } from '@/actions/admin/tenants/getTenantDetails';
import type { UserRole } from '@/lib/types';
import RoomStatusContent from '@/components/staff/room-status-content';
import ReservationsContent from '@/components/staff/reservations-content';
import NotificationsContent from '@/components/staff/notifications-content';
import WalkInCheckInContent from '@/components/staff/walkin-checkin-content';
import DashboardContent from '@/components/staff/dashboard-content';
import LostAndFoundContent from '@/components/staff/lost-and-found-content';
import { listUnassignedReservations } from '@/actions/staff/reservations/listUnassignedReservations';
import { listNotificationsForBranch } from '@/actions/staff/notifications/listNotificationsForBranch'; // For unread count
import { NOTIFICATION_STATUS } from '@/lib/constants'; // For unread count
import { format as formatDateTime, toZonedTime } from 'date-fns-tz';


const StaffDashboardPage: NextPage = () => {
  const [activeView, setActiveView] = useState<'dashboard' | 'room-status' | 'walk-in' | 'reservations' | 'notifications' | 'lost-and-found'>('dashboard');
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

  const [isAvailableRoomsOverviewModalOpen, setIsAvailableRoomsOverviewModalOpen] = useState(false);
  const [unassignedReservationsCount, setUnassignedReservationsCount] = useState<number>(0);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState<number>(0);

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
        if (storedRole !== 'staff' && storedRole !== 'admin') {
            router.push('/');
            return;
        }
      } else {
        router.push('/');
        return;
      }

      if (storedTenantId) {
        const parsedTenantId = parseInt(storedTenantId, 10);
        setTenantId(parsedTenantId);
        if (storedTenantName) {
          setTenantName(storedTenantName);
        } else if(parsedTenantId > 0) {
          getTenantDetails(parsedTenantId).then(tenant => {
            if (tenant) {
              setTenantName(tenant.tenant_name);
              if (typeof window !== 'undefined') {
                  localStorage.setItem('userTenantName', tenant.tenant_name);
              }
            } else {
              setTenantName("Tenant Not Found");
            }
          }).catch(error => {
            console.error("Error fetching tenant details for staff page:", error);
            setTenantName("Error Fetching Tenant Info");
          });
        } else {
             setTenantName("Tenant Information Unavailable");
        }
      } else {
        setTenantName("Tenant Information Unavailable");
      }


      if (storedUsername) setUsername(storedUsername);
      if (storedFirstName) setFirstName(storedFirstName);
      if (storedLastName) setLastName(storedLastName);
      if (storedBranchId) setBranchId(parseInt(storedBranchId, 10));
      if (storedBranchName) setBranchName(storedBranchName);

      if (storedUserId && !isNaN(parseInt(storedUserId, 10))) {
        const parsedUserId = parseInt(storedUserId, 10);
        if (parsedUserId > 0) {
          setUserId(parsedUserId);
        } else {
          console.warn("[StaffDashboardPage] Invalid userId found in localStorage:", storedUserId);
          setUserId(null);
        }
      } else {
        console.warn("[StaffDashboardPage] No valid userId found in localStorage.");
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

  const fetchReservationCount = useCallback(async () => {
    if (tenantId && branchId) {
      try {
        const reservations = await listUnassignedReservations(tenantId, branchId);
        setUnassignedReservationsCount(reservations.length);
      } catch (error) {
        console.error("Failed to fetch unassigned reservation count:", error);
        setUnassignedReservationsCount(0);
      }
    } else {
      setUnassignedReservationsCount(0);
    }
  }, [tenantId, branchId]);

  const fetchUnreadNotificationCount = useCallback(async () => {
    if (tenantId && branchId) {
      try {
        const notifications = await listNotificationsForBranch(tenantId, branchId);
        const unreadCount = notifications.filter(n => n.status === NOTIFICATION_STATUS.UNREAD).length;
        setUnreadNotificationsCount(unreadCount);
      } catch (error) {
        console.error("Failed to fetch unread notification count:", error);
        setUnreadNotificationsCount(0);
      }
    } else {
      setUnreadNotificationsCount(0);
    }
  }, [tenantId, branchId]);


  useEffect(() => {
    if (tenantId && branchId) { 
      fetchReservationCount(); // Initial fetch
      const countInterval = setInterval(fetchReservationCount, 60000); // Refresh every minute
      
      fetchUnreadNotificationCount(); // Initial fetch for notifications
      const notificationInterval = setInterval(fetchUnreadNotificationCount, 20000); // Refresh every 20 seconds

      return () => {
        clearInterval(countInterval);
        clearInterval(notificationInterval);
      };
    }
  }, [fetchReservationCount, fetchUnreadNotificationCount, tenantId, branchId]);


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
                onClick={() => setActiveView('room-status')}
                isActive={activeView === 'room-status'}
                tooltip="Room Status"
              >
                <BedDouble />
                <span>Room Status</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setActiveView('walk-in')}
                isActive={activeView === 'walk-in'}
                tooltip="Walk-in Check-in"
              >
                <UsersIcon />
                <span>Walk-in Check-in</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setActiveView('reservations')}
                isActive={activeView === 'reservations'}
                tooltip="Reservations"
              >
                <CalendarPlus />
                <span>Reservations</span>
                {unassignedReservationsCount > 0 && (
                  <SidebarMenuBadge>{unassignedReservationsCount}</SidebarMenuBadge>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setActiveView('notifications')}
                isActive={activeView === 'notifications'}
                tooltip="Messages & Notifications"
              >
                <MessageSquare />
                <span>Message/Notif</span>
                {unreadNotificationsCount > 0 && (
                  <SidebarMenuBadge>{unreadNotificationsCount}</SidebarMenuBadge>
                )}
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
          {/* Removed Settings Button from staff page */}
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
             {activeView === 'room-status' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsAvailableRoomsOverviewModalOpen(true)}
              >
                <Eye className="mr-2 h-4 w-4" /> View Available
              </Button>
            )}
          </div>
           <Button variant="outline" size="sm" onClick={handleLogout}>
             <LogOut className="mr-2 h-4 w-4" /> Logout
           </Button>
        </header>
        <main className="p-4 lg:p-6">
          {activeView === 'dashboard' && tenantId && branchId && userId && userId > 0 && (
            <DashboardContent tenantId={tenantId} branchId={branchId} staffUserId={userId} />
          )}
          {activeView === 'room-status' && tenantId && branchId && userId && userId > 0 && (
            <RoomStatusContent
              tenantId={tenantId}
              branchId={branchId}
              staffUserId={userId}
              showAvailableRoomsOverview={isAvailableRoomsOverviewModalOpen}
              onCloseAvailableRoomsOverview={() => setIsAvailableRoomsOverviewModalOpen(false)}
            />
          )}
          {activeView === 'walk-in' && tenantId && branchId && userId && userId > 0 && (
            <WalkInCheckInContent
              tenantId={tenantId}
              branchId={branchId}
              staffUserId={userId}
            />
          )}
          {activeView === 'reservations' && tenantId && branchId && userId && userId > 0 && (
            <ReservationsContent
              tenantId={tenantId}
              branchId={branchId}
              staffUserId={userId}
              refreshReservationCount={fetchReservationCount}
            />
          )}
           {activeView === 'notifications' && tenantId && branchId && userId && userId > 0 && (
            <NotificationsContent
              tenantId={tenantId}
              branchId={branchId}
              staffUserId={userId}
              refreshReservationCount={fetchReservationCount}
            />
          )}
          {activeView === 'lost-and-found' && tenantId && branchId && userId && userId > 0 && (
            <LostAndFoundContent
              tenantId={tenantId}
              branchId={branchId}
              staffUserId={userId}
            />
          )}
          {(activeView === 'dashboard' || activeView === 'room-status' || activeView === 'reservations' || activeView === 'notifications' || activeView === 'walk-in' || activeView === 'lost-and-found') && (!tenantId || !branchId || (activeView !== 'dashboard' && !userId) ) && (
             <Card>
              <CardHeader>
                <div className="flex items-center space-x-2">
                  {activeView === 'dashboard' ? <LayoutDashboard className="h-6 w-6 text-primary" /> :
                   activeView === 'room-status' ? <BedDouble className="h-6 w-6 text-primary" /> :
                   activeView === 'walk-in' ? <UsersIcon className="h-6 w-6 text-primary" /> :
                   activeView === 'reservations' ? <CalendarPlus className="h-6 w-6 text-primary" /> :
                   activeView === 'notifications' ? <MessageSquare className="h-6 w-6 text-primary" /> :
                   activeView === 'lost-and-found' ? <LostAndFoundIcon className="h-6 w-6 text-primary" /> :
                   <Wrench className="h-6 w-6 text-primary" />
                  }
                  <CardTitle>
                    {activeView === 'dashboard' ? 'Dashboard' :
                     activeView === 'room-status' ? 'Room Status' :
                     activeView === 'walk-in' ? 'Walk-in Check-in' :
                     activeView === 'reservations' ? 'Reservations' :
                     activeView === 'notifications' ? 'Notifications & Messages' :
                     activeView === 'lost-and-found' ? 'Lost & Found' :
                     'Content Unavailable'}
                  </CardTitle>
                </div>
                 <CardDescription>
                    {activeView === 'dashboard' ? 'Overview of your branch activities.' :
                     activeView === 'room-status' ? 'Manage room availability and guest check-ins.' :
                     activeView === 'walk-in' ? 'Directly check-in a guest without a prior reservation.' :
                     activeView === 'reservations' ? 'Manage unassigned reservations.' :
                     activeView === 'notifications' ? 'View messages and notifications for your branch.' :
                     activeView === 'lost-and-found' ? 'Manage lost and found items.' :
                     'This content cannot be loaded.'}
                 </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Required information (Tenant, Branch, or User ID) not available. Please ensure you are properly logged in and assigned.
                  {(!userId && (activeView !== 'dashboard' && activeView !== 'walk-in' && activeView !== 'lost-and-found')) && " (Specifically, User ID is missing for this view.)"}
                </p>
              </CardContent>
            </Card>
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
};

export default StaffDashboardPage;

    