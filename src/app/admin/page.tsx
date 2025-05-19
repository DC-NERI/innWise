
"use client";

import type { NextPage } from 'next';
import { useState, useEffect } from 'react';
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarInset, SidebarFooter } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Users, Building, Home, Settings, LogOut } from 'lucide-react';
import UsersContent from '@/components/admin/users-content';
import BranchesContent from '@/components/admin/branches-content';
import Link from 'next/link';

const AdminDashboardPage: NextPage = () => {
  const [activeView, setActiveView] = useState<'users' | 'branches'>('branches'); // Default to branches as per typical first content
  const [dateTime, setDateTime] = useState({ date: '', time: '' });
  const [tenantName, setTenantName] = useState<string>("Tenant Name Placeholder"); // Placeholder

  useEffect(() => {
    // Fetch actual tenant name here if possible, e.g., from session or an API
    // For now, we use a placeholder.

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

  // Placeholder tenantId - in a real app, this would come from the user's session
  const tenantId = 1; 

  return (
    <SidebarProvider defaultOpen>
      <Sidebar>
        <SidebarHeader>
          <div className="p-4">
            <h2 className="text-xl font-semibold text-sidebar-primary-foreground">InnWise Admin</h2>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            <SidebarMenuItem
              onClick={() => setActiveView('users')}
              className={`hover:bg-sidebar-accent ${activeView === 'users' ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground'}`}
            >
              <Users className="mr-2 h-5 w-5" />
              Users
            </SidebarMenuItem>
            <SidebarMenuItem
              onClick={() => setActiveView('branches')}
              className={`hover:bg-sidebar-accent ${activeView === 'branches' ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground'}`}
            >
              <Building className="mr-2 h-5 w-5" />
              Branches
            </SidebarMenuItem>
             <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <Link href="/">
                  <Home className="mr-2 h-5 w-5" />
                  Go to Login
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter>
          <div className="p-2">
            <Button variant="ghost" className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent">
              <Settings className="mr-2 h-5 w-5" /> Settings
            </Button>
            <Button variant="ghost" className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent">
               <LogOut className="mr-2 h-5 w-5" /> Logout
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex flex-col sm:flex-row justify-between items-center p-4 border-b bg-card text-card-foreground shadow-sm">
          <div className="mb-2 sm:mb-0">
            <h1 className="text-2xl font-semibold">{tenantName}</h1>
          </div>
          <div className="text-sm text-muted-foreground">
            {dateTime.date && dateTime.time ? `${dateTime.date} - ${dateTime.time}` : 'Loading date and time...'}
          </div>
        </header>
        <main className="p-4 lg:p-6">
          {activeView === 'users' && <UsersContent />}
          {activeView === 'branches' && <BranchesContent tenantId={tenantId} />}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
};

export default AdminDashboardPage;
