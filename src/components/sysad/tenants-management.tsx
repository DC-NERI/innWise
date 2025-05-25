
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { listTenants } from '@/actions/admin/tenants/listTenants';
import { createTenant } from '@/actions/admin/tenants/createTenant';
import { updateTenant } from '@/actions/admin/tenants/updateTenant';
import { archiveTenant } from '@/actions/admin/tenants/archiveTenant';
import type { Tenant } from '@/lib/types';
import { tenantCreateSchema, TenantCreateData, tenantUpdateSchema, TenantUpdateData } from '@/lib/schemas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { Loader2, PlusCircle, Building2, Edit, Trash2, ArchiveRestore } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { HOTEL_ENTITY_STATUS } from '@/lib/constants';

type TenantFormValues = TenantCreateData | TenantUpdateData;

const defaultFormValuesCreate: TenantCreateData = {
  tenant_name: '',
  tenant_address: '',
  tenant_email: '',
  tenant_contact_info: '',
  max_branch_count: 5,
  max_user_count: 10,
};

interface TenantsManagementProps {
  sysAdUserId: number | null;
}

export default function TenantsManagement({ sysAdUserId }: TenantsManagementProps) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [activeTab, setActiveTab] = useState("active");
  const { toast } = useToast();

  const isEditing = !!selectedTenant;

  const form = useForm<TenantFormValues>({
    resolver: zodResolver(isEditing ? tenantUpdateSchema : tenantCreateSchema),
    defaultValues: {
      ...defaultFormValuesCreate,
      status: HOTEL_ENTITY_STATUS.ACTIVE,
    },
  });

  const fetchTenants = useCallback(async () => {
    setIsLoading(true);
    try {
      const fetchedTenants = await listTenants();
      setTenants(fetchedTenants);
    } catch (error) {
      toast({
        title: "Error",
        description: "Could not fetch tenants. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchTenants();
  }, [fetchTenants]);

  useEffect(() => {
    const currentIsEditing = !!selectedTenant;
    const newResolver = zodResolver(currentIsEditing ? tenantUpdateSchema : tenantCreateSchema);
    let newDefaults: TenantFormValues;

    if (currentIsEditing && selectedTenant) {
      newDefaults = {
        tenant_name: selectedTenant.tenant_name,
        tenant_address: selectedTenant.tenant_address || '',
        tenant_email: selectedTenant.tenant_email || '',
        tenant_contact_info: selectedTenant.tenant_contact_info || '',
        max_branch_count: selectedTenant.max_branch_count ?? 0,
        max_user_count: selectedTenant.max_user_count ?? 0,
        status: selectedTenant.status || HOTEL_ENTITY_STATUS.ACTIVE,
      };
    } else {
      newDefaults = { ...defaultFormValuesCreate, status: HOTEL_ENTITY_STATUS.ACTIVE };
    }
    form.reset(newDefaults, { resolver: newResolver } as any);
  }, [selectedTenant, form, isEditDialogOpen, isAddDialogOpen]);

  const handleAddSubmit = async (data: TenantCreateData) => {
    if (!sysAdUserId) {
      toast({ title: "Error", description: "SysAd user ID not available for logging.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await createTenant(data, sysAdUserId);
      if (result.success && result.tenant) {
        toast({ title: "Success", description: "Tenant created successfully." });
        setTenants(prev => [...prev, result.tenant!].sort((a,b) => a.tenant_name.localeCompare(b.tenant_name)));
        setIsAddDialogOpen(false);
      } else {
        toast({ title: "Creation Failed", description: result.message || "Could not create tenant.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "An unexpected error occurred.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditSubmit = async (data: TenantUpdateData) => {
    if (!selectedTenant || !sysAdUserId) {
        toast({ title: "Error", description: "Selected tenant or SysAd user ID not available for logging.", variant: "destructive" });
        return;
    }
    setIsSubmitting(true);
    try {
      const result = await updateTenant(selectedTenant.id, data, sysAdUserId);
      if (result.success && result.tenant) {
        toast({ title: "Success", description: "Tenant updated successfully." });
        setTenants(prev => prev.map(t => t.id === result.tenant!.id ? result.tenant! : t).sort((a,b) => a.tenant_name.localeCompare(b.tenant_name)));
        setIsEditDialogOpen(false);
        setSelectedTenant(null);
      } else {
        toast({ title: "Update Failed", description: result.message || "Could not update tenant.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "An unexpected error occurred.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleArchive = async (tenantId: number, tenantName: string) => {
    if (!sysAdUserId) {
        toast({ title: "Error", description: "SysAd user ID not available for logging.", variant: "destructive" });
        return;
    }
    setIsSubmitting(true);
    try {
      const result = await archiveTenant(tenantId, sysAdUserId);
      if (result.success) {
        toast({ title: "Success", description: `Tenant "${tenantName}" archived.` });
        setTenants(prev => prev.map(t => t.id === tenantId ? {...t, status: HOTEL_ENTITY_STATUS.ARCHIVED} : t));
      } else {
        toast({ title: "Archive Failed", description: result.message, variant: "destructive" });
      }
    } catch (error) {
       toast({ title: "Error", description: "An unexpected error occurred during archiving.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRestore = async (tenant: Tenant) => {
    if (!sysAdUserId) {
        toast({ title: "Error", description: "SysAd user ID not available for logging.", variant: "destructive" });
        return;
    }
    setIsSubmitting(true);
    const payload: TenantUpdateData = {
        tenant_name: tenant.tenant_name,
        tenant_address: tenant.tenant_address,
        tenant_email: tenant.tenant_email,
        tenant_contact_info: tenant.tenant_contact_info,
        max_branch_count: tenant.max_branch_count,
        max_user_count: tenant.max_user_count,
        status: HOTEL_ENTITY_STATUS.ACTIVE,
    };
    const result = await updateTenant(tenant.id, payload, sysAdUserId);
    if (result.success && result.tenant) {
        toast({ title: "Success", description: `Tenant "${tenant.tenant_name}" restored.` });
        setTenants(prev => prev.map(t => t.id === tenant.id ? result.tenant! : t));
    } else {
        toast({ title: "Restore Failed", description: result.message, variant: "destructive" });
    }
    setIsSubmitting(false);
  };

  const filteredTenants = tenants.filter(tenant => tenant.status === (activeTab === "active" ? HOTEL_ENTITY_STATUS.ACTIVE : HOTEL_ENTITY_STATUS.ARCHIVED));


  if (isLoading && tenants.length === 0) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">Loading tenants...</p>
      </div>
    );
  }

  const renderFormFields = () => (
    <React.Fragment>
      <FormField
        control={form.control}
        name="tenant_name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Tenant Name *</FormLabel>
            <FormControl><Input placeholder="Grand Hotel" {...field} className="w-[90%]" /></FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="tenant_address"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Address</FormLabel>
            <FormControl><Textarea placeholder="123 Main St, City" {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="tenant_email"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Email</FormLabel>
            <FormControl><Input type="email" placeholder="contact@grandhotel.com" {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="tenant_contact_info"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Contact Info</FormLabel>
            <FormControl><Input placeholder="+1-555-0100" {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="max_branch_count"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Max Branches (0 for unlimited)</FormLabel>
            <FormControl><Input type="number" placeholder="5" {...field} value={field.value ?? ''} className="w-[90%]" onChange={e => field.onChange(e.target.value === '' ? null : parseInt(e.target.value, 10))} /></FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="max_user_count"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Max Users (0 for unlimited)</FormLabel>
            <FormControl><Input type="number" placeholder="10" {...field} value={field.value ?? ''} className="w-[90%]" onChange={e => field.onChange(e.target.value === '' ? null : parseInt(e.target.value, 10))} /></FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      {isEditing && (
        <FormField
          control={form.control}
          name="status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Status *</FormLabel>
               <Select onValueChange={field.onChange} value={field.value?.toString() ?? HOTEL_ENTITY_STATUS.ACTIVE}>
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

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <Building2 className="h-6 w-6 text-primary" />
            <CardTitle>Tenants Management</CardTitle>
          </div>
          <CardDescription>View, add, edit, and archive tenants.</CardDescription>
        </div>
        <Dialog
            key={isEditing ? `edit-tenant-${selectedTenant?.id}` : 'add-tenant'}
            open={isAddDialogOpen || isEditDialogOpen}
            onOpenChange={(open) => {
                if (!open) {
                    setIsAddDialogOpen(false);
                    setIsEditDialogOpen(false);
                    setSelectedTenant(null);
                    form.reset({ ...defaultFormValuesCreate, status: HOTEL_ENTITY_STATUS.ACTIVE }, { resolver: zodResolver(tenantCreateSchema) } as any);
                }
            }}
        >
          <DialogTrigger asChild>
            <Button onClick={() => {setSelectedTenant(null); form.reset({ ...defaultFormValuesCreate, status: HOTEL_ENTITY_STATUS.ACTIVE }, { resolver: zodResolver(tenantCreateSchema) } as any); setIsAddDialogOpen(true); setIsEditDialogOpen(false);}}>
              <PlusCircle className="mr-2 h-4 w-4" /> Add Tenant
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg p-3 flex flex-col max-h-[85vh]">
            <DialogHeader className="p-2 border-b"><DialogTitle>{isEditing ? `Edit Tenant: ${selectedTenant?.tenant_name}` : 'Add New Tenant'}</DialogTitle></DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(isEditing ? (d => handleEditSubmit(d as TenantUpdateData)) : (d => handleAddSubmit(d as TenantCreateData)) )} className="bg-card rounded-md flex flex-col flex-grow overflow-hidden">
                <div className="flex-grow space-y-3 p-1 overflow-y-auto">
                  {renderFormFields()}
                </div>
                <DialogFooter className="bg-card py-2 border-t px-3 sticky bottom-0 z-10">
                  <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                  <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : (isEditing ? "Save Changes" : "Create Tenant")}</Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="archive">Archive</TabsTrigger>
          </TabsList>
          <TabsContent value="active">
             {isLoading && filteredTenants.length === 0 && <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
            {!isLoading && filteredTenants.length === 0 && <p className="text-muted-foreground text-center py-8">No active tenants found.</p>}
            {!isLoading && filteredTenants.length > 0 && (
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Contact</TableHead><TableHead>Max Branches</TableHead><TableHead>Max Users</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {filteredTenants.map(tenant => (
                    <TableRow key={tenant.id}>
                      <TableCell className="font-medium">{tenant.tenant_name}</TableCell>
                      <TableCell>{tenant.tenant_email || '-'}</TableCell>
                      <TableCell>{tenant.tenant_contact_info || '-'}</TableCell>
                      <TableCell>{tenant.max_branch_count === null || tenant.max_branch_count <= 0 ? 'Unlimited' : tenant.max_branch_count}</TableCell>
                      <TableCell>{tenant.max_user_count === null || tenant.max_user_count <= 0 ? 'Unlimited' : tenant.max_user_count}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button variant="outline" size="sm" onClick={() => { setSelectedTenant(tenant); setIsEditDialogOpen(true); setIsAddDialogOpen(false);}}>
                            <Edit className="mr-1 h-3 w-3" /> Edit
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="sm" disabled={isSubmitting}><Trash2 className="mr-1 h-3 w-3" /> Archive</Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>Confirm Archive</AlertDialogTitle><AlertDialogDescription>Are you sure you want to archive tenant "{tenant.tenant_name}"?</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleArchive(tenant.id, tenant.tenant_name)} disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : "Archive"}</AlertDialogAction></AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>
          <TabsContent value="archive">
            {isLoading && filteredTenants.length === 0 && <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
            {!isLoading && filteredTenants.length === 0 && <p className="text-muted-foreground text-center py-8">No archived tenants found.</p>}
            {!isLoading && filteredTenants.length > 0 && (
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Max Branches</TableHead><TableHead>Max Users</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {filteredTenants.map(tenant => (
                    <TableRow key={tenant.id}>
                      <TableCell className="font-medium">{tenant.tenant_name}</TableCell>
                      <TableCell>{tenant.tenant_email || '-'}</TableCell>
                      <TableCell>{tenant.max_branch_count === null || tenant.max_branch_count <= 0 ? 'Unlimited' : tenant.max_branch_count}</TableCell>
                      <TableCell>{tenant.max_user_count === null || tenant.max_user_count <= 0 ? 'Unlimited' : tenant.max_user_count}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => handleRestore(tenant)} disabled={isSubmitting}><ArchiveRestore className="mr-1 h-3 w-3" /> Restore</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
