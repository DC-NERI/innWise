
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { Loader2, PlusCircle, Users as UsersIcon, Edit, Trash2, ArchiveRestore } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { userCreateSchema, UserCreateData, userUpdateSchemaSysAd, UserUpdateDataSysAd } from '@/lib/schemas';
import type { User, Tenant, SimpleBranch } from '@/lib/types';
import { createUserSysAd } from '@/actions/admin/users/createUserSysAd';
import { listAllUsers } from '@/actions/admin/users/listAllUsers';
import { updateUserSysAd } from '@/actions/admin/users/updateUserSysAd';
import { archiveUser } from '@/actions/admin/users/archiveUser';
import { listTenants } from '@/actions/admin/tenants/listTenants';
import { getBranchesForTenantSimple } from '@/actions/admin/branches/getBranchesForTenantSimple';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HOTEL_ENTITY_STATUS } from '@/lib/constants';
import { format, parseISO } from 'date-fns';

type UserFormValues = UserCreateData | UserUpdateDataSysAd;

interface UsersManagementProps {
  sysAdUserId: number | null;
}

const defaultFormValuesCreate: UserCreateData = {
  first_name: '',
  last_name: '',
  username: '',
  password: '',
  email: '',
  role: 'staff',
  tenant_id: undefined,
  tenant_branch_id: undefined,
};

