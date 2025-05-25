
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { Loader2, PlusCircle, Users as UsersIconAliased, Edit, Trash2, ArchiveRestore, KeyRound, BookOpen } from 'lucide-react'; // Renamed UsersIcon
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { 
  userCreateSchemaAdmin, UserCreateDataAdmin, 
  userUpdateSchemaAdmin, UserUpdateDataAdmin,
  adminResetPasswordSchema, AdminResetPasswordData
} from '@/lib/schemas';
import type { User, SimpleBranch } from '@/lib/types';
import { getUsersForTenant } from '@/actions/admin/users/getUsersForTenant';
import { createUserAdmin } from '@/actions/admin/users/createUserAdmin';
import { updateUserAdmin } from '@/actions/admin/users/updateUserAdmin';
import { archiveUserAdmin } from '@/actions/admin/users/archiveUserAdmin';
import { getBranchesForTenantSimple } from '@/actions/admin/branches/getBranchesForTenantSimple';
import { resetUserPasswordAdmin } from '@/actions/admin/users/resetUserPasswordAdmin'; // New import
import { listActivityLogsForTenant } from '@/actions/admin/users/listActivityLogsForTenant'; // New import
import type { ActivityLog } from '@/lib/types'; // New import
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HOTEL_ENTITY_STATUS } from '@/lib/constants';
import { format, parseISO } from 'date-fns';

type UserFormValues = UserCreateDataAdmin | UserUpdateDataAdmin;

interface UsersContentProps {
  tenantId: number;
  adminUserId: number; // The ID of the admin performing actions
}

const defaultFormValuesCreate: UserCreateDataAdmin = {
  first_name: '',
  last_name: '',
  username: '',
  password: '',
  email: '',
  role: 'staff',
  tenant_branch_id: undefined,
};

const defaultResetPasswordFormValues: AdminResetPasswordData = {
  new_password: '',
  confirm_password: '',
};

const LOGS_PER_PAGE = 10;

