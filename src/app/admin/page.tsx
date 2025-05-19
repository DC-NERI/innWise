
"use client";

import type { NextPage } from 'next';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarInset, SidebarFooter } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Users, Building, Settings, LogOut } from 'lucide-react';
import UsersContent from '@/components/admin/users-content';
import BranchesContent from '@/components/admin/branches-content';
import { getTenantDetails } from '@/actions/admin';
import type { UserRole } from '@/lib/types';

const AdminDashboardPage: NextPage = () => {
  const [activeView, setActiveView] = useState<'users' | 'branches'>('branches');
  const [dateTime, setDateTime] = useState({ date: '', time: '' });
  
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [tenantId, setTenantId] = useState<number | null>(null);
  const [tenantName, setTenantName] = useState<string>("Loading Tenant...");
  const [username, setUsername] = useState<string | null>(null);

  const router = useRouter();

  useEffect(() => {
    // Retrieve user info from localStorage
    if (typeof window !== 'undefined') {
      const storedRole = localStorage.getItem('userRole') as UserRole | null;
      const storedTenantId = localStorage.getItem('userTenantId');
      const storedTenantName = localStorage.getItem('userTenantName');
      const storedUsername = localStorage.getItem('username');

      if (storedRole) setUserRole(storedRole);
      if (storedTenantId) setTenantId(parseInt(storedTenantId, 10));
      if (storedTenantName) setTenantName(storedTenantName); // Initial set from localStorage
      if (storedUsername) setUsername(storedUsername);

      // If role is sysad, tenantName is fixed
      if (storedRole === 'sysad') {
        setTenantName("System Administrator");
      } else if (storedTenantId && !storedTenantName) {
        // If tenantId exists but name wasn't stored/retrieved, fetch it
        // This handles cases where localStorage might not have been fully populated or cleared
        getTenantDetails(parseInt(storedTenantId, 10)).then(tenant => {
          if (tenant) {
            setTenantName(tenant.tenant_name);
            localStorage.setItem('userTenantName', tenant.tenant_name); // Optionally update localStorage
          } else {
            setTenantName("Tenant Not Found");
          }
        }).catch(error => {
          console.error("Failed to fetch tenant details on mount:", error);
          setTenantName("Error Fetching Info");
        });
      } else if (!storedRole && !storedTenantId) {
        // If no user info, likely means not logged in or session expired
        // Redirect to login, but be careful about redirect loops if this page is the default after login.
        // router.push('/'); // Consider the implications before enabling this
        setTenantName("Tenant Information"); // Fallback
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
  }, [router]); // Added router to dependency array if used for redirect

  const handleLogout = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('userRole');
      localStorage.removeItem('userTenantId');
      localStorage.removeItem('userTenantName');
      localStorage.removeItem('username');
    }
    router.push('/');
  };

  return (
    <SidebarProvider defaultOpen>
      <Sidebar>
        <SidebarHeader>
          <div className="p-4 border-b border-sidebar-border">
            <h2 className="text-xl font-semibold text-sidebar-primary-foreground truncate" title={tenantName}>{tenantName}</h2>
            {username && <p className="text-sm text-sidebar-foreground truncate" title={username}>User: {username}</p>}
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            {userRole === 'admin' && ( // Only show Users if role is admin
              <SidebarMenuItem
                onClick={() => setActiveView('users')}
                className={`hover:bg-sidebar-accent ${activeView === 'users' ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground'}`}
              >
                <Users className="mr-2 h-5 w-5" />
                Users
              </SidebarMenuItem>
            )}
             {(userRole === 'admin' || userRole === 'sysad') && ( // Show Branches for admin and sysad
                <SidebarMenuItem
                onClick={() => setActiveView('branches')}
                className={`hover:bg-sidebar-accent ${activeView === 'branches' ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground'}`}
                >
                <Building className="mr-2 h-5 w-5" />
                Branches
                </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter>
          <div className="p-2 border-t border-sidebar-border">
            { (userRole === 'admin' || userRole === 'sysad') && (
              <Button variant="ghost" className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent">
                <Settings className="mr-2 h-5 w-5" /> Settings
              </Button>
            )}
            <Button variant="ghost" className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent" onClick={handleLogout}>
               <LogOut className="mr-2 h-5 w-5" /> Logout
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex flex-col sm:flex-row justify-between items-center p-4 border-b bg-card text-card-foreground shadow-sm">
          <div className="mb-2 sm:mb-0">
            <h1 className="text-2xl font-semibold truncate" title={tenantName}>{tenantName}</h1>
          </div>
          <div className="text-sm text-muted-foreground">
            {dateTime.date && dateTime.time ? `${dateTime.date} - ${dateTime.time}` : 'Loading date and time...'}
          </div>
        </header>
        <main className="p-4 lg:p-6">
          {activeView === 'users' && userRole === 'admin' && <UsersContent />}
          {activeView === 'branches' && (userRole === 'admin' || userRole === 'sysad') && tenantId !== null && <BranchesContent tenantId={tenantId} />}
          {activeView === 'branches' && tenantId === null && <p>Loading tenant information...</p>}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
};

export default AdminDashboardPage;

// Removed metadata export as it's a client component
// export const metadata = {
//   title: "Admin Dashboard - InnWise",
// };
