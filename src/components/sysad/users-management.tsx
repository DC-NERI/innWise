
"use client";

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
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

  const form = useForm<UserFormValues>({
    resolver: zodResolver(selectedUser ? userUpdateSchemaSysAd : userCreateSchema),
    defaultValues: {
      first_name: '', last_name: '', username: '', password: '', email: '',
      role: 'staff', tenant_id: undefined, tenant_branch_id: undefined,
      status: '1', // For update schema
    },
  });

  const selectedTenantId = useWatch({ control: form.control, name: 'tenant_id' });

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [fetchedUsers, fetchedTenants] = await Promise.all([listAllUsers(), listTenants()]);
      setUsers(fetchedUsers);
      setTenants(fetchedTenants.filter(t => t.status === '1')); // Only active tenants for selection
    } catch (error) { toast({ title: "Error", description: "Could not fetch data.", variant: "destructive" }); }
    finally { setIsLoading(false); }
  }, [toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (isEditDialogOpen && selectedUser && selectedUser.tenant_id) {
        setIsLoadingBranches(true);
        getBranchesForTenantSimple(selectedUser.tenant_id)
            .then(branches => setAvailableBranches(branches))
            .catch(() => toast({ title: "Error", description: "Could not load branches for user's tenant.", variant: "destructive"}))
            .finally(() => setIsLoadingBranches(false));
    }
  }, [isEditDialogOpen, selectedUser, toast]);
  
  useEffect(() => {
    // Reset branch when tenant changes in form, only if not triggered by initially setting selectedUser
    if (form.formState.isDirty || (isAddDialogOpen && !selectedUser)) { // check if form is dirty or it's add dialog
        form.setValue('tenant_branch_id', undefined);
        setAvailableBranches([]);
    }

    if (selectedTenantId && typeof selectedTenantId === 'number' && (form.formState.isDirty || (isAddDialogOpen && !selectedUser))) {
      setIsLoadingBranches(true);
      getBranchesForTenantSimple(selectedTenantId)
        .then(branches => setAvailableBranches(branches))
        .catch(() => toast({ title: "Error", description: "Could not fetch branches.", variant: "destructive" }))
        .finally(() => setIsLoadingBranches(false));
    }
  }, [selectedTenantId, form, toast, isAddDialogOpen, selectedUser]);


  useEffect(() => {
    if (selectedUser) {
      form.reset({
        first_name: selectedUser.first_name,
        last_name: selectedUser.last_name,
        // username: selectedUser.username, // Not editable
        password: '', // Password should be empty for edit, or handle it differently
        email: selectedUser.email || '',
        role: selectedUser.role,
        tenant_id: selectedUser.tenant_id || undefined,
        tenant_branch_id: selectedUser.tenant_branch_id || undefined,
        status: selectedUser.status || '1',
      } as UserUpdateDataSysAd);
    } else {
      form.reset({
        first_name: '', last_name: '', username: '', password: '', email: '',
        role: 'staff', tenant_id: undefined, tenant_branch_id: undefined, status: '1',
      } as UserCreateData);
    }
  }, [selectedUser, form, isEditDialogOpen, isAddDialogOpen]);

  const handleAddSubmit = async (data: UserCreateData) => {
    setIsSubmitting(true);
    const payload = { ...data, tenant_id: data.tenant_id ? Number(data.tenant_id) : null, tenant_branch_id: data.tenant_branch_id ? Number(data.tenant_branch_id) : null };
    try {
      const result = await createUserSysAd(payload);
      if (result.success) { toast({ title: "Success", description: "User created." }); form.reset(); setIsAddDialogOpen(false); setAvailableBranches([]); fetchData(); }
      else { toast({ title: "Creation Failed", description: result.message, variant: "destructive" }); }
    } catch (e) { toast({ title: "Error", description: "Unexpected error.", variant: "destructive" }); }
    finally { setIsSubmitting(false); }
  };

  const handleEditSubmit = async (data: UserUpdateDataSysAd) => {
    if (!selectedUser) return;
    setIsSubmitting(true);
    const payload = { ...data, tenant_id: data.tenant_id ? Number(data.tenant_id) : null, tenant_branch_id: data.tenant_branch_id ? Number(data.tenant_branch_id) : null };
    if (payload.password === '' || payload.password === null) delete payload.password; // Don't send empty password
    try {
      const result = await updateUserSysAd(Number(selectedUser.id), payload);
      if (result.success) { toast({ title: "Success", description: "User updated." }); form.reset(); setIsEditDialogOpen(false); setSelectedUser(null); setAvailableBranches([]); fetchData(); }
      else { toast({ title: "Update Failed", description: result.message, variant: "destructive" }); }
    } catch (e) { toast({ title: "Error", description: "Unexpected error.", variant: "destructive" }); }
    finally { setIsSubmitting(false); }
  };

  const handleArchive = async (userId: number) => {
    setIsSubmitting(true);
    try {
      const result = await archiveUser(userId);
      if (result.success) { toast({ title: "Success", description: result.message }); fetchData(); }
      else { toast({ title: "Archive Failed", description: result.message, variant: "destructive" }); }
    } catch (e) { toast({ title: "Error", description: "Unexpected error.", variant: "destructive" }); }
    finally { setIsSubmitting(false); }
  };

  const handleRestore = async (user: User) => {
    setIsSubmitting(true);
    const payload: UserUpdateDataSysAd = {
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: user.role,
        tenant_id: user.tenant_id,
        tenant_branch_id: user.tenant_branch_id,
        status: '1',
    };
    try {
        const result = await updateUserSysAd(Number(user.id), payload);
        if (result.success) {
            toast({ title: "Success", description: "User restored successfully." });
            fetchData();
        } else {
            toast({ title: "Restore Failed", description: result.message, variant: "destructive" });
        }
    } catch (e) { toast({ title: "Error", description: "Unexpected error.", variant: "destructive" }); }
    finally { setIsSubmitting(false); }
  };


  const filteredUsers = users.filter(user => activeTab === "active" ? user.status === '1' : user.status === '0');

  if (isLoading && users.length === 0) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2">Loading...</p></div>;
  }

  const renderFormFields = (isEditing: boolean) => (
    <>
      <FormField control={form.control} name="first_name" render={({ field }) => (<FormItem><FormLabel>First Name *</FormLabel><FormControl><Input placeholder="John" {...field} /></FormControl><FormMessage /></FormItem>)} />
      <FormField control={form.control} name="last_name" render={({ field }) => (<FormItem><FormLabel>Last Name *</FormLabel><FormControl><Input placeholder="Doe" {...field} /></FormControl><FormMessage /></FormItem>)} />
      {isEditing && selectedUser ? ( <FormItem><FormLabel>Username (Read-only)</FormLabel><FormControl><Input readOnly value={selectedUser.username} /></FormControl></FormItem>) : 
        (<FormField control={form.control} name="username" render={({ field }) => (<FormItem><FormLabel>Username *</FormLabel><FormControl><Input placeholder="johndoe" {...field} /></FormControl><FormMessage /></FormItem>)} />)}
      <FormField control={form.control} name="password" render={({ field }) => (<FormItem><FormLabel>{isEditing ? "New Password (Optional)" : "Password *"}</FormLabel><FormControl><Input type="password" placeholder="••••••••" {...field} /></FormControl><FormMessage /></FormItem>)} />
      <FormField control={form.control} name="email" render={({ field }) => (<FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" placeholder="john.doe@example.com" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
      <FormField control={form.control} name="role" render={({ field }) => (<FormItem><FormLabel>Role *</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger></FormControl><SelectContent><SelectItem value="staff">Staff</SelectItem><SelectItem value="admin">Admin</SelectItem><SelectItem value="sysad">SysAd</SelectItem></SelectContent></Select><FormMessage /></FormItem>)} />
      <FormField control={form.control} name="tenant_id"
        render={({ field }) => (
          <FormItem><FormLabel>Tenant</FormLabel>
            <Select onValueChange={(v) => field.onChange(v ? parseInt(v) : undefined)} value={field.value?.toString()}>
              <FormControl><SelectTrigger><SelectValue placeholder="Assign to tenant" /></SelectTrigger></FormControl>
              <SelectContent>{tenants.map(t => <SelectItem key={t.id} value={t.id.toString()}>{t.tenant_name}</SelectItem>)}</SelectContent>
            </Select><FormMessage />
          </FormItem>
        )}
      />
      <FormField control={form.control} name="tenant_branch_id"
        render={({ field }) => (
          <FormItem><FormLabel>Branch</FormLabel>
            <Select onValueChange={(v) => field.onChange(v ? parseInt(v) : undefined)} value={field.value?.toString()} disabled={!selectedTenantId || isLoadingBranches || availableBranches.length === 0}>
              <FormControl><SelectTrigger><SelectValue placeholder={isLoadingBranches ? "Loading..." : !selectedTenantId ? "Select tenant first" : availableBranches.length === 0 ? "No branches" : "Assign to branch"} /></SelectTrigger></FormControl>
              <SelectContent>{availableBranches.map(b => <SelectItem key={b.id} value={b.id.toString()}>{b.branch_name}</SelectItem>)}</SelectContent>
            </Select><FormMessage />
          </FormItem>
        )}
      />
      {isEditing && (
        <FormField control={form.control} name="status" render={({ field }) => (
          <FormItem><FormLabel>Status *</FormLabel>
            <Select onValueChange={field.onChange} value={field.value?.toString()}>
              <FormControl><SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger></FormControl>
              <SelectContent><SelectItem value="1">Active</SelectItem><SelectItem value="0">Archived</SelectItem></SelectContent>
            </Select><FormMessage />
          </FormItem>
        )}
      )}
    </>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div><div className="flex items-center space-x-2"><UsersIcon className="h-6 w-6 text-primary" /><CardTitle>Users Management</CardTitle></div><CardDescription>Manage system users.</CardDescription></div>
        <Dialog open={isAddDialogOpen} onOpenChange={(open) => {setIsAddDialogOpen(open); if (!open) {form.reset(); setAvailableBranches([]);}}}>
          <DialogTrigger asChild><Button onClick={() => {setSelectedUser(null); setIsAddDialogOpen(true);}}><PlusCircle className="mr-2 h-4 w-4" /> Add User</Button></DialogTrigger>
          <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Add New User</DialogTitle></DialogHeader>
            <Form {...form}><form onSubmit={form.handleSubmit(d => handleAddSubmit(d as UserCreateData))} className="space-y-4 py-4 max-h-[70vh] overflow-y-auto pr-2">{renderFormFields(false)}
              <DialogFooter className="sticky bottom-0 bg-background py-4 border-t"><DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose><Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : "Create User"}</Button></DialogFooter>
            </form></Form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4"><TabsTrigger value="active">Active</TabsTrigger><TabsTrigger value="archive">Archive</TabsTrigger></TabsList>
          <TabsContent value="active">
            {isLoading && <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
            {!isLoading && filteredUsers.length === 0 && <p className="text-muted-foreground text-center py-8">No active users found.</p>}
            {!isLoading && filteredUsers.length > 0 && (
            <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Username</TableHead><TableHead>Role</TableHead><TableHead>Tenant</TableHead><TableHead>Branch</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>{filteredUsers.map(u => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.first_name} {u.last_name}</TableCell><TableCell>{u.username}</TableCell><TableCell>{u.role}</TableCell><TableCell>{u.tenant_name || 'N/A'}</TableCell><TableCell>{u.branch_name || 'N/A'}</TableCell>
                  <TableCell className="text-right space-x-2">
                    <Dialog open={isEditDialogOpen && selectedUser?.id === u.id} onOpenChange={(open) => {if(!open){setSelectedUser(null); setAvailableBranches([]);} setIsEditDialogOpen(open);}}>
                      <DialogTrigger asChild><Button variant="outline" size="sm" onClick={() => {setSelectedUser(u); setIsEditDialogOpen(true);}}><Edit className="mr-1 h-3 w-3" /> Edit</Button></DialogTrigger>
                      <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Edit User: {selectedUser?.username}</DialogTitle></DialogHeader>
                        <Form {...form}><form onSubmit={form.handleSubmit(d => handleEditSubmit(d as UserUpdateDataSysAd))} className="space-y-4 py-4 max-h-[70vh] overflow-y-auto pr-2">{renderFormFields(true)}
                          <DialogFooter className="sticky bottom-0 bg-background py-4 border-t"><DialogClose asChild><Button type="button" variant="outline" onClick={() => {setSelectedUser(null); setAvailableBranches([]);}}>Cancel</Button></DialogClose><Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : "Save Changes"}</Button></DialogFooter>
                        </form></Form>
                      </DialogContent>
                    </Dialog>
                    <AlertDialog><AlertDialogTrigger asChild><Button variant="destructive" size="sm" disabled={isSubmitting}><Trash2 className="mr-1 h-3 w-3" /> Archive</Button></AlertDialogTrigger>
                      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Confirm Archive</AlertDialogTitle><AlertDialogDescription>Archive user "{u.username}"?</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleArchive(Number(u.id))} disabled={isSubmitting}>Archive</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>))}
              </TableBody>
            </Table></Table>)}
          </TabsContent>
          <TabsContent value="archive">
            {isLoading && <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
            {!isLoading && filteredUsers.length === 0 && <p className="text-muted-foreground text-center py-8">No archived users found.</p>}
            {!isLoading && filteredUsers.length > 0 && (
            <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Username</TableHead><TableHead>Role</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>{filteredUsers.map(u => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.first_name} {u.last_name}</TableCell><TableCell>{u.username}</TableCell><TableCell>{u.role}</TableCell>
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
