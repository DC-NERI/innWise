
"use client";

import type { NextPage } from 'next';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarInset, SidebarFooter } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Users, Building, Settings, LogOut, Tags, BedDouble } from 'lucide-react';
import UsersContent from '@/components/admin/users-content';
import BranchesContent from '@/components/admin/branches-content';
import RatesContent from '@/components/admin/rates-content';
import RoomsContent from '@/components/admin/rooms-content';
import { getTenantDetails } from '@/actions/admin';
import type { UserRole } from '@/lib/types';
import { format as formatDateTime } from 'date-fns';
import { utcToZonedTime } from 'date-fns-tz';

const AdminDashboardPage: NextPage = () => {
  const [activeView, setActiveView] = useState<'users' | 'branches' | 'rates' | 'rooms' | 'settings'>('branches');
  const [dateTimeDisplay, setDateTimeDisplay] = useState<string>('Loading date and time...');
  
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [tenantId, setTenantId] = useState<number | null>(null);
  const [tenantName, setTenantName] = useState<string>("Loading Tenant...");
  const [username, setUsername] = useState<string | null>(null);
  const [firstName, setFirstName] = useState<string | null>(null);
  const [lastName, setLastName] = useState<string | null>(null);

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

      if (storedTenantId) setTenantId(parseInt(storedTenantId, 10));
      if (storedUsername) setUsername(storedUsername);
      if (storedFirstName) setFirstName(storedFirstName);
      if (storedLastName) setLastName(storedLastName);

      if (storedRole === 'sysad') { // Should not happen if role check above works
         setTenantName("System Administrator");
      } else if (storedTenantName) {
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
      const nowInManila = utcToZonedTime(new Date(), manilaTimeZone);
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
                onClick={() => setActiveView('users')}
                isActive={activeView === 'users'}
                className="justify-start"
              >
                <Users className="h-5 w-5" />
                Users
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setActiveView('branches')}
                isActive={activeView === 'branches'}
                className="justify-start"
              >
                <Building className="h-5 w-5" />
                Branches
              </SidebarMenuButton>
            </SidebarMenuItem>
             <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setActiveView('rates')}
                isActive={activeView === 'rates'}
                className="justify-start"
              >
                <Tags className="h-5 w-5" />
                Rates
              </SidebarMenuButton>
            </SidebarMenuItem>
             <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setActiveView('rooms')}
                isActive={activeView === 'rooms'}
                className="justify-start"
              >
                <BedDouble className="h-5 w-5" />
                Rooms
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
            {dateTimeDisplay}
          </div>
           <Button variant="outline" size="sm" onClick={handleLogout}>
             <LogOut className="mr-2 h-4 w-4" /> Logout
           </Button>
        </header>
        <main className="p-4 lg:p-6">
          {activeView === 'users' && userRole === 'admin' && tenantId !== null && <UsersContent tenantId={tenantId} />}
          {activeView === 'users' && tenantId === null && <p>Loading tenant information for user management...</p>}

          {activeView === 'branches' && userRole === 'admin' && tenantId !== null && <BranchesContent tenantId={tenantId} />}
          {activeView === 'branches' && tenantId === null && <p>Loading tenant information for branch management...</p>}
          
          {activeView === 'rates' && userRole === 'admin' && tenantId !== null && <RatesContent tenantId={tenantId} />}
          {activeView === 'rates' && tenantId === null && <p>Loading tenant information for rate management...</p>}

          {activeView === 'rooms' && userRole === 'admin' && tenantId !== null && <RoomsContent tenantId={tenantId} />}
          {activeView === 'rooms' && tenantId === null && <p>Loading tenant information for room management...</p>}
          
          {activeView === 'settings' && userRole === 'admin' && (
            <div>
              <h2 className="text-2xl font-semibold">Settings</h2>
              <p className="text-muted-foreground">System settings will be managed here.</p>
            </div>
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
};

export default AdminDashboardPage;