export default function UsersContent({ tenantId, adminUserId }: UsersContentProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [isLoadingActivityLogs, setIsLoadingActivityLogs] = useState(false);
  const [activityLogsTotalCount, setActivityLogsTotalCount] = useState(0);
  const [activityLogsCurrentPage, setActivityLogsCurrentPage] = useState(1);
  const [availableBranches, setAvailableBranches] = useState<SimpleBranch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isResetPasswordDialogOpen, setIsResetPasswordDialogOpen] = useState(false);
  const [userForPasswordReset, setUserForPasswordReset] = useState<User | null>(null);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [activeTab, setActiveTab] = useState("active"); // For user management tabs
  const [mainActiveTab, setMainActiveTab] = useState("manageUsers"); // For top-level tabs

  const { toast } = useToast();

  const isEditing = !!selectedUser;

  const userForm = useForm<UserFormValues>({ /* resolver set in useEffect */ });
  const selectedRoleInForm = useWatch({ control: userForm.control, name: 'role' });

  const resetPasswordForm = useForm<AdminResetPasswordData>({
    resolver: zodResolver(adminResetPasswordSchema),
    defaultValues: defaultResetPasswordFormValues,
  });

  const fetchUsersAndInitialBranches = useCallback(async () => {
    if (!tenantId) { setIsLoading(false); return; }
    setIsLoading(true);
    try {
      const [fetchedUsers, fetchedBranches] = await Promise.all([
        getUsersForTenant(tenantId),
        getBranchesForTenantSimple(tenantId)
      ]);
      setUsers(fetchedUsers);
      setAvailableBranches(fetchedBranches.filter(b => b.status === HOTEL_ENTITY_STATUS.ACTIVE));
    } catch (error) {
      toast({ title: "Error fetching data", description: error instanceof Error ? error.message : "Could not fetch user or branch data.", variant: "destructive" });
    } finally { setIsLoading(false); }
  }, [tenantId, toast]);

  const fetchActivityLogs = useCallback(async (page: number = 1) => {
    if (!tenantId || mainActiveTab !== "activityLogs") return;
    setIsLoadingActivityLogs(true);
    try {
      const result = await listActivityLogsForTenant(tenantId, page, LOGS_PER_PAGE);
      if (result.success && result.logs) {
        setActivityLogs(result.logs);
        setActivityLogsTotalCount(result.totalCount || 0);
        setActivityLogsCurrentPage(page);
      } else {
        toast({ title: "Error", description: result.message || "Could not fetch activity logs.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "An unexpected error occurred fetching logs.", variant: "destructive" });
    } finally {
      setIsLoadingActivityLogs(false);
    }
  }, [tenantId, mainActiveTab, toast]);

  useEffect(() => {
    fetchUsersAndInitialBranches();
  }, [fetchUsersAndInitialBranches]);
  
  useEffect(() => {
    if (mainActiveTab === "activityLogs") {
      fetchActivityLogs(1); // Fetch first page when tab becomes active
    }
  }, [mainActiveTab, fetchActivityLogs]);


  useEffect(() => {
    const currentIsEditing = !!selectedUser;
    const newResolver = zodResolver(currentIsEditing ? userUpdateSchemaAdmin : userCreateSchemaAdmin);
    let newDefaults: UserFormValues;

    if (currentIsEditing && selectedUser) {
      newDefaults = {
        first_name: selectedUser.first_name,
        last_name: selectedUser.last_name,
        password: '',
        email: selectedUser.email || '',
        role: selectedUser.role as 'admin' | 'staff' | 'housekeeping',
        tenant_branch_id: selectedUser.tenant_branch_id || undefined,
        status: selectedUser.status || HOTEL_ENTITY_STATUS.ACTIVE,
      };
    } else {
      newDefaults = defaultFormValuesCreate;
    }
    userForm.reset(newDefaults, { resolver: newResolver } as any);
  }, [selectedUser, userForm, isAddDialogOpen, isEditDialogOpen]);


  const handleAddSubmit = async (data: UserCreateDataAdmin) => {
    setIsSubmitting(true);
    try {
      const result = await createUserAdmin(data, tenantId, adminUserId);
      if (result.success && result.user) {
        toast({ title: "Success", description: "User created." });
        setUsers(prev => [...prev, result.user!].sort((a, b) => {
          if (a.role === 'admin' && b.role !== 'admin') return -1;
          if (a.role !== 'admin' && b.role === 'admin') return 1;
          return (a.last_name || '').localeCompare(b.last_name || '');
        }));
        setIsAddDialogOpen(false);
      } else {
        toast({ title: "Creation Failed", description: result.message, variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Unexpected error during user creation.", variant: "destructive" });
    } finally { setIsSubmitting(false); }
  };

  const handleEditSubmit = async (data: UserUpdateDataAdmin) => {
    if (!selectedUser) return;
    setIsSubmitting(true);
    let payload: Partial<UserUpdateDataAdmin> = { ...data };
    if (data.password === '' || data.password === null || data.password === undefined) {
      delete payload.password;
    }

    try {
      const result = await updateUserAdmin(Number(selectedUser.id), payload as UserUpdateDataAdmin, tenantId, adminUserId);
      if (result.success && result.user) {
        toast({ title: "Success", description: "User updated." });
        setUsers(prev => prev.map(u => u.id === result.user!.id ? result.user! : u).sort((a, b) => {
          if (a.role === 'admin' && b.role !== 'admin') return -1;
          if (a.role !== 'admin' && b.role === 'admin') return 1;
          return (a.last_name || '').localeCompare(b.last_name || '');
        }));
        setIsEditDialogOpen(false);
        setSelectedUser(null);
      } else {
        toast({ title: "Update Failed", description: result.message, variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Unexpected error during user update.", variant: "destructive" });
    } finally { setIsSubmitting(false); }
  };

  const handleArchive = async (userId: number, username: string) => {
    setIsSubmitting(true);
    try {
      const result = await archiveUserAdmin(userId, tenantId, adminUserId);
      if (result.success) {
        toast({ title: "Success", description: `User "${username}" archived.` });
        setUsers(prev => prev.map(u => u.id === String(userId) ? { ...u, status: HOTEL_ENTITY_STATUS.ARCHIVED } : u));
      }
      else { toast({ title: "Archive Failed", description: result.message, variant: "destructive" }); }
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Unexpected error during archiving.", variant: "destructive" });
    } finally { setIsSubmitting(false); }
  };

  const handleRestore = async (user: User) => {
    setIsSubmitting(true);
    const payload: UserUpdateDataAdmin = {
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email || '',
      role: user.role as 'admin' | 'staff' | 'housekeeping',
      tenant_branch_id: user.tenant_branch_id,
      status: HOTEL_ENTITY_STATUS.ACTIVE,
    };
    try {
      const result = await updateUserAdmin(Number(user.id), payload, tenantId, adminUserId);
      if (result.success && result.user) {
        toast({ title: "Success", description: `User "${user.username}" restored.` });
        setUsers(prev => prev.map(u => u.id === result.user!.id ? result.user! : u));
      } else {
        toast({ title: "Restore Failed", description: result.message, variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Unexpected error during restore.", variant: "destructive" });
    } finally { setIsSubmitting(false); }
  };

  const handleOpenResetPasswordDialog = (user: User) => {
    setUserForPasswordReset(user);
    resetPasswordForm.reset(defaultResetPasswordFormValues);
    setIsResetPasswordDialogOpen(true);
  };

  const handleResetPasswordSubmit = async (data: AdminResetPasswordData) => {
    if (!userForPasswordReset) return;
    setIsSubmitting(true);
    try {
      const result = await resetUserPasswordAdmin(Number(userForPasswordReset.id), data, adminUserId, tenantId);
      if (result.success) {
        toast({ title: "Success", description: `Password for ${userForPasswordReset.username} has been reset.` });
        setIsResetPasswordDialogOpen(false);
        setUserForPasswordReset(null);
      } else {
        toast({ title: "Password Reset Failed", description: result.message, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "An unexpected error occurred during password reset.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };


  const filteredUsers = users.filter(user => user.status === (activeTab === "active" ? HOTEL_ENTITY_STATUS.ACTIVE : HOTEL_ENTITY_STATUS.ARCHIVED));
  const totalActivityLogPages = Math.ceil(activityLogsTotalCount / LOGS_PER_PAGE);


  const renderUserFormFields = () => {
    const usernameField = (() => {
      if (isEditing && selectedUser) {
        return (
          <FormItem>
            <FormLabel>Username (Read-only)</FormLabel>
            <FormControl><Input readOnly value={selectedUser.username} className="w-[90%]" /></FormControl>
          </FormItem>
        );
      }
      return (
        <FormField control={userForm.control} name="username" render={({ field }) => (
            <FormItem><FormLabel>Username *</FormLabel><FormControl><Input placeholder="johndoe" {...field} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
        )} />
      );
    })();

    return (
      <React.Fragment>
        <FormField control={userForm.control} name="first_name" render={({ field }) => (<FormItem><FormLabel>First Name *</FormLabel><FormControl><Input placeholder="John" {...field} className="w-[90%]" /></FormControl><FormMessage /></FormItem>)} />
        <FormField control={userForm.control} name="last_name" render={({ field }) => (<FormItem><FormLabel>Last Name *</FormLabel><FormControl><Input placeholder="Doe" {...field} className="w-[90%]" /></FormControl><FormMessage /></FormItem>)} />
        {usernameField}
        <FormField control={userForm.control} name="password" render={({ field }) => (<FormItem><FormLabel>{isEditing ? "New Password (Optional)" : "Password *"}</FormLabel><FormControl><Input type="password" placeholder="••••••••" {...field} className="w-[90%]" /></FormControl><FormMessage /></FormItem>)} />
        <FormField control={userForm.control} name="email" render={({ field }) => (<FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" placeholder="john.doe@example.com" {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl><FormMessage /></FormItem>)} />
        <FormField control={userForm.control} name="role"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Role *</FormLabel>
              <Select onValueChange={field.onChange} value={field.value as 'admin' | 'staff' | 'housekeeping'}>
                <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder="Select role" /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectItem value="staff">Staff</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="housekeeping">Housekeeping</SelectItem>
                </SelectContent>
              </Select><FormMessage />
            </FormItem>
          )}
        />
        <FormField control={userForm.control} name="tenant_branch_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Branch {selectedRoleInForm === 'staff' || selectedRoleInForm === 'housekeeping' ? '*' : '(Optional)'}</FormLabel>
              <Select
                onValueChange={(v) => field.onChange(v ? parseInt(v) : undefined)}
                value={field.value?.toString()}
                disabled={isLoadingBranches || availableBranches.length === 0}
              >
                <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder={isLoadingBranches ? "Loading branches..." : availableBranches.length === 0 ? "No active branches for this tenant" : (selectedRoleInForm === 'staff' || selectedRoleInForm === 'housekeeping' ? "Select branch *" : "Assign to branch (Optional)")} /></SelectTrigger></FormControl>
                <SelectContent>{availableBranches.map(b => <SelectItem key={b.id} value={b.id.toString()}>{b.branch_name}</SelectItem>)}</SelectContent>
              </Select><FormMessage />
            </FormItem>
          )}
        />
        {isEditing && (
          <FormField control={userForm.control} name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Status *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value?.toString()}>
                  <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder="Select status" /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value={HOTEL_ENTITY_STATUS.ACTIVE}>Active</SelectItem>
                    <SelectItem value={HOTEL_ENTITY_STATUS.ARCHIVED}>Archived</SelectItem>
                  </SelectContent>
                </Select><FormMessage />
              </FormItem>
            )}
          />
        )}
      </React.Fragment>
    );
  }

  if (isLoading && users.length === 0 && mainActiveTab === "manageUsers") {
    return <div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2 text-muted-foreground">Loading users...</p></div>;
  }
  if (!tenantId) {
    return <Card><CardHeader><CardTitle>User Management</CardTitle><CardDescription>Tenant ID is not available.</CardDescription></CardHeader><CardContent><p>Cannot load users without a valid tenant identifier.</p></CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <div className="flex items-center space-x-2">
            {mainActiveTab === "manageUsers" && <UsersIconAliased className="h-6 w-6 text-primary" />}
            {mainActiveTab === "activityLogs" && <BookOpen className="h-6 w-6 text-primary" />}
            <CardTitle>
              {mainActiveTab === "manageUsers" ? "User Management" : "Activity Logs"}
            </CardTitle>
          </div>
          <CardDescription>
            {mainActiveTab === "manageUsers" ? "Manage users within your tenant." : "View system activity logs for your tenant."}
          </CardDescription>
        </div>
        {mainActiveTab === "manageUsers" && (
          <Dialog
            key={isEditing ? `edit-user-admin-${selectedUser?.id}` : 'add-user-admin'}
            open={isAddDialogOpen || isEditDialogOpen}
            onOpenChange={(open) => {
              if (!open) { setIsAddDialogOpen(false); setIsEditDialogOpen(false); setSelectedUser(null); userForm.reset({ ...defaultFormValuesCreate, role: 'staff' }); }
            }}
          >
            <DialogTrigger asChild>
              <Button onClick={() => { setSelectedUser(null); userForm.reset({ ...defaultFormValuesCreate, role: 'staff' }); setIsAddDialogOpen(true); setIsEditDialogOpen(false); }}>
                <PlusCircle className="mr-2 h-4 w-4" /> Add User
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg p-3 flex flex-col max-h-[85vh]">
              <DialogHeader className="p-2 border-b"><DialogTitle>{isEditing ? `Edit User: ${selectedUser?.username}` : 'Add New User'}</DialogTitle></DialogHeader>
              <Form {...userForm}>
                <form onSubmit={userForm.handleSubmit(isEditing ? (d => handleEditSubmit(d as UserUpdateDataAdmin)) : (d => handleAddSubmit(d as UserCreateDataAdmin)))} className="bg-card rounded-md flex flex-col flex-grow overflow-hidden">
                  <div className="flex-grow space-y-3 p-1 overflow-y-auto">
                    {renderUserFormFields()}
                  </div>
                  <DialogFooter className="bg-card py-2 border-t px-3 sticky bottom-0 z-10">
                    <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                    <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : (isEditing ? "Save Changes" : "Create User")}</Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        <Tabs value={mainActiveTab} onValueChange={setMainActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="manageUsers">Manage Users</TabsTrigger>
            <TabsTrigger value="activityLogs">Activity Logs</TabsTrigger>
          </TabsList>
          <TabsContent value="manageUsers">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="mb-4"><TabsTrigger value="active">Active</TabsTrigger><TabsTrigger value="archive">Archive</TabsTrigger></TabsList>
              <TabsContent value="active">
                {!isLoading && filteredUsers.length === 0 && <p className="text-muted-foreground text-center py-8">No active users found for this tenant.</p>}
                {!isLoading && filteredUsers.length > 0 && (
                  <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Username</TableHead><TableHead>Role</TableHead><TableHead>Branch</TableHead><TableHead>Last Login</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                    <TableBody>{filteredUsers.map(u => (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">{u.first_name} {u.last_name}</TableCell>
                        <TableCell>{u.username}</TableCell>
                        <TableCell className="capitalize">{u.role}</TableCell>
                        <TableCell>{u.branch_name || 'N/A'}</TableCell>
                        <TableCell>{u.last_log_in ? format(parseISO(u.last_log_in.replace(' ', 'T')), 'yyyy-MM-dd hh:mm aa') : 'N/A'}</TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button variant="outline" size="sm" onClick={() => { setSelectedUser(u); setIsEditDialogOpen(true); setIsAddDialogOpen(false); }}><Edit className="mr-1 h-3 w-3" /> Edit</Button>
                          <Button variant="outline" size="sm" onClick={() => handleOpenResetPasswordDialog(u)}><KeyRound className="mr-1 h-3 w-3" /> Reset Pass</Button>
                          <AlertDialog><AlertDialogTrigger asChild><Button variant="destructive" size="sm" disabled={isSubmitting}><Trash2 className="mr-1 h-3 w-3" /> Archive</Button></AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader><AlertDialogTitle>Confirm Archive</AlertDialogTitle><AlertDialogDescription>Are you sure you want to archive user "{u.username}"?</AlertDialogDescription></AlertDialogHeader>
                              <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleArchive(Number(u.id), u.username)} disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : "Archive"}</AlertDialogAction></AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </TableCell>
                      </TableRow>))}
                    </TableBody>
                  </Table>)}
              </TabsContent>
              <TabsContent value="archive">
                {!isLoading && filteredUsers.length === 0 && <p className="text-muted-foreground text-center py-8">No archived users found for this tenant.</p>}
                {!isLoading && filteredUsers.length > 0 && (
                  <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Username</TableHead><TableHead>Role</TableHead><TableHead>Branch</TableHead><TableHead>Last Login</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                    <TableBody>{filteredUsers.map(u => (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">{u.first_name} {u.last_name}</TableCell><TableCell>{u.username}</TableCell><TableCell className="capitalize">{u.role}</TableCell><TableCell>{u.branch_name || 'N/A'}</TableCell>
                        <TableCell>{u.last_log_in ? format(parseISO(u.last_log_in.replace(' ', 'T')), 'yyyy-MM-dd hh:mm aa') : 'N/A'}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" onClick={() => handleRestore(u)} disabled={isSubmitting}><ArchiveRestore className="mr-1 h-3 w-3" /> Restore</Button>
                        </TableCell>
                      </TableRow>))}
                    </TableBody>
                  </Table>)}
              </TabsContent>
            </Tabs>
          </TabsContent>
          <TabsContent value="activityLogs">
            {isLoadingActivityLogs && <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
            {!isLoadingActivityLogs && activityLogs.length === 0 && <p className="text-muted-foreground text-center py-8">No activity logs found for this tenant.</p>}
            {!isLoadingActivityLogs && activityLogs.length > 0 && (
              <>
                <div className="max-h-[60vh] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Timestamp</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Target</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activityLogs.map(log => (
                        <TableRow key={log.id}>
                          <TableCell>{format(parseISO(log.created_at.replace(' ', 'T')), 'yyyy-MM-dd hh:mm:ss aa')}</TableCell>
                          <TableCell>{log.username || 'N/A'}</TableCell>
                          <TableCell>{log.action_type}</TableCell>
                          <TableCell className="max-w-xs truncate" title={log.description || undefined}>{log.description || '-'}</TableCell>
                          <TableCell>{log.target_entity_type ? `${log.target_entity_type} (ID: ${log.target_entity_id || 'N/A'})` : '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {totalActivityLogPages > 1 && (
                  <div className="flex justify-center items-center space-x-2 mt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fetchActivityLogs(activityLogsCurrentPage - 1)}
                      disabled={activityLogsCurrentPage <= 1 || isLoadingActivityLogs}
                    >
                      Previous
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      Page {activityLogsCurrentPage} of {totalActivityLogPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fetchActivityLogs(activityLogsCurrentPage + 1)}
                      disabled={activityLogsCurrentPage >= totalActivityLogPages || isLoadingActivityLogs}
                    >
                      Next
                    </Button>
                  </div>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>

       {/* Reset Password Dialog */}
      <Dialog open={isResetPasswordDialogOpen} onOpenChange={(open) => {
        if (!open) { setUserForPasswordReset(null); resetPasswordForm.reset(defaultResetPasswordFormValues); }
        setIsResetPasswordDialogOpen(open);
      }}>
        <DialogContent className="sm:max-w-md p-3">
          <DialogHeader className="p-2 border-b">
            <DialogTitle>Reset Password for {userForPasswordReset?.username}</DialogTitle>
          </DialogHeader>
          <Form {...resetPasswordForm}>
            <form onSubmit={resetPasswordForm.handleSubmit(handleResetPasswordSubmit)} className="bg-card rounded-md flex flex-col flex-grow overflow-hidden">
              <div className="flex-grow space-y-3 p-1 overflow-y-auto">
                <FormField
                  control={resetPasswordForm.control}
                  name="new_password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>New Password *</FormLabel>
                      <FormControl><Input type="password" placeholder="••••••••" {...field} className="w-[90%]" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={resetPasswordForm.control}
                  name="confirm_password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm New Password *</FormLabel>
                      <FormControl><Input type="password" placeholder="••••••••" {...field} className="w-[90%]" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter className="bg-card py-2 border-t px-3 sticky bottom-0 z-10">
                <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : "Reset Password"}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
