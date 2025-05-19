
"use client";

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
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
import { createBranchForTenant, listAllBranches, listTenants, updateBranchSysAd, archiveBranch } from '@/actions/admin';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type BranchFormValues = BranchCreateData | BranchUpdateDataSysAd;

export default function AllBranchesManagement() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [activeTab, setActiveTab] = useState("active");
  const { toast } = useToast();

  const form = useForm<BranchFormValues>({
    resolver: zodResolver(selectedBranch ? branchUpdateSchemaSysAd : branchCreateSchema),
    defaultValues: {
      tenant_id: undefined,
      branch_name: '',
      branch_code: '', // Only for create
      branch_address: '',
      contact_number: '',
      email_address: '',
      status: '1', // For update
    },
  });

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [fetchedBranches, fetchedTenants] = await Promise.all([listAllBranches(), listTenants()]);
      setBranches(fetchedBranches);
      setTenants(fetchedTenants.filter(t => t.status === '1')); // Only active tenants for selection
    } catch (error) {
      toast({ title: "Error", description: "Could not fetch data.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);
  
  useEffect(() => {
    if (selectedBranch) {
      form.reset({
        tenant_id: selectedBranch.tenant_id,
        branch_name: selectedBranch.branch_name,
        // branch_code: selectedBranch.branch_code, // Not editable
        branch_address: selectedBranch.branch_address || '',
        contact_number: selectedBranch.contact_number || '',
        email_address: selectedBranch.email_address || '',
        status: selectedBranch.status || '1',
      } as BranchUpdateDataSysAd); // Cast for resolver to pick up correct schema
    } else {
      form.reset({
        tenant_id: undefined, branch_name: '', branch_code: '',
        branch_address: '', contact_number: '', email_address: '',
        status: '1',
      } as BranchCreateData);
    }
  }, [selectedBranch, form, isEditDialogOpen, isAddDialogOpen]);

  const handleAddSubmit = async (data: BranchCreateData) => {
    setIsSubmitting(true);
    const payload = { ...data, tenant_id: Number(data.tenant_id) };
    try {
      const result = await createBranchForTenant(payload);
      if (result.success) {
        toast({ title: "Success", description: "Branch created." });
        form.reset(); setIsAddDialogOpen(false); fetchData();
      } else {
        toast({ title: "Creation Failed", description: result.message, variant: "destructive" });
      }
    } catch (e) { toast({ title: "Error", description: "Unexpected error.", variant: "destructive" }); }
    finally { setIsSubmitting(false); }
  };

  const handleEditSubmit = async (data: BranchUpdateDataSysAd) => {
    if (!selectedBranch) return;
    setIsSubmitting(true);
    const payload = { ...data, tenant_id: Number(data.tenant_id) };
    try {
      const result = await updateBranchSysAd(selectedBranch.id, payload);
      if (result.success) {
        toast({ title: "Success", description: "Branch updated." });
        form.reset(); setIsEditDialogOpen(false); setSelectedBranch(null); fetchData();
      } else {
        toast({ title: "Update Failed", description: result.message, variant: "destructive" });
      }
    } catch (e) { toast({ title: "Error", description: "Unexpected error.", variant: "destructive" }); }
    finally { setIsSubmitting(false); }
  };
  
  const handleArchive = async (branchId: number) => {
    setIsSubmitting(true);
    try {
      const result = await archiveBranch(branchId);
      if (result.success) {
        toast({ title: "Success", description: result.message });
        fetchData();
      } else {
        toast({ title: "Archive Failed", description: result.message, variant: "destructive" });
      }
    } catch (e) { toast({ title: "Error", description: "Unexpected error.", variant: "destructive" }); }
    finally { setIsSubmitting(false); }
  };

  const handleRestore = async (branch: Branch) => {
    setIsSubmitting(true);
     const payload: BranchUpdateDataSysAd = {
        tenant_id: branch.tenant_id,
        branch_name: branch.branch_name,
        branch_address: branch.branch_address,
        contact_number: branch.contact_number,
        email_address: branch.email_address,
        status: '1',
    };
    try {
        const result = await updateBranchSysAd(branch.id, payload);
        if (result.success) {
            toast({ title: "Success", description: "Branch restored successfully." });
            fetchData();
        } else {
            toast({ title: "Restore Failed", description: result.message, variant: "destructive" });
        }
    } catch (e) { toast({ title: "Error", description: "Unexpected error.", variant: "destructive" }); }
    finally { setIsSubmitting(false); }
  };


  const filteredBranches = branches.filter(branch => activeTab === "active" ? branch.status === '1' : branch.status === '0');

  if (isLoading && branches.length === 0) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2">Loading...</p></div>;
  }

  const renderFormFields = (isEditing: boolean) => (
    <>
      <FormField control={form.control} name="tenant_id"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Tenant *</FormLabel>
            <Select onValueChange={(v) => field.onChange(Number(v))} value={field.value?.toString()} disabled={isEditing && !!selectedBranch?.tenant_id}>
              <FormControl><SelectTrigger><SelectValue placeholder="Select tenant" /></SelectTrigger></FormControl>
              <SelectContent>{tenants.map(t => <SelectItem key={t.id} value={t.id.toString()}>{t.tenant_name}</SelectItem>)}</SelectContent>
            </Select><FormMessage />
          </FormItem>
        )}
      />
      <FormField control={form.control} name="branch_name" render={({ field }) => (<FormItem><FormLabel>Branch Name *</FormLabel><FormControl><Input placeholder="Downtown Branch" {...field} /></FormControl><FormMessage /></FormItem>)} />
      {!isEditing && <FormField control={form.control} name="branch_code" render={({ field }) => (<FormItem><FormLabel>Branch Code *</FormLabel><FormControl><Input placeholder="DTOWN01" {...field} /></FormControl><FormMessage /></FormItem>)} />}
      {isEditing && selectedBranch && <FormItem><FormLabel>Branch Code (Read-only)</FormLabel><FormControl><Input readOnly value={selectedBranch.branch_code} /></FormControl></FormItem>}
      <FormField control={form.control} name="branch_address" render={({ field }) => (<FormItem><FormLabel>Address</FormLabel><FormControl><Textarea placeholder="456 Branch Ave" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
      <FormField control={form.control} name="contact_number" render={({ field }) => (<FormItem><FormLabel>Contact</FormLabel><FormControl><Input placeholder="+1-555-0200" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
      <FormField control={form.control} name="email_address" render={({ field }) => (<FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" placeholder="branch@tenant.com" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
      {isEditing && (
        <FormField control={form.control} name="status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Status *</FormLabel>
              <Select onValueChange={field.onChange} value={field.value?.toString()}>
                <FormControl><SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger></FormControl>
                <SelectContent><SelectItem value="1">Active</SelectItem><SelectItem value="0">Archived</SelectItem></SelectContent>
              </Select><FormMessage />
            </FormItem>
          )}
        />
      )}
    </>
  );
  
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div><div className="flex items-center space-x-2"><Network className="h-6 w-6 text-primary" /><CardTitle>All Branches</CardTitle></div><CardDescription>Manage branches across all tenants.</CardDescription></div>
        <Dialog open={isAddDialogOpen} onOpenChange={(open) => {setIsAddDialogOpen(open); if (!open) form.reset();}}>
          <DialogTrigger asChild><Button onClick={() => {setSelectedBranch(null); setIsAddDialogOpen(true);}}><PlusCircle className="mr-2 h-4 w-4" /> Add Branch</Button></DialogTrigger>
          <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Add New Branch</DialogTitle></DialogHeader>
            <Form {...form}><form onSubmit={form.handleSubmit(d => handleAddSubmit(d as BranchCreateData))} className="space-y-4 py-4 max-h-[70vh] overflow-y-auto pr-2">{renderFormFields(false)}
              <DialogFooter className="sticky bottom-0 bg-background py-4 border-t"><DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose><Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : "Create Branch"}</Button></DialogFooter>
            </form></Form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4"><TabsTrigger value="active">Active</TabsTrigger><TabsTrigger value="archive">Archive</TabsTrigger></TabsList>
          <TabsContent value="active">
            {isLoading && <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
            {!isLoading && filteredBranches.length === 0 && <p className="text-muted-foreground text-center py-8">No active branches found.</p>}
            {!isLoading && filteredBranches.length > 0 && (
              <Table><TableHeader><TableRow><TableHead>Branch</TableHead><TableHead>Code</TableHead><TableHead>Tenant</TableHead><TableHead>Email</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>{filteredBranches.map(b => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.branch_name}</TableCell><TableCell>{b.branch_code}</TableCell><TableCell>{b.tenant_name || 'N/A'}</TableCell><TableCell>{b.email_address || '-'}</TableCell>
                    <TableCell className="text-right space-x-2">
                      <Dialog open={isEditDialogOpen && selectedBranch?.id === b.id} onOpenChange={(open) => {if(!open)setSelectedBranch(null); setIsEditDialogOpen(open);}}>
                        <DialogTrigger asChild><Button variant="outline" size="sm" onClick={() => {setSelectedBranch(b); setIsEditDialogOpen(true);}}><Edit className="mr-1 h-3 w-3" /> Edit</Button></DialogTrigger>
                        <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Edit Branch: {selectedBranch?.branch_name}</DialogTitle></DialogHeader>
                          <Form {...form}><form onSubmit={form.handleSubmit(d => handleEditSubmit(d as BranchUpdateDataSysAd))} className="space-y-4 py-4 max-h-[70vh] overflow-y-auto pr-2">{renderFormFields(true)}
                            <DialogFooter className="sticky bottom-0 bg-background py-4 border-t"><DialogClose asChild><Button type="button" variant="outline" onClick={() => setSelectedBranch(null)}>Cancel</Button></DialogClose><Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : "Save Changes"}</Button></DialogFooter>
                          </form></Form>
                        </DialogContent>
                      </Dialog>
                      <AlertDialog><AlertDialogTrigger asChild><Button variant="destructive" size="sm" disabled={isSubmitting}><Trash2 className="mr-1 h-3 w-3" /> Archive</Button></AlertDialogTrigger>
                        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Confirm Archive</AlertDialogTitle><AlertDialogDescription>Archive branch "{b.branch_name}"?</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleArchive(b.id)} disabled={isSubmitting}>Archive</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>))}
                </TableBody>
              </Table>)}
          </TabsContent>
          <TabsContent value="archive">
             {isLoading && <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
            {!isLoading && filteredBranches.length === 0 && <p className="text-muted-foreground text-center py-8">No archived branches found.</p>}
            {!isLoading && filteredBranches.length > 0 && (
              <Table><TableHeader><TableRow><TableHead>Branch</TableHead><TableHead>Code</TableHead><TableHead>Tenant</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
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
