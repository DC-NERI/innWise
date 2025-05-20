
"use client";

import type { NextPage } from 'next';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarInset, SidebarFooter } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Building2, Settings, LogOut, Users, Network } from 'lucide-react';
import TenantsManagement from '@/components/sysad/tenants-management';
import UsersManagement from '@/components/sysad/users-management';
import AllBranchesManagement from '@/components/sysad/all-branches-management';
import type { UserRole } from '@/lib/types';
import { format as formatDateTime, parseISO } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const SysAdDashboardPage: NextPage = () => {
  const [activeView, setActiveView] = useState<'tenants' | 'branches' | 'users' | 'settings'>('tenants');
  const [dateTimeDisplay, setDateTimeDisplay] = useState<string>('Loading date and time...');
  
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [tenantName, setTenantName] = useState<string>("System Administrator"); 
  const [username, setUsername] = useState<string | null>(null);
  const [firstName, setFirstName] = useState<string | null>(null);
  const [lastName, setLastName] = useState<string | null>(null);

  const router = useRouter();
  const manilaTimeZone = 'Asia/Manila';

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedRole = localStorage.getItem('userRole') as UserRole | null;
      const storedUsername = localStorage.getItem('username');
      const storedFirstName = localStorage.getItem('userFirstName');
      const storedLastName = localStorage.getItem('userLastName');

      if (storedRole) {
        setUserRole(storedRole);
        if (storedRole !== 'sysad') { 
            router.push('/');
            return;
        }
      } else {
        router.push('/');
        return;
      }
      if (storedUsername) setUsername(storedUsername);
      if (storedFirstName) setFirstName(storedFirstName);
      if (storedLastName) setLastName(storedLastName);
    }

    const intervalId = setInterval(() => {
      const nowInManila = toZonedTime(new Date(), manilaTimeZone);
      setDateTimeDisplay(formatDateTime(nowInManila, 'yyyy-MM-dd hh:mm:ss aaaa'));
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
                onClick={() => setActiveView('tenants')}
                isActive={activeView === 'tenants'}
              >
                <Building2 />
                Tenants
              </SidebarMenuButton>
            </SidebarMenuItem>
             <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setActiveView('branches')}
                isActive={activeView === 'branches'}
              >
                <Network />
                Branches
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setActiveView('users')}
                isActive={activeView === 'users'}
              >
                <Users />
                Users
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
                >
                  <Settings />
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
            {dateTimeDisplay}
          </div>
           <Button variant="outline" size="sm" onClick={handleLogout}>
             <LogOut className="mr-2 h-4 w-4" /> Logout
           </Button>
        </header>
        <main className="p-4 lg:p-6">
          {activeView === 'tenants' && <TenantsManagement />}
          {activeView === 'branches' && <AllBranchesManagement />}
          {activeView === 'users' && <UsersManagement />}
          {activeView === 'settings' && (
            <div>
              <h2 className="text-2xl font-semibold">System Settings</h2>
              <p className="text-muted-foreground">Overall system settings and configurations will be managed here.</p>
            </div>
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
};

export default SysAdDashboardPage;

    