export default function UsersManagement({ sysAdUserId }: UsersManagementProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [availableBranches, setAvailableBranches] = useState<SimpleBranch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [activeTab, setActiveTab] = useState("active");
  const { toast } = useToast();

  const isEditing = !!selectedUser;

  const form = useForm<UserFormValues>({
    // Resolver and defaultValues are set dynamically in useEffect
  });

  const selectedTenantIdInForm = useWatch({ control: form.control, name: 'tenant_id' });
  const selectedRoleInForm = useWatch({ control: form.control, name: 'role' });


  const fetchInitialData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [fetchedUsers, fetchedTenants] = await Promise.all([listAllUsers(), listTenants()]);
      setUsers(fetchedUsers);
      setTenants(fetchedTenants.filter(t => t.status === HOTEL_ENTITY_STATUS.ACTIVE));
    } catch (error) {
      console.error("Error fetching initial data for SysAd Users Management:", error);
      toast({ title: "Error fetching data", description: "Could not fetch user or tenant data.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  useEffect(() => {
    const currentIsEditing = !!selectedUser;
    const newResolver = zodResolver(currentIsEditing ? userUpdateSchemaSysAd : userCreateSchema);
    let newDefaults: UserFormValues;

    if (currentIsEditing && selectedUser) {
      newDefaults = {
        first_name: selectedUser.first_name,
        last_name: selectedUser.last_name,
        password: '',
        email: selectedUser.email || '',
        role: selectedUser.role,
        tenant_id: selectedUser.tenant_id || undefined,
        tenant_branch_id: selectedUser.tenant_branch_id || undefined,
        status: selectedUser.status || HOTEL_ENTITY_STATUS.ACTIVE,
      };
      if (selectedUser.tenant_id) {
        setIsLoadingBranches(true);
        getBranchesForTenantSimple(selectedUser.tenant_id)
          .then(branches => setAvailableBranches(branches.filter(b => b.status === HOTEL_ENTITY_STATUS.ACTIVE)))
          .catch(() => toast({ title: "Error", description: "Could not load branches for user's tenant.", variant: "destructive" }))
          .finally(() => setIsLoadingBranches(false));
      } else {
        setAvailableBranches([]);
      }
    } else {
      newDefaults = { ...defaultFormValuesCreate };
      setAvailableBranches([]);
    }
    form.reset(newDefaults, { resolver: newResolver } as any);
  }, [selectedUser, form, toast, isAddDialogOpen, isEditDialogOpen]);


  useEffect(() => {
    const currentTenantId = typeof selectedTenantIdInForm === 'number' ? selectedTenantIdInForm : selectedTenantIdInForm && typeof selectedTenantIdInForm === 'string' ? parseInt(selectedTenantIdInForm) : undefined;
    const isDirtyTenant = form.formState.dirtyFields.tenant_id;
    const currentBranchId = form.getValues('tenant_branch_id');

    if (currentTenantId) {
      if (isDirtyTenant || (isEditing && selectedUser && currentTenantId !== selectedUser.tenant_id)) {
        if (currentBranchId) form.setValue('tenant_branch_id', undefined, { shouldValidate: true });
      }
      setIsLoadingBranches(true);
      getBranchesForTenantSimple(currentTenantId)
        .then(branches => {
          const activeBranches = branches.filter(b => b.status === HOTEL_ENTITY_STATUS.ACTIVE);
          setAvailableBranches(activeBranches);
          const currentBranchIsValid = activeBranches.some(b => b.id === currentBranchId);
          if (currentBranchId && !currentBranchIsValid && (isDirtyTenant || !isEditing)) {
            form.setValue('tenant_branch_id', undefined, { shouldValidate: true });
          }
        })
        .catch(() => toast({ title: "Error", description: "Could not fetch branches for the selected tenant.", variant: "destructive" }))
        .finally(() => setIsLoadingBranches(false));
    } else {
      setAvailableBranches([]);
      if (form.getValues('tenant_branch_id')) {
        form.setValue('tenant_branch_id', undefined, { shouldValidate: true });
      }
    }
  }, [selectedTenantIdInForm, form, toast, isEditing, selectedUser]);


  const handleAddSubmit = async (data: UserCreateData) => {
    if (!sysAdUserId) {
      toast({ title: "Error", description: "SysAd User ID not available for logging.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    const payload = {
      ...data,
      tenant_id: data.tenant_id ? Number(data.tenant_id) : null,
      tenant_branch_id: data.tenant_branch_id ? Number(data.tenant_branch_id) : null
    };
    try {
      const result = await createUserSysAd(payload, sysAdUserId);
      if (result.success && result.user) {
        toast({ title: "Success", description: "User created." });
        setUsers(prev => [...prev, result.user!].sort((a, b) => (a.last_name || '').localeCompare(b.last_name || '')));
        setIsAddDialogOpen(false);
      } else {
        toast({ title: "Creation Failed", description: result.message, variant: "destructive" });
      }
    } catch (e) {
      const error = e as Error;
      toast({ title: "Error", description: error.message || "Unexpected error during user creation.", variant: "destructive" });
    }
    finally { setIsSubmitting(false); }
  };

  const handleEditSubmit = async (data: UserUpdateDataSysAd) => {
    if (!selectedUser || !sysAdUserId) {
      toast({ title: "Error", description: "Selected user or SysAd User ID not available.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);

    let payload: Partial<UserUpdateDataSysAd> = {
      ...data,
      tenant_id: data.tenant_id ? Number(data.tenant_id) : null,
      tenant_branch_id: data.tenant_branch_id ? Number(data.tenant_branch_id) : null
    };

    if (data.password === '' || data.password === null || data.password === undefined) {
      delete payload.password;
    }

    try {
      const result = await updateUserSysAd(Number(selectedUser.id), payload as UserUpdateDataSysAd, sysAdUserId);
      if (result.success && result.user) {
        toast({ title: "Success", description: "User updated." });
        setUsers(prev => prev.map(u => u.id === result.user!.id ? result.user! : u).sort((a, b) => (a.last_name || '').localeCompare(b.last_name || '')));
        setIsEditDialogOpen(false);
        setSelectedUser(null);
      } else {
        toast({ title: "Update Failed", description: result.message, variant: "destructive" });
      }
    } catch (e) {
      const error = e as Error;
      toast({ title: "Error", description: error.message || "Unexpected error during user update.", variant: "destructive" });
    }
    finally { setIsSubmitting(false); }
  };

  const handleArchive = async (userId: number, username: string) => {
    if (!sysAdUserId) {
      toast({ title: "Error", description: "SysAd User ID not available.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await archiveUser(userId, sysAdUserId);
      if (result.success) {
        toast({ title: "Success", description: `User "${username}" archived.` });
        setUsers(prev => prev.map(u => Number(u.id) === userId ? { ...u, status: HOTEL_ENTITY_STATUS.ARCHIVED } : u));
      }
      else { toast({ title: "Archive Failed", description: result.message, variant: "destructive" }); }
    } catch (e) {
      const error = e as Error;
      toast({ title: "Error", description: error.message || "Unexpected error during archiving.", variant: "destructive" });
    }
    finally { setIsSubmitting(false); }
  };

  const handleRestore = async (user: User) => {
    if (!sysAdUserId) {
      toast({ title: "Error", description: "SysAd User ID not available.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    const payload: UserUpdateDataSysAd = {
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email || '',
      role: user.role,
      tenant_id: user.tenant_id,
      tenant_branch_id: user.tenant_branch_id,
      status: HOTEL_ENTITY_STATUS.ACTIVE,
    };
    try {
      const result = await updateUserSysAd(Number(user.id), payload, sysAdUserId);
      if (result.success && result.user) {
        toast({ title: "Success", description: `User "${user.username}" restored.` });
        setUsers(prev => prev.map(u => u.id === result.user!.id ? result.user! : u));
      } else {
        toast({ title: "Restore Failed", description: result.message, variant: "destructive" });
      }
    } catch (e) {
      const error = e as Error;
      toast({ title: "Error", description: error.message || "Unexpected error during restore.", variant: "destructive" });
    }
    finally { setIsSubmitting(false); }
  };

  const filteredUsers = users.filter(user => user.status === (activeTab === "active" ? HOTEL_ENTITY_STATUS.ACTIVE : HOTEL_ENTITY_STATUS.ARCHIVED));

  const renderFormFields = () => {
    const usernameField = isEditing && selectedUser ? (
      <FormItem>
        <FormLabel>Username (Read-only)</FormLabel>
        <FormControl><Input readOnly value={selectedUser.username} className="w-[90%]" /></FormControl>
      </FormItem>
    ) : (
      <FormField
        control={form.control}
        name="username"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Username *</FormLabel>
            <FormControl><Input placeholder="johndoe" {...field} className="w-[90%]" /></FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    );

    return (
      <React.Fragment>
        <FormField control={form.control} name="first_name" render={({ field }) => (
          <FormItem><FormLabel>First Name *</FormLabel><FormControl><Input placeholder="John" {...field} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={form.control} name="last_name" render={({ field }) => (
          <FormItem><FormLabel>Last Name *</FormLabel><FormControl><Input placeholder="Doe" {...field} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
        )} />
        {usernameField}
        <FormField control={form.control} name="password" render={({ field }) => (
          <FormItem><FormLabel>{isEditing ? "New Password (Optional)" : "Password *"}</FormLabel><FormControl><Input type="password" placeholder="••••••••" {...field} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={form.control} name="email" render={({ field }) => (
          <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" placeholder="john.doe@example.com" {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={form.control} name="role"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Role *</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder="Select role" /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectItem value="staff">Staff</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="sysad">SysAd</SelectItem>
                  <SelectItem value="housekeeping">Housekeeping</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField control={form.control} name="tenant_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tenant {selectedRoleInForm === 'staff' || selectedRoleInForm === 'admin' || selectedRoleInForm === 'housekeeping' ? '*' : '(Optional)'}</FormLabel>
              <Select onValueChange={(v) => field.onChange(v ? parseInt(v) : undefined)} value={field.value?.toString()}>
                <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder={selectedRoleInForm === 'staff' || selectedRoleInForm === 'admin' || selectedRoleInForm === 'housekeeping' ? "Select tenant *" : "Assign to tenant (Optional)"} /></SelectTrigger></FormControl>
                <SelectContent>{tenants.map(t => <SelectItem key={t.id} value={t.id.toString()}>{t.tenant_name}</SelectItem>)}</SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField control={form.control} name="tenant_branch_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Branch {selectedRoleInForm === 'staff' || selectedRoleInForm === 'housekeeping' ? '*' : '(Optional)'}</FormLabel>
              <Select
                onValueChange={(v) => field.onChange(v ? parseInt(v) : undefined)}
                value={field.value?.toString()}
                disabled={!selectedTenantIdInForm || isLoadingBranches || availableBranches.length === 0}
              >
                <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder={isLoadingBranches ? "Loading branches..." : !selectedTenantIdInForm ? "Select tenant first" : availableBranches.length === 0 ? "No active branches for tenant" : (selectedRoleInForm === 'staff' || selectedRoleInForm === 'housekeeping' ? "Select branch *" : "Assign to branch (Optional)")} /></SelectTrigger></FormControl>
                <SelectContent>{availableBranches.map(b => <SelectItem key={b.id} value={b.id.toString()}>{b.branch_name}</SelectItem>)}</SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        {isEditing && (
          <FormField control={form.control} name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Status *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value?.toString()}>
                  <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder="Select status" /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value={HOTEL_ENTITY_STATUS.ACTIVE}>Active</SelectItem>
                    <SelectItem value={HOTEL_ENTITY_STATUS.ARCHIVED}>Archived</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
      </React.Fragment>
    );
  };

  if (isLoading && users.length === 0) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2 text-muted-foreground">Loading users...</p></div>;
  }
  if (!sysAdUserId) {
    return <Card><CardHeader><CardTitle>User Management</CardTitle><CardDescription>SysAd User ID not available.</CardDescription></CardHeader><CardContent><p>Cannot load user management without a valid System Administrator identifier.</p></CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <UsersIcon className="h-6 w-6 text-primary" />
            <CardTitle>Users Management</CardTitle>
          </div>
          <CardDescription>Manage all system users, roles, and assignments.</CardDescription>
        </div>
        <Dialog
          key={isEditing ? `edit-user-sysad-${selectedUser?.id}` : 'add-user-sysad'}
          open={isAddDialogOpen || isEditDialogOpen}
          onOpenChange={(open) => {
            if (!open) {
              setIsAddDialogOpen(false);
              setIsEditDialogOpen(false);
              setSelectedUser(null);
              setAvailableBranches([]);
              form.reset({ ...defaultFormValuesCreate, role: 'staff' } as UserCreateData, { resolver: zodResolver(userCreateSchema) } as any);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button onClick={() => {
              setSelectedUser(null);
              form.reset({ ...defaultFormValuesCreate, role: 'staff' } as UserCreateData, { resolver: zodResolver(userCreateSchema) } as any);
              setIsAddDialogOpen(true);
              setIsEditDialogOpen(false);
            }}><PlusCircle className="mr-2 h-4 w-4" /> Add User</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg p-3 flex flex-col max-h-[85vh]">
            <DialogHeader className="p-2 border-b"><DialogTitle>{isEditing ? `Edit User: ${selectedUser?.username}` : 'Add New User'}</DialogTitle></DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(isEditing ? (d => handleEditSubmit(d as UserUpdateDataSysAd)) : (d => handleAddSubmit(d as UserCreateData)))} className="bg-card rounded-md flex flex-col flex-grow overflow-hidden">
                <div className="flex-grow space-y-3 p-1 overflow-y-auto">
                  {renderFormFields()}
                </div>
                <DialogFooter className="bg-card py-2 border-t px-3 sticky bottom-0 z-10">
                  <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                  <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : (isEditing ? "Save Changes" : "Create User")}</Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4"><TabsTrigger value="active">Active</TabsTrigger><TabsTrigger value="archive">Archive</TabsTrigger></TabsList>
          <TabsContent value="active">
            {isLoading && filteredUsers.length === 0 && <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
            {!isLoading && filteredUsers.length === 0 && <p className="text-muted-foreground text-center py-8">No active users found.</p>}
            {!isLoading && filteredUsers.length > 0 && (
              <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Username</TableHead><TableHead>Role</TableHead><TableHead>Tenant</TableHead><TableHead>Branch</TableHead><TableHead>Last Login</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>{filteredUsers.map(u => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.first_name} {u.last_name}</TableCell><TableCell>{u.username}</TableCell><TableCell className="capitalize">{u.role}</TableCell><TableCell>{u.tenant_name || 'N/A'}</TableCell><TableCell>{u.branch_name || 'N/A'}</TableCell>
                    <TableCell>{u.last_log_in ? format(parseISO(u.last_log_in), 'yyyy-MM-dd hh:mm aa') : 'N/A'}</TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button variant="outline" size="sm" onClick={() => { setSelectedUser(u); setIsEditDialogOpen(true); setIsAddDialogOpen(false); }}><Edit className="mr-1 h-3 w-3" /> Edit</Button>
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
            {isLoading && filteredUsers.length === 0 && <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
            {!isLoading && filteredUsers.length === 0 && <p className="text-muted-foreground text-center py-8">No archived users found.</p>}
            {!isLoading && filteredUsers.length > 0 && (
              <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Username</TableHead><TableHead>Role</TableHead><TableHead>Tenant</TableHead><TableHead>Branch</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>{filteredUsers.map(u => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.first_name} {u.last_name}</TableCell><TableCell>{u.username}</TableCell><TableCell className="capitalize">{u.role}</TableCell><TableCell>{u.tenant_name || 'N/A'}</TableCell><TableCell>{u.branch_name || 'N/A'}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => handleRestore(u)} disabled={isSubmitting}><ArchiveRestore className="mr-1 h-3 w-3" /> Restore</Button>
                    </TableCell>
                  </TableRow>))}
                </TableBody>
              </Table>)}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

    