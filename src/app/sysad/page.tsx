
"use client";

import type { NextPage } from 'next';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarInset, SidebarFooter } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Building, Settings, LogOut } from 'lucide-react';
import BranchesContent from '@/components/admin/branches-content'; // Re-using BranchesContent
import type { UserRole } from '@/lib/types';
// getTenantDetails might not be strictly needed if tenantName is always "System Administrator" for sysad
// but tenantId from localStorage is still used for BranchesContent.

const SysAdDashboardPage: NextPage = () => {
  const [activeView, setActiveView] = useState<'branches' | 'settings'>('branches');
  const [dateTime, setDateTime] = useState({ date: '', time: '' });
  
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [tenantId, setTenantId] = useState<number | null>(null);
  const [tenantName, setTenantName] = useState<string>("System Administrator"); // Default for sysad
  const [username, setUsername] = useState<string | null>(null);
  const [firstName, setFirstName] = useState<string | null>(null);
  const [lastName, setLastName] = useState<string | null>(null);

  const router = useRouter();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedRole = localStorage.getItem('userRole') as UserRole | null;
      const storedTenantId = localStorage.getItem('userTenantId');
      const storedUsername = localStorage.getItem('username');
      const storedFirstName = localStorage.getItem('userFirstName');
      const storedLastName = localStorage.getItem('userLastName');

      if (storedRole) {
        setUserRole(storedRole);
        if (storedRole === 'sysad') {
          setTenantName("System Administrator");
        }
      }
      // SysAd might or might not have a tenantId. If they do, it's for specific branch management context.
      if (storedTenantId) setTenantId(parseInt(storedTenantId, 10));
      if (storedUsername) setUsername(storedUsername);
      if (storedFirstName) setFirstName(storedFirstName);
      if (storedLastName) setLastName(storedLastName);
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
  }, []);

  const handleLogout = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('userRole');
      localStorage.removeItem('userTenantId');
      localStorage.removeItem('userTenantName'); // Though for sysad it's fixed
      localStorage.removeItem('username');
      localStorage.removeItem('userFirstName');
      localStorage.removeItem('userLastName');
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
            {/* SysAd typically has access to Branches and Settings based on previous admin page logic */}
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
            {dateTime.date && dateTime.time ? `${dateTime.date} - ${dateTime.time}` : 'Loading date and time...'}
          </div>
           <Button variant="outline" size="sm" onClick={handleLogout}>
             <LogOut className="mr-2 h-4 w-4" /> Logout
           </Button>
        </header>
        <main className="p-4 lg:p-6">
          {/* 
            If sysad has a tenantId (e.g., managing a specific tenant's branches temporarily or assigned one), 
            BranchesContent will render. Otherwise, if tenantId is null, this won't render.
            A more advanced sysad branch view might involve a tenant selector.
          */}
          {activeView === 'branches' && tenantId !== null && <BranchesContent tenantId={tenantId} />}
          {activeView === 'branches' && tenantId === null && (
            <div>
              <h2 className="text-2xl font-semibold">Branches Management</h2>
              <p className="text-muted-foreground">
                As a System Administrator, you can manage branches.
                If you are associated with a specific tenant, their branches will be shown.
                Otherwise, a tenant selection might be required (feature to be implemented).
              </p>
            </div>
          )}
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
