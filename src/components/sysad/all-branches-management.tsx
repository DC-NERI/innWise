
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { Loader2, PlusCircle, Network, Edit, Trash2, ArchiveRestore } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { branchCreateSchema, BranchCreateData, branchUpdateSchemaSysAd, BranchUpdateDataSysAd } from '@/lib/schemas';
import type { Branch, Tenant } from '@/lib/types';
import { createBranchForTenant } from '@/actions/admin/branches/createBranchForTenant';
import { listAllBranches } from '@/actions/admin/branches/listAllBranches';
import { listTenants } from '@/actions/admin/tenants/listTenants';
import { updateBranchSysAd } from '@/actions/admin/branches/updateBranchSysAd';
import { archiveBranch } from '@/actions/admin/branches/archiveBranch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HOTEL_ENTITY_STATUS } from '@/lib/constants';

type BranchFormValues = BranchCreateData | BranchUpdateDataSysAd;

const defaultFormValuesCreate: BranchCreateData = {
  tenant_id: undefined as unknown as number,
  branch_name: '',
  branch_code: '',
  branch_address: '',
  contact_number: '',
  email_address: '',
};

interface AllBranchesManagementProps {
  sysAdUserId: number | null;
}

export default function AllBranchesManagement({ sysAdUserId }: AllBranchesManagementProps) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [activeTab, setActiveTab] = useState<string>(HOTEL_ENTITY_STATUS.ACTIVE);
  const { toast } = useToast();

  const isEditing = !!selectedBranch;

  const form = useForm<BranchFormValues>({
    // Resolver and defaultValues are set dynamically in useEffect
  });

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [fetchedBranches, fetchedTenants] = await Promise.all([listAllBranches(), listTenants()]);
      setBranches(fetchedBranches);
      setTenants(fetchedTenants.filter(t => t.status === HOTEL_ENTITY_STATUS.ACTIVE));
    } catch (error) {
      toast({ title: "Error", description: "Could not fetch data. Check console for details.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const currentIsEditing = !!selectedBranch;
    const newResolver = zodResolver(currentIsEditing ? branchUpdateSchemaSysAd : branchCreateSchema);
    let newDefaults: BranchFormValues;

    if (currentIsEditing && selectedBranch) {
      newDefaults = {
        tenant_id: selectedBranch.tenant_id,
        branch_name: selectedBranch.branch_name,
        // branch_code is read-only for edit in SysAd form based on schema
        branch_address: selectedBranch.branch_address || '',
        contact_number: selectedBranch.contact_number || '',
        email_address: selectedBranch.email_address || '',
        status: selectedBranch.status || HOTEL_ENTITY_STATUS.ACTIVE,
      } as BranchUpdateDataSysAd;
    } else {
      newDefaults = {
        ...defaultFormValuesCreate,
      } as BranchCreateData;
    }
    form.reset(newDefaults, { resolver: newResolver } as any);
  }, [selectedBranch, form, isEditDialogOpen, isAddDialogOpen]);


  const handleAddSubmit = async (data: BranchCreateData) => {
    if (!sysAdUserId) {
      toast({ title: "Error", description: "SysAd User ID is not available for logging.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    const payload = { ...data, tenant_id: Number(data.tenant_id) };
    try {
      const result = await createBranchForTenant(payload, sysAdUserId);
      if (result.success && result.branch) {
        toast({ title: "Success", description: "Branch created." });
        setBranches(prev => [...prev, result.branch!].sort((a,b) => (a.tenant_name || "").localeCompare(b.tenant_name || "") || a.branch_name.localeCompare(b.branch_name)));
        setIsAddDialogOpen(false);
        form.reset({ ...defaultFormValuesCreate } as BranchCreateData);
        fetchData(); // Re-fetch to ensure list is accurate
      } else {
        toast({ title: "Creation Failed", description: result.message || "Could not create branch.", variant: "destructive" });
      }
    } catch (e) {
       const error = e as Error;
      toast({ title: "Error", description: error.message || "Unexpected error during branch creation.", variant: "destructive" });
    }
    finally { setIsSubmitting(false); }
  };

  const handleEditSubmit = async (data: BranchUpdateDataSysAd) => {
    if (!selectedBranch || !sysAdUserId) {
        toast({ title: "Error", description: "Selected branch or SysAd User ID not available.", variant: "destructive" });
        return;
    }
    setIsSubmitting(true);
    const payload = { ...data, tenant_id: Number(data.tenant_id) };
    try {
      const result = await updateBranchSysAd(selectedBranch.id, payload, sysAdUserId);
      if (result.success && result.branch) {
        toast({ title: "Success", description: "Branch updated." });
        setBranches(prev => prev.map(b => b.id === result.branch!.id ? result.branch! : b).sort((a,b) => (a.tenant_name || "").localeCompare(b.tenant_name || "") || a.branch_name.localeCompare(b.branch_name)));
        setIsEditDialogOpen(false); setSelectedBranch(null);
        fetchData(); // Re-fetch
      } else {
        toast({ title: "Update Failed", description: result.message, variant: "destructive" });
      }
    } catch (e) {
      const error = e as Error;
      toast({ title: "Error", description: error.message || "Unexpected error during branch update.", variant: "destructive" });
    }
    finally { setIsSubmitting(false); }
  };

  const handleArchive = async (branchId: number, branchName: string) => {
    if (!sysAdUserId) {
        toast({ title: "Error", description: "SysAd User ID not available.", variant: "destructive" });
        return;
    }
    setIsSubmitting(true);
    const result = await archiveBranch(branchId, sysAdUserId);
    if (result.success) {
        toast({ title: "Success", description: `Branch "${branchName}" archived.` });
        // Optimistic update or re-fetch
        // setBranches(prev => prev.map(b => b.id === branchId ? {...b, status: HOTEL_ENTITY_STATUS.ARCHIVED} : b));
        fetchData();
    } else {
        toast({ title: "Archive Failed", description: result.message, variant: "destructive" });
    }
    setIsSubmitting(false);
  };

  const handleRestore = async (branch: Branch) => {
    if (!sysAdUserId) {
        toast({ title: "Error", description: "SysAd User ID not available.", variant: "destructive" });
        return;
    }
    setIsSubmitting(true);
     const payload: BranchUpdateDataSysAd = {
        tenant_id: branch.tenant_id,
        branch_name: branch.branch_name,
        branch_address: branch.branch_address,
        contact_number: branch.contact_number,
        email_address: branch.email_address,
        status: HOTEL_ENTITY_STATUS.ACTIVE,
    };
    const result = await updateBranchSysAd(branch.id, payload, sysAdUserId);
    if (result.success && result.branch) {
        toast({ title: "Success", description: `Branch "${branch.branch_name}" restored.` });
        // Optimistic update or re-fetch
        // setBranches(prev => prev.map(b => b.id === branch.id ? result.branch! : b));
        fetchData();
    } else {
        toast({ title: "Restore Failed", description: result.message, variant: "destructive" });
    }
    setIsSubmitting(false);
  };

  const filteredBranches = branches.filter(branch => branch.status === activeTab);


  if (isLoading && branches.length === 0) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2 text-muted-foreground">Loading branches...</p></div>;
  }

  const renderFormFields = (isEditingForm: boolean) => (
    <React.Fragment>
      <FormField control={form.control} name="tenant_id"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Tenant *</FormLabel>
            <Select onValueChange={(v) => field.onChange(v ? Number(v) : undefined)} value={field.value?.toString()} disabled={isEditingForm && !!selectedBranch?.tenant_id}>
              <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder="Select tenant" /></SelectTrigger></FormControl>
              <SelectContent>{tenants.map(t => <SelectItem key={t.id} value={t.id.toString()}>{t.tenant_name}</SelectItem>)}</SelectContent>
            </Select><FormMessage />
          </FormItem>
        )}
      />
      <FormField control={form.control} name="branch_name" render={({ field }) => (<FormItem><FormLabel>Branch Name *</FormLabel><FormControl><Input placeholder="Downtown Branch" {...field} className="w-[90%]" /></FormControl><FormMessage /></FormItem>)} />
      {!isEditingForm && <FormField control={form.control} name="branch_code" render={({ field }) => (<FormItem><FormLabel>Branch Code *</FormLabel><FormControl><Input placeholder="DTOWN01" {...field} className="w-[90%]" /></FormControl><FormMessage /></FormItem>)} />}
      {isEditingForm && selectedBranch && <FormItem><FormLabel>Branch Code (Read-only)</FormLabel><FormControl><Input readOnly value={selectedBranch.branch_code} className="w-[90%]" /></FormControl></FormItem>}
      <FormField control={form.control} name="branch_address" render={({ field }) => (<FormItem><FormLabel>Address</FormLabel><FormControl><Textarea placeholder="456 Branch Ave" {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl><FormMessage /></FormItem>)} />
      <FormField control={form.control} name="contact_number" render={({ field }) => (<FormItem><FormLabel>Contact</FormLabel><FormControl><Input placeholder="+1-555-0200" {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl><FormMessage /></FormItem>)} />
      <FormField control={form.control} name="email_address" render={({ field }) => (<FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" placeholder="branch@tenant.com" {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl><FormMessage /></FormItem>)} />
      {isEditingForm && (
        <FormField control={form.control} name="status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Status *</FormLabel>
              <Select onValueChange={(value) => field.onChange(value as HOTEL_ENTITY_STATUS)} value={field.value as string ?? HOTEL_ENTITY_STATUS.ACTIVE}>
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

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div><div className="flex items-center space-x-2"><Network className="h-6 w-6 text-primary" /><CardTitle>All Branches</CardTitle></div><CardDescription>Manage branches across all tenants.</CardDescription></div>
        <Dialog
            key={isEditing ? `edit-branch-${selectedBranch?.id}` : 'add-branch'}
            open={isAddDialogOpen || isEditDialogOpen}
            onOpenChange={(open) => {
                if (!open) {
                    setIsAddDialogOpen(false);
                    setIsEditDialogOpen(false);
                    setSelectedBranch(null);
                    form.reset({ ...defaultFormValuesCreate } as BranchCreateData, { resolver: zodResolver(branchCreateSchema) } as any);
                }
            }}
        >
          <DialogTrigger asChild><Button onClick={() => {setSelectedBranch(null); form.reset({ ...defaultFormValuesCreate } as BranchCreateData, { resolver: zodResolver(branchCreateSchema) } as any); setIsAddDialogOpen(true); setIsEditDialogOpen(false);}}><PlusCircle className="mr-2 h-4 w-4" /> Add Branch</Button></DialogTrigger>
          <DialogContent className="sm:max-w-lg p-3 flex flex-col max-h-[85vh]">
            <DialogHeader className="p-2 border-b"><DialogTitle>{isEditing ? `Edit Branch: ${selectedBranch?.branch_name}` : 'Add New Branch'}</DialogTitle></DialogHeader>
            <Form {...form}>
                <form onSubmit={form.handleSubmit(isEditing ? (d => handleEditSubmit(d as BranchUpdateDataSysAd)) : (d => handleAddSubmit(d as BranchCreateData)))} className="bg-card rounded-md flex flex-col flex-grow overflow-hidden">
                  <div className="flex-grow space-y-3 p-1 overflow-y-auto">
                    {renderFormFields(isEditing)}
                  </div>
                  <DialogFooter className="bg-card py-2 border-t px-3 sticky bottom-0 z-10">
                    <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                    <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : (isEditing ? "Save Changes" : "Create Branch")}</Button>
                  </DialogFooter>
                </form>
            </Form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4"><TabsTrigger value={HOTEL_ENTITY_STATUS.ACTIVE}>Active</TabsTrigger><TabsTrigger value={HOTEL_ENTITY_STATUS.ARCHIVED}>Archive</TabsTrigger></TabsList>
          <TabsContent value={HOTEL_ENTITY_STATUS.ACTIVE}>
            {isLoading && filteredBranches.length === 0 && <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
            {!isLoading && filteredBranches.length === 0 && <p className="text-muted-foreground text-center py-8">No active branches found.</p>}
            {!isLoading && filteredBranches.length > 0 && (
              <Table><TableHeader><TableRow><TableHead>Branch</TableHead><TableHead>Code</TableHead><TableHead>Tenant</TableHead><TableHead>Email</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>{filteredBranches.map(b => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.branch_name}</TableCell><TableCell>{b.branch_code}</TableCell><TableCell>{b.tenant_name || 'N/A'}</TableCell><TableCell>{b.email_address || '-'}</TableCell>
                    <TableCell className="text-right space-x-2">
                        <Button variant="outline" size="sm" onClick={() => {setSelectedBranch(b); setIsEditDialogOpen(true); setIsAddDialogOpen(false);}}><Edit className="mr-1 h-3 w-3" /> Edit</Button>
                      <AlertDialog><AlertDialogTrigger asChild><Button variant="destructive" size="sm" disabled={isSubmitting}><Trash2 className="mr-1 h-3 w-3" /> Archive</Button></AlertDialogTrigger>
                        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Confirm Archive</AlertDialogTitle><AlertDialogDescription>Are you sure you want to archive branch "{b.branch_name}"?</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleArchive(b.id, b.branch_name)} disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : "Archive"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>))}
                </TableBody>
              </Table>)}
          </TabsContent>
          <TabsContent value={HOTEL_ENTITY_STATUS.ARCHIVED}>
            {isLoading && filteredBranches.length === 0 && <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
            {!isLoading && filteredBranches.length === 0 && <p className="text-muted-foreground text-center py-8">No archived branches found.</p>}
            {!isLoading && filteredBranches.length > 0 && (
              <Table>
                <TableHeader><TableRow><TableHead>Branch</TableHead><TableHead>Code</TableHead><TableHead>Tenant</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>{filteredBranches.map(b => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.branch_name}</TableCell><TableCell>{b.branch_code}</TableCell><TableCell>{b.tenant_name || 'N/A'}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => handleRestore(b)} disabled={isSubmitting}><ArchiveRestore className="mr-1 h-3 w-3" /> Restore</Button>
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

