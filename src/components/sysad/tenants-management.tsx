
"use client";

import { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { listTenants, createTenant, updateTenant, archiveTenant } from '@/actions/admin';
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

type TenantFormValues = TenantCreateData | TenantUpdateData;

export default function TenantsManagement() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [activeTab, setActiveTab] = useState("active");
  const { toast } = useToast();

  const form = useForm<TenantFormValues>({
    resolver: zodResolver(selectedTenant ? tenantUpdateSchema : tenantCreateSchema),
    defaultValues: {
      tenant_name: '',
      tenant_address: '',
      tenant_email: '',
      tenant_contact_info: '',
    },
  });

  const fetchTenants = useCallback(async () => {
    setIsLoading(true);
    try {
      const fetchedTenants = await listTenants();
      setTenants(fetchedTenants);
    } catch (error) {
      console.error("Failed to fetch tenants:", error);
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
    if (selectedTenant) {
      form.reset({
        tenant_name: selectedTenant.tenant_name,
        tenant_address: selectedTenant.tenant_address || '',
        tenant_email: selectedTenant.tenant_email || '',
        tenant_contact_info: selectedTenant.tenant_contact_info || '',
      });
    } else {
      form.reset({
        tenant_name: '',
        tenant_address: '',
        tenant_email: '',
        tenant_contact_info: '',
      });
    }
  }, [selectedTenant, form, isEditDialogOpen, isAddDialogOpen]);

  const handleAddSubmit = async (data: TenantCreateData) => {
    setIsSubmitting(true);
    try {
      const result = await createTenant(data);
      if (result.success && result.tenant) {
        toast({ title: "Success", description: "Tenant created successfully." });
        form.reset();
        setIsAddDialogOpen(false);
        fetchTenants();
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
    if (!selectedTenant) return;
    setIsSubmitting(true);
    try {
      const result = await updateTenant(selectedTenant.id, data);
      if (result.success && result.tenant) {
        toast({ title: "Success", description: "Tenant updated successfully." });
        form.reset();
        setIsEditDialogOpen(false);
        setSelectedTenant(null);
        fetchTenants();
      } else {
        toast({ title: "Update Failed", description: result.message || "Could not update tenant.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "An unexpected error occurred.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleArchive = async (tenantId: number) => {
    setIsSubmitting(true);
    try {
      const result = await archiveTenant(tenantId);
      if (result.success) {
        toast({ title: "Success", description: result.message });
        fetchTenants();
      } else {
        toast({ title: "Archive Failed", description: result.message, variant: "destructive" });
      }
    } catch (error) {
       toast({ title: "Error", description: "An unexpected error occurred during archiving.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  // Placeholder for restore, similar to archive but sets status to '1'
  const handleRestore = async (tenantId: number) => {
    // This would be a new server action: restoreTenant(tenantId)
    // For now, we can simulate it by calling updateTenant with status '1' if schema supports it, or create a dedicated action.
    // For demo, just show a toast.
    const updatedTenant = tenants.find(t => t.id === tenantId);
    if (updatedTenant) {
        setIsSubmitting(true);
        const result = await updateTenant(tenantId, { ...updatedTenant, status: '1' } as TenantUpdateData); // Assuming status can be updated
        if (result.success) {
            toast({ title: "Success", description: "Tenant restored successfully." });
            fetchTenants();
        } else {
            toast({ title: "Restore Failed", description: result.message, variant: "destructive" });
        }
        setIsSubmitting(false);
    }
  };


  const filteredTenants = tenants.filter(tenant => activeTab === "active" ? tenant.status === '1' : tenant.status === '0');

  if (isLoading && tenants.length === 0) { // Show loader only on initial load
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">Loading tenants...</p>
      </div>
    );
  }

  const renderFormFields = () => (
    <>
      <FormField
        control={form.control}
        name="tenant_name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Tenant Name *</FormLabel>
            <FormControl><Input placeholder="Grand Hotel" {...field} /></FormControl>
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
            <FormControl><Textarea placeholder="123 Main St, City" {...field} value={field.value ?? ''}/></FormControl>
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
            <FormControl><Input type="email" placeholder="contact@grandhotel.com" {...field} value={field.value ?? ''}/></FormControl>
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
            <FormControl><Input placeholder="+1-555-0100" {...field} value={field.value ?? ''}/></FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
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
        <Dialog open={isAddDialogOpen} onOpenChange={(open) => {setIsAddDialogOpen(open); if (!open) form.reset();}}>
          <DialogTrigger asChild>
            <Button onClick={() => {setSelectedTenant(null); setIsAddDialogOpen(true);}}>
              <PlusCircle className="mr-2 h-4 w-4" /> Add Tenant
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader><DialogTitle>Add New Tenant</DialogTitle></DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleAddSubmit)} className="space-y-4 py-4">
                {renderFormFields()}
                <DialogFooter>
                  <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                  <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : "Create Tenant"}</Button>
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
             {isLoading && <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
            {!isLoading && filteredTenants.length === 0 && <p className="text-muted-foreground text-center py-8">No active tenants found.</p>}
            {!isLoading && filteredTenants.length > 0 && (
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Contact</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {filteredTenants.map(tenant => (
                    <TableRow key={tenant.id}>
                      <TableCell className="font-medium">{tenant.tenant_name}</TableCell>
                      <TableCell>{tenant.tenant_email || '-'}</TableCell>
                      <TableCell>{tenant.tenant_contact_info || '-'}</TableCell>
                      <TableCell>{tenant.status === '1' ? 'Active' : 'Archived'}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <Dialog open={isEditDialogOpen && selectedTenant?.id === tenant.id} onOpenChange={(open) => {if(!open)setSelectedTenant(null); setIsEditDialogOpen(open);}}>
                          <DialogTrigger asChild>
                            <Button variant="outline" size="sm" onClick={() => { setSelectedTenant(tenant); setIsEditDialogOpen(true); }}>
                              <Edit className="mr-1 h-3 w-3" /> Edit
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="sm:max-w-lg">
                            <DialogHeader><DialogTitle>Edit Tenant: {selectedTenant?.tenant_name}</DialogTitle></DialogHeader>
                            <Form {...form}>
                              <form onSubmit={form.handleSubmit(handleEditSubmit)} className="space-y-4 py-4">
                                {renderFormFields()}
                                <DialogFooter>
                                  <DialogClose asChild><Button type="button" variant="outline" onClick={() => setSelectedTenant(null)}>Cancel</Button></DialogClose>
                                  <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : "Save Changes"}</Button>
                                </DialogFooter>
                              </form>
                            </Form>
                          </DialogContent>
                        </Dialog>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="sm" disabled={isSubmitting}><Trash2 className="mr-1 h-3 w-3" /> Archive</Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>Confirm Archive</AlertDialogTitle><AlertDialogDescription>Are you sure you want to archive tenant "{tenant.tenant_name}"?</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleArchive(tenant.id)} disabled={isSubmitting}>Archive</AlertDialogAction></AlertDialogFooter>
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
            {isLoading && <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
            {!isLoading && filteredTenants.length === 0 && <p className="text-muted-foreground text-center py-8">No archived tenants found.</p>}
            {!isLoading && filteredTenants.length > 0 && (
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {filteredTenants.map(tenant => (
                    <TableRow key={tenant.id}>
                      <TableCell className="font-medium">{tenant.tenant_name}</TableCell>
                      <TableCell>{tenant.tenant_email || '-'}</TableCell>
                      <TableCell>{tenant.status === '1' ? 'Active' : 'Archived'}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => handleRestore(tenant.id)} disabled={isSubmitting}><ArchiveRestore className="mr-1 h-3 w-3" /> Restore</Button>
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
