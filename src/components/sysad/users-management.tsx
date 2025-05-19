
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
import { createUserSysAd, listAllUsers, listTenants, getBranchesForTenantSimple, updateUserSysAd, archiveUser } from '@/actions/admin';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type UserFormValues = UserCreateData | UserUpdateDataSysAd;

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

export default function UsersManagement() {
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
    resolver: zodResolver(isEditing ? userUpdateSchemaSysAd : userCreateSchema),
    defaultValues: defaultFormValuesCreate,
  });

  const selectedTenantIdInForm = useWatch({ control: form.control, name: 'tenant_id' });

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [fetchedUsers, fetchedTenants] = await Promise.all([listAllUsers(), listTenants()]);
      setUsers(fetchedUsers);
      setTenants(fetchedTenants.filter(t => t.status === '1')); // Only active tenants for selection
    } catch (error) { 
      console.error("Failed to fetch user data:", error);
      toast({ title: "Error", description: "Could not fetch user data.", variant: "destructive" }); 
    }
    finally { setIsLoading(false); }
  }, [toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const currentIsEditing = !!selectedUser;
    const newResolver = zodResolver(currentIsEditing ? userUpdateSchemaSysAd : userCreateSchema);
    let newDefaults: UserFormValues;

    if (currentIsEditing && selectedUser) {
      newDefaults = {
        first_name: selectedUser.first_name,
        last_name: selectedUser.last_name,
        password: '', // Always empty for edit, user can choose to update
        email: selectedUser.email || '',
        role: selectedUser.role,
        tenant_id: selectedUser.tenant_id || undefined,
        tenant_branch_id: selectedUser.tenant_branch_id || undefined,
        status: selectedUser.status || '1',
      };
      if (selectedUser.tenant_id) {
        setIsLoadingBranches(true);
        getBranchesForTenantSimple(selectedUser.tenant_id)
          .then(branches => setAvailableBranches(branches))
          .catch(() => toast({ title: "Error", description: "Could not load branches for user's tenant.", variant: "destructive" }))
          .finally(() => setIsLoadingBranches(false));
      } else {
        setAvailableBranches([]);
      }
    } else {
      newDefaults = defaultFormValuesCreate;
      setAvailableBranches([]);
    }
    form.reset(newDefaults, { resolver: newResolver } as any); // Using 'as any' for resolver due to dynamic nature
  }, [selectedUser, form, toast]);


  useEffect(() => {
    const currentTenantId = typeof selectedTenantIdInForm === 'number' ? selectedTenantIdInForm : undefined;

    if (currentTenantId) {
      const isTenantChanged = isEditing && selectedUser && currentTenantId !== selectedUser.tenant_id;
      // Reset branch if tenant changes or if it's a new form and tenant is selected
      if (form.formState.dirtyFields.tenant_id || !isEditing || isTenantChanged) {
        form.setValue('tenant_branch_id', undefined, { shouldValidate: true });
      }
      setIsLoadingBranches(true);
      getBranchesForTenantSimple(currentTenantId)
        .then(branches => setAvailableBranches(branches))
        .catch(() => toast({ title: "Error", description: "Could not fetch branches for the selected tenant.", variant: "destructive" }))
        .finally(() => setIsLoadingBranches(false));
    } else if (!currentTenantId && (form.formState.dirtyFields.tenant_id || !isEditing)) {
      // Clear branches if tenant is cleared
      setAvailableBranches([]);
      if (form.getValues('tenant_branch_id')) { // Only reset if there was a value
          form.setValue('tenant_branch_id', undefined, { shouldValidate: true });
      }
    }
  }, [selectedTenantIdInForm, form, toast, isEditing, selectedUser]);


  const handleAddSubmit = async (data: UserCreateData) => {
    setIsSubmitting(true);
    const payload = {
      ...data,
      tenant_id: data.tenant_id ? Number(data.tenant_id) : null,
      tenant_branch_id: data.tenant_branch_id ? Number(data.tenant_branch_id) : null
    };
    try {
      const result = await createUserSysAd(payload);
      if (result.success && result.user) {
        toast({ title: "Success", description: "User created." });
        setIsAddDialogOpen(false);
        fetchData();
      } else {
        toast({ title: "Creation Failed", description: result.message, variant: "destructive" });
      }
    } catch (e) { 
      console.error("Add user error:", e);
      toast({ title: "Error", description: "Unexpected error during user creation.", variant: "destructive" }); 
    }
    finally { setIsSubmitting(false); }
  };

  const handleEditSubmit = async (data: UserUpdateDataSysAd) => {
    if (!selectedUser) return;
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
      const result = await updateUserSysAd(Number(selectedUser.id), payload as UserUpdateDataSysAd);
      if (result.success && result.user) {
        toast({ title: "Success", description: "User updated." });
        setIsEditDialogOpen(false);
        fetchData();
      } else {
        toast({ title: "Update Failed", description: result.message, variant: "destructive" });
      }
    } catch (e) { 
      console.error("Edit user error:", e);
      toast({ title: "Error", description: "Unexpected error during user update.", variant: "destructive" }); 
    }
    finally { setIsSubmitting(false); }
  };

  const handleArchive = async (userId: number, username: string) => {
    setIsSubmitting(true);
    try {
      const result = await archiveUser(userId);
      if (result.success) { toast({ title: "Success", description: `User "${username}" archived.` }); fetchData(); }
      else { toast({ title: "Archive Failed", description: result.message, variant: "destructive" }); }
    } catch (e) { 
      console.error("Archive user error:", e);
      toast({ title: "Error", description: "Unexpected error during archiving.", variant: "destructive" }); 
    }
    finally { setIsSubmitting(false); }
  };

  const handleRestore = async (user: User) => {
    setIsSubmitting(true);
    const payload: UserUpdateDataSysAd = {
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email || '',
      role: user.role,
      tenant_id: user.tenant_id,
      tenant_branch_id: user.tenant_branch_id,
      status: '1', // Explicitly setting status to '1' for restore
    };
    try {
      const result = await updateUserSysAd(Number(user.id), payload);
      if (result.success) {
        toast({ title: "Success", description: `User "${user.username}" restored.` });
        fetchData();
      } else {
        toast({ title: "Restore Failed", description: result.message, variant: "destructive" });
      }
    } catch (e) { 
      console.error("Restore user error:", e);
      toast({ title: "Error", description: "Unexpected error during restore.", variant: "destructive" }); 
    }
    finally { setIsSubmitting(false); }
  };

  const filteredUsers = users.filter(user => activeTab === "active" ? user.status === '1' : user.status === '0');

  if (isLoading && users.length === 0) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2 text-muted-foreground">Loading users...</p></div>;
  }

  const renderFormFields = () => {
    const usernameField = (() => {
      if (isEditing && selectedUser) {
        return (
          <FormItem>
            <FormLabel>Username (Read-only)</FormLabel>
            <FormControl><Input readOnly value={selectedUser.username} /></FormControl>
          </FormItem>
        );
      }
      return (
        <FormField
          control={form.control}
          name="username"
          render={(controllerRenderProps) => {
            const { field } = controllerRenderProps;
            return (
              <FormItem>
                <FormLabel>Username *</FormLabel>
                <FormControl><Input placeholder="johndoe" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            );
          }}
        />
      );
    })();

    return (
      <React.Fragment>
        <FormField
          control={form.control}
          name="first_name"
          render={(controllerRenderProps) => {
            const { field } = controllerRenderProps;
            return (
              <FormItem>
                <FormLabel>First Name *</FormLabel>
                <FormControl><Input placeholder="John" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            );
          }}
        />
        <FormField
          control={form.control}
          name="last_name"
          render={(controllerRenderProps) => {
            const { field } = controllerRenderProps;
            return (
              <FormItem>
                <FormLabel>Last Name *</FormLabel>
                <FormControl><Input placeholder="Doe" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            );
          }}
        />
        {usernameField}
        <FormField
          control={form.control}
          name="password"
          render={(controllerRenderProps) => {
            const { field } = controllerRenderProps;
            return (
              <FormItem>
                <FormLabel>{isEditing ? "New Password (Optional)" : "Password *"}</FormLabel>
                <FormControl><Input type="password" placeholder="••••••••" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            );
          }}
        />
        <FormField
          control={form.control}
          name="email"
          render={(controllerRenderProps) => {
            const { field } = controllerRenderProps;
            return (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl><Input type="email" placeholder="john.doe@example.com" {...field} value={field.value ?? ''} /></FormControl>
                <FormMessage />
              </FormItem>
            );
          }}
        />
        <FormField
          control={form.control}
          name="role"
          render={(controllerRenderProps) => {
            const { field } = controllerRenderProps;
            return (
              <FormItem>
                <FormLabel>Role *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="staff">Staff</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="sysad">SysAd</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            );
          }}
        />
        <FormField
          control={form.control}
          name="tenant_id"
          render={(controllerRenderProps) => {
            const { field } = controllerRenderProps;
            return (
              <FormItem>
                <FormLabel>Tenant</FormLabel>
                <Select onValueChange={(v) => field.onChange(v ? parseInt(v) : undefined)} value={field.value?.toString()}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Assign to tenant (Optional)" /></SelectTrigger></FormControl>
                  <SelectContent>{tenants.map(t => <SelectItem key={t.id} value={t.id.toString()}>{t.tenant_name}</SelectItem>)}</SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            );
          }}
        />
        <FormField
          control={form.control}
          name="tenant_branch_id"
          render={(controllerRenderProps) => {
            const { field } = controllerRenderProps;
            return (
              <FormItem>
                <FormLabel>Branch</FormLabel>
                <Select
                  onValueChange={(v) => field.onChange(v ? parseInt(v) : undefined)}
                  value={field.value?.toString()}
                  disabled={!selectedTenantIdInForm || isLoadingBranches || availableBranches.length === 0}
                >
                  <FormControl><SelectTrigger><SelectValue placeholder={isLoadingBranches ? "Loading branches..." : !selectedTenantIdInForm ? "Select tenant first" : availableBranches.length === 0 ? "No branches for tenant" : "Assign to branch (Optional)"} /></SelectTrigger></FormControl>
                  <SelectContent>{availableBranches.map(b => <SelectItem key={b.id} value={b.id.toString()}>{b.branch_name}</SelectItem>)}</SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            );
          }}
        />
        {isEditing && (
          <FormField
            control={form.control}
            name="status"
            render={(controllerRenderProps) => {
              const { field } = controllerRenderProps;
              return (
                <FormItem>
                  <FormLabel>Status *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value?.toString()}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="1">Active</SelectItem>
                      <SelectItem value="0">Archived</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              );
            }}
          />
        )}
      </React.Fragment>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div><div className="flex items-center space-x-2"><UsersIcon className="h-6 w-6 text-primary" /><CardTitle>Users Management</CardTitle></div><CardDescription>Manage system users, roles, and assignments.</CardDescription></div>
        <Dialog
            key={isEditing ? `edit-user-${selectedUser?.id}` : 'add-user'}
            open={isAddDialogOpen || isEditDialogOpen}
            onOpenChange={(open) => {
                if (!open) {
                    setIsAddDialogOpen(false);
                    setIsEditDialogOpen(false);
                    setSelectedUser(null); // This will trigger the useEffect to reset the form
                } else {
                    if (isEditing && selectedUser) { // If opening for edit
                         // useEffect will handle form reset
                    } else { // If opening for add
                        setSelectedUser(null); // Ensure form resets to add mode
                        setIsAddDialogOpen(true);
                    }
                }
            }}
        >
          <DialogTrigger asChild>
            <Button onClick={() => {
              setSelectedUser(null); // Explicitly set to null to ensure "add" mode
              setIsAddDialogOpen(true);
            }}><PlusCircle className="mr-2 h-4 w-4" /> Add User</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader><DialogTitle>{isEditing ? `Edit User: ${selectedUser?.username}` : 'Add New User'}</DialogTitle></DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(isEditing ? (d => handleEditSubmit(d as UserUpdateDataSysAd)) : (d => handleAddSubmit(d as UserCreateData)))} className="space-y-4 py-4 max-h-[70vh] overflow-y-auto pr-2">
                {renderFormFields()}
                <DialogFooter className="sticky bottom-0 bg-background py-4 border-t z-10">
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
            {isLoading && filteredUsers.length === 0 && <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-primary" /><p className="ml-2 text-muted-foreground">Loading...</p></div>}
            {!isLoading && filteredUsers.length === 0 && <p className="text-muted-foreground text-center py-8">No active users found.</p>}
            {!isLoading && filteredUsers.length > 0 && (
              <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Username</TableHead><TableHead>Role</TableHead><TableHead>Tenant</TableHead><TableHead>Branch</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>{filteredUsers.map(u => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.first_name} {u.last_name}</TableCell><TableCell>{u.username}</TableCell><TableCell>{u.role}</TableCell><TableCell>{u.tenant_name || 'N/A'}</TableCell><TableCell>{u.branch_name || 'N/A'}</TableCell>
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
            {isLoading && filteredUsers.length === 0 && <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-primary" /><p className="ml-2 text-muted-foreground">Loading...</p></div>}
            {!isLoading && filteredUsers.length === 0 && <p className="text-muted-foreground text-center py-8">No archived users found.</p>}
            {!isLoading && filteredUsers.length > 0 && (
              <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Username</TableHead><TableHead>Role</TableHead><TableHead>Tenant</TableHead><TableHead>Branch</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>{filteredUsers.map(u => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.first_name} {u.last_name}</TableCell><TableCell>{u.username}</TableCell><TableCell>{u.role}</TableCell><TableCell>{u.tenant_name || 'N/A'}</TableCell><TableCell>{u.branch_name || 'N/A'}</TableCell>
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


    