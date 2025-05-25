
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel as RHFFormLabel, FormMessage } from '@/components/ui/form'; 
import { Label } from "@/components/ui/label"; 
import { useToast } from '@/hooks/use-toast';
import { Loader2, PlusCircle, Edit, Trash2, ArchiveRestore, Tags, Building } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { hotelRateCreateSchema, HotelRateCreateData, hotelRateUpdateSchema, HotelRateUpdateData } from '@/lib/schemas';
import type { HotelRate, SimpleBranch } from '@/lib/types';
import { getBranchesForTenantSimple } from '@/actions/admin/branches/getBranchesForTenantSimple';
import { listRatesForBranch } from '@/actions/admin/rates/listRatesForBranch';
import { createRate } from '@/actions/admin/rates/createRate';
import { updateRate } from '@/actions/admin/rates/updateRate';
import { archiveRate } from '@/actions/admin/rates/archiveRate';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HOTEL_ENTITY_STATUS } from '@/lib/constants';

type RateFormValues = HotelRateCreateData | HotelRateUpdateData;

const defaultFormValuesCreate: HotelRateCreateData = {
  name: '',
  price: 0,
  hours: 0,
  excess_hour_price: undefined,
  description: '',
};

interface RatesContentProps {
  tenantId: number;
}

export default function RatesContent({ tenantId }: RatesContentProps) {
  const [branches, setBranches] = useState<SimpleBranch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(null);
  const [rates, setRates] = useState<HotelRate[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(true);
  const [isLoadingRates, setIsLoadingRates] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedRate, setSelectedRate] = useState<HotelRate | null>(null);
  const [activeTab, setActiveTab] = useState("active");
  const { toast } = useToast();

  const isEditing = !!selectedRate;

  const form = useForm<RateFormValues>({
  });

  const fetchBranches = useCallback(async () => {
    if (!tenantId) return;
    setIsLoadingBranches(true);
    try {
      const fetchedBranches = await getBranchesForTenantSimple(tenantId);
      setBranches(fetchedBranches);
      if (fetchedBranches.length > 0 && !selectedBranchId) {
      }
    } catch (error) {
      toast({ title: "Error", description: "Could not fetch branches.", variant: "destructive" });
    } finally {
      setIsLoadingBranches(false);
    }
  }, [tenantId, toast, selectedBranchId]);

  useEffect(() => {
    fetchBranches();
  }, [fetchBranches]);

  const fetchRates = useCallback(async (branchId: number) => {
    if (!tenantId) return;
    setIsLoadingRates(true);
    try {
      const fetchedRates = await listRatesForBranch(branchId, tenantId);
      setRates(fetchedRates);
    } catch (error) {
      toast({ title: "Error", description: "Could not fetch rates for the selected branch.", variant: "destructive" });
      setRates([]);
    } finally {
      setIsLoadingRates(false);
    }
  }, [tenantId, toast]);

  useEffect(() => {
    if (selectedBranchId) {
      fetchRates(selectedBranchId);
    } else {
      setRates([]); 
    }
  }, [selectedBranchId, fetchRates]);
  
  useEffect(() => {
    const currentIsEditing = !!selectedRate;
    const newResolver = zodResolver(currentIsEditing ? hotelRateUpdateSchema : hotelRateCreateSchema);
    let newDefaults: RateFormValues;

    if (currentIsEditing && selectedRate) {
      newDefaults = {
        name: selectedRate.name,
        price: selectedRate.price,
        hours: selectedRate.hours,
        excess_hour_price: selectedRate.excess_hour_price,
        description: selectedRate.description || '',
        status: selectedRate.status || HOTEL_ENTITY_STATUS.ACTIVE,
      };
    } else {
      newDefaults = { ...defaultFormValuesCreate, status: HOTEL_ENTITY_STATUS.ACTIVE };
    }
    form.reset(newDefaults, { resolver: newResolver } as any);
  }, [selectedRate, form, isEditDialogOpen, isAddDialogOpen]);


  const handleAddSubmit = async (data: HotelRateCreateData) => {
    if (!selectedBranchId || !tenantId) {
      toast({ title: "Error", description: "Branch and Tenant must be selected.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await createRate(data, tenantId, selectedBranchId);
      if (result.success && result.rate) {
        toast({ title: "Success", description: "Rate created." });
        setRates(prev => [...prev, result.rate!].sort((a, b) => a.name.localeCompare(b.name)));
        setIsAddDialogOpen(false);
      } else {
        toast({ title: "Creation Failed", description: result.message, variant: "destructive" });
      }
    } catch (e) { toast({ title: "Error", description: "Unexpected error during rate creation.", variant: "destructive" }); }
    finally { setIsSubmitting(false); }
  };

  const handleEditSubmit = async (data: HotelRateUpdateData) => {
    if (!selectedRate || !selectedBranchId || !tenantId) return;
    setIsSubmitting(true);
    try {
      const result = await updateRate(selectedRate.id, data, tenantId, selectedBranchId);
      if (result.success && result.rate) {
        toast({ title: "Success", description: "Rate updated." });
        setRates(prev => prev.map(r => r.id === result.rate!.id ? result.rate! : r).sort((a, b) => a.name.localeCompare(b.name)));
        setIsEditDialogOpen(false); setSelectedRate(null);
      } else {
        toast({ title: "Update Failed", description: result.message, variant: "destructive" });
      }
    } catch (e) { toast({ title: "Error", description: "Unexpected error during rate update.", variant: "destructive" }); }
    finally { setIsSubmitting(false); }
  };

  const handleArchive = async (rate: HotelRate) => {
    if (!tenantId || !rate.branch_id) return;
    setIsSubmitting(true);
    try {
      const result = await archiveRate(rate.id, tenantId, rate.branch_id);
      if (result.success) {
        toast({ title: "Success", description: `Rate "${rate.name}" archived.` });
        setRates(prev => prev.map(r => r.id === rate.id ? { ...r, status: HOTEL_ENTITY_STATUS.ARCHIVED } : r));
      } else {
        toast({ title: "Archive Failed", description: result.message, variant: "destructive" });
      }
    } catch (e) { toast({ title: "Error", description: "Unexpected error during archiving.", variant: "destructive" }); }
    finally { setIsSubmitting(false); }
  };

  const handleRestore = async (rate: HotelRate) => {
    if (!tenantId || !rate.branch_id) return;
    setIsSubmitting(true);
    const payload: HotelRateUpdateData = {
        name: rate.name,
        price: rate.price,
        hours: rate.hours,
        excess_hour_price: rate.excess_hour_price,
        description: rate.description,
        status: HOTEL_ENTITY_STATUS.ACTIVE,
    };
    try {
      const result = await updateRate(rate.id, payload, tenantId, rate.branch_id);
      if (result.success && result.rate) {
        toast({ title: "Success", description: `Rate "${rate.name}" restored.` });
        setRates(prev => prev.map(r => r.id === result.rate!.id ? result.rate! : r));
      } else {
        toast({ title: "Restore Failed", description: result.message, variant: "destructive" });
      }
    } catch (e) { toast({ title: "Error", description: "Unexpected error during restore.", variant: "destructive" }); }
    finally { setIsSubmitting(false); }
  };

  const filteredRates = rates.filter(rate => rate.status === (activeTab === "active" ? HOTEL_ENTITY_STATUS.ACTIVE : HOTEL_ENTITY_STATUS.ARCHIVED));


  const renderFormFields = () => (
    <React.Fragment>
      <FormField control={form.control} name="name" render={({ field }) => (<FormItem><RHFFormLabel>Rate Name *</RHFFormLabel><FormControl><Input placeholder="Standard Rate" {...field} className="w-[90%]" /></FormControl><FormMessage /></FormItem>)} />
      <FormField control={form.control} name="price" render={({ field }) => (<FormItem><RHFFormLabel>Price *</RHFFormLabel><FormControl><Input type="number" step="0.01" placeholder="100.00" {...field} className="w-[90%]" /></FormControl><FormMessage /></FormItem>)} />
      <FormField control={form.control} name="hours" render={({ field }) => (<FormItem><RHFFormLabel>Hours *</RHFFormLabel><FormControl><Input type="number" placeholder="24" {...field} className="w-[90%]" /></FormControl><FormMessage /></FormItem>)} />
      <FormField control={form.control} name="excess_hour_price" render={({ field }) => (<FormItem><RHFFormLabel>Excess Hour Price (Optional)</RHFFormLabel><FormControl><Input type="number" step="0.01" placeholder="10.00" {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl><FormMessage /></FormItem>)} />
      <FormField control={form.control} name="description" render={({ field }) => (<FormItem><RHFFormLabel>Description (Optional)</RHFFormLabel><FormControl><Textarea placeholder="Rate details..." {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl><FormMessage /></FormItem>)} />
      {isEditing && (
        <FormField control={form.control} name="status"
          render={({ field }) => (
            <FormItem>
              <RHFFormLabel>Status *</RHFFormLabel>
              <Select onValueChange={field.onChange} value={field.value?.toString() ?? HOTEL_ENTITY_STATUS.ACTIVE}>
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
      <CardHeader>
        <div className="flex items-center space-x-2">
          <Tags className="h-6 w-6 text-primary" />
          <CardTitle>Hotel Rates Management</CardTitle>
        </div>
        <CardDescription>Manage hotel rates for a selected branch.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end space-x-4">
            <div className="flex-grow space-y-2">
                <Label htmlFor="branch-select-trigger-rates">Select Branch</Label>
                <Select 
                    onValueChange={(value) => setSelectedBranchId(value ? parseInt(value) : null)}
                    value={selectedBranchId?.toString()}
                    disabled={isLoadingBranches || branches.length === 0}
                >
                    <SelectTrigger id="branch-select-trigger-rates">
                        <SelectValue placeholder={isLoadingBranches ? "Loading branches..." : (branches.length === 0 ? "No branches available" : "Select a branch")} />
                    </SelectTrigger>
                    <SelectContent>
                        {branches.map(branch => (
                            <SelectItem key={branch.id} value={branch.id.toString()}>{branch.branch_name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <Dialog
                key={isEditing ? `edit-rate-${selectedRate?.id}` : 'add-rate'}
                open={isAddDialogOpen || isEditDialogOpen}
                onOpenChange={(open) => {
                    if (!open) {
                        setIsAddDialogOpen(false);
                        setIsEditDialogOpen(false);
                        setSelectedRate(null); 
                        form.reset({ ...defaultFormValuesCreate, status: HOTEL_ENTITY_STATUS.ACTIVE });
                    }
                }}
            >
              <DialogTrigger asChild>
                <Button onClick={() => { setSelectedRate(null); form.reset({ ...defaultFormValuesCreate, status: HOTEL_ENTITY_STATUS.ACTIVE }); setIsAddDialogOpen(true); }} disabled={!selectedBranchId || isLoadingRates}>
                  <PlusCircle className="mr-2 h-4 w-4" /> Add Rate
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg p-3 flex flex-col max-h-[85vh]">
                <DialogHeader className="p-2 border-b"><DialogTitle>{isEditing ? `Edit Rate: ${selectedRate?.name}` : 'Add New Rate'}</DialogTitle></DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(isEditing ? (d => handleEditSubmit(d as HotelRateUpdateData)) : (d => handleAddSubmit(d as HotelRateCreateData)))} className="bg-card rounded-md flex flex-col flex-grow overflow-hidden">
                    <div className="flex-grow space-y-3 py-2 px-3 overflow-y-auto">
                      {renderFormFields()}
                    </div>
                    <DialogFooter className="bg-card py-2 border-t px-3 sticky bottom-0 z-10">
                      <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                      <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : (isEditing ? "Save Changes" : "Create Rate")}</Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
        </div>

        {selectedBranchId && isLoadingRates && <div className="flex justify-center items-center h-32"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2 text-muted-foreground">Loading rates...</p></div>}
        
        {selectedBranchId && !isLoadingRates && (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-4"><TabsTrigger value="active">Active</TabsTrigger><TabsTrigger value="archive">Archive</TabsTrigger></TabsList>
            <TabsContent value="active">
              {filteredRates.length === 0 && <p className="text-muted-foreground text-center py-8">No active rates found for this branch.</p>}
              {filteredRates.length > 0 && (
                <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Price</TableHead><TableHead>Hours</TableHead><TableHead>Excess Price/hr</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                  <TableBody>{filteredRates.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell>{r.price.toFixed(2)}</TableCell>
                      <TableCell>{r.hours}</TableCell>
                      <TableCell>{r.excess_hour_price ? r.excess_hour_price.toFixed(2) : '-'}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button variant="outline" size="sm" onClick={() => { setSelectedRate(r); setIsEditDialogOpen(true); setIsAddDialogOpen(false); }}><Edit className="mr-1 h-3 w-3" /> Edit</Button>
                        <AlertDialog><AlertDialogTrigger asChild><Button variant="destructive" size="sm" disabled={isSubmitting}><Trash2 className="mr-1 h-3 w-3" /> Archive</Button></AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>Confirm Archive</AlertDialogTitle><AlertDialogDescription>Are you sure you want to archive rate "{r.name}"?</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleArchive(r)} disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : "Archive"}</AlertDialogAction></AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>))}
                  </TableBody>
                </Table>)}
            </TabsContent>
            <TabsContent value="archive">
              {filteredRates.length === 0 && <p className="text-muted-foreground text-center py-8">No archived rates found for this branch.</p>}
              {filteredRates.length > 0 && (
                <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Price</TableHead><TableHead>Hours</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                  <TableBody>{filteredRates.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell>{r.price.toFixed(2)}</TableCell>
                      <TableCell>{r.hours}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => handleRestore(r)} disabled={isSubmitting}><ArchiveRestore className="mr-1 h-3 w-3" /> Restore</Button>
                      </TableCell>
                    </TableRow>))}
                  </TableBody>
                </Table>)}
            </TabsContent>
          </Tabs>
        )}
        {!selectedBranchId && !isLoadingBranches && branches.length > 0 && (
             <div className="text-center py-10 text-muted-foreground">
                <Building className="h-12 w-12 mx-auto mb-3 opacity-50" />
                Please select a branch to manage its rates.
            </div>
        )}
         {!isLoadingBranches && branches.length === 0 && (
             <div className="text-center py-10 text-muted-foreground">
                <Building className="h-12 w-12 mx-auto mb-3 opacity-50" />
                No branches available for this tenant. Please add a branch first.
            </div>
        )}
      </CardContent>
    </Card>
  );
}
