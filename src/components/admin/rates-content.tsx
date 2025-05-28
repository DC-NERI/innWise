
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
  adminUserId: number;
}

export default function RatesContent({ tenantId, adminUserId }: RatesContentProps) {
  const [branches, setBranches] = useState<SimpleBranch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(null);
  const [rates, setRates] = useState<HotelRate[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(true);
  const [isLoadingRates, setIsLoadingRates] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedRate, setSelectedRate] = useState<HotelRate | null>(null);
  const [activeTab, setActiveTab] = useState(HOTEL_ENTITY_STATUS.ACTIVE);
  const { toast } = useToast();

  const isEditing = !!selectedRate;

  const form = useForm<RateFormValues>({
  });

  const fetchBranches = useCallback(async () => {
    if (!tenantId) return;
    setIsLoadingBranches(true);
    try {
      const fetchedBranches = await getBranchesForTenantSimple(tenantId);
      setBranches(fetchedBranches.filter(b => b.status === HOTEL_ENTITY_STATUS.ACTIVE)); // Only show active branches for selection
      if (fetchedBranches.length > 0 && !selectedBranchId) {
        // Optionally auto-select the first branch
        // setSelectedBranchId(fetchedBranches[0].id);
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
        excess_hour_price: selectedRate.excess_hour_price ?? undefined,
        description: selectedRate.description || '',
        status: selectedRate.status || HOTEL_ENTITY_STATUS.ACTIVE,
      };
    } else {
      newDefaults = { ...defaultFormValuesCreate, status: HOTEL_ENTITY_STATUS.ACTIVE };
    }
    form.reset(newDefaults, { resolver: newResolver } as any);
  }, [selectedRate, form, isEditDialogOpen, isAddDialogOpen]);


  const handleAddSubmit = async (data: HotelRateCreateData) => {
    if (!selectedBranchId || !tenantId || !adminUserId) {
      toast({ title: "Error", description: "Branch, Tenant, or Admin User ID must be selected/available.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await createRate(data, tenantId, selectedBranchId); // Removed adminUserId as createRate action doesn't expect it
      if (result.success && result.rate) {
        toast({ title: "Success", description: "Rate created." });
        setRates(prev => [...prev, result.rate!].sort((a, b) => a.name.localeCompare(b.name)));
        setIsAddDialogOpen(false);
        fetchRates(selectedBranchId); // Re-fetch rates for the current branch
      } else {
        toast({ title: "Creation Failed", description: result.message, variant: "destructive" });
      }
    } catch (e) { toast({ title: "Error", description: "Unexpected error during rate creation.", variant: "destructive" }); }
    finally { setIsSubmitting(false); }
  };

  const handleEditSubmit = async (data: HotelRateUpdateData) => {
    if (!selectedRate || !selectedBranchId || !tenantId || !adminUserId) return;
    setIsSubmitting(true);
    try {
      const result = await updateRate(selectedRate.id, data, tenantId, selectedBranchId); // Removed adminUserId as updateRate action doesn't expect it
      if (result.success && result.rate) {
        toast({ title: "Success", description: "Rate updated." });
        setRates(prev => prev.map(r => r.id === result.rate!.id ? result.rate! : r).sort((a, b) => a.name.localeCompare(b.name)));
        setIsEditDialogOpen(false); setSelectedRate(null);
        fetchRates(selectedBranchId); // Re-fetch rates
      } else {
        toast({ title: "Update Failed", description: result.message, variant: "destructive" });
      }
    } catch (e) { toast({ title: "Error", description: "Unexpected error during rate update.", variant: "destructive" }); }
    finally { setIsSubmitting(false); }
  };

  const handleArchive = async (rate: HotelRate) => {
    if (!tenantId || !rate.branch_id || !adminUserId) return;
    setIsSubmitting(true);
    try {
      const result = await archiveRate(rate.id, tenantId, rate.branch_id); // Removed adminUserId as archiveRate action doesn't expect it
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
    if (!tenantId || !rate.branch_id || !adminUserId) return;
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
      const result = await updateRate(rate.id, payload, tenantId, rate.branch_id); // Removed adminUserId
      if (result.success && result.rate) {
        toast({ title: "Success", description: `Rate "${rate.name}" restored.` });
        setRates(prev => prev.map(r => r.id === result.rate!.id ? result.rate! : r));
      } else {
        toast({ title: "Restore Failed", description: result.message, variant: "destructive" });
      }
    } catch (e) { toast({ title: "Error", description: "Unexpected error during restore.", variant: "destructive" }); }
    finally { setIsSubmitting(false); }
  };

  const filteredRates = rates.filter(rate => rate.status === activeTab);

  const renderRateFormFields = () => (
    <React.Fragment>
      <FormField control={form.control} name="name" render={({ field }) => (<FormItem><RHFFormLabel>Rate Name *</RHFFormLabel><FormControl><Input placeholder="Standard Rate" {...field} className="w-[90%]" /></FormControl><FormMessage /></FormItem>)} />
      <FormField control={form.control} name="price" render={({ field }) => (<FormItem><RHFFormLabel>Price *</RHFFormLabel><FormControl><Input type="number" step="0.01" placeholder="100.00" {...field} onChange={e => field.onChange(parseFloat(e.target.value))} className="w-[90%]" /></FormControl><FormMessage /></FormItem>)} />
      <FormField control={form.control} name="hours" render={({ field }) => (<FormItem><RHFFormLabel>Hours *</RHFFormLabel><FormControl><Input type="number" placeholder="24" {...field} onChange={e => field.onChange(parseInt(e.target.value, 10))} className="w-[90%]" /></FormControl><FormMessage /></FormItem>)} />
      <FormField control={form.control} name="excess_hour_price" render={({ field }) => (<FormItem><RHFFormLabel>Excess Hour Price (Optional)</RHFFormLabel><FormControl><Input type="number" step="0.01" placeholder="10.00" {...field} onChange={e => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)} value={field.value ?? ''} className="w-[90%]" /></FormControl><FormMessage /></FormItem>)} />
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

  const selectedBranchName = branches.find(b => b.id === selectedBranchId)?.branch_name;

  return (
    <div className="flex flex-col md:flex-row gap-6">
      <Card className="md:w-2/5"> {/* Approx 40% width */}
        <CardHeader>
          <div className="flex items-center space-x-2">
            <Building className="h-6 w-6 text-primary" />
            <CardTitle>Select Branch</CardTitle>
          </div>
          <CardDescription>Click a branch to view its rates.</CardDescription>
        </CardHeader>
        <CardContent className="max-h-[70vh] overflow-y-auto">
          {isLoadingBranches ? (
            <div className="flex justify-center items-center h-32"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
          ) : branches.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No active branches available for this tenant.</p>
          ) : (
            <ul className="space-y-1">
              {branches.map(branch => (
                <li key={branch.id}>
                  <Button
                    variant={selectedBranchId === branch.id ? "secondary" : "ghost"}
                    className="w-full justify-start text-left h-auto py-2"
                    onClick={() => setSelectedBranchId(branch.id)}
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{branch.branch_name}</span>
                      {/* <span className="text-xs text-muted-foreground">{branch.branch_code}</span> */}
                    </div>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="md:w-3/5"> {/* Approx 60% width */}
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
                <div className="flex items-center space-x-2">
                    <Tags className="h-6 w-6 text-primary" />
                    <CardTitle>
                        {selectedBranchId ? `Rates for: ${selectedBranchName || 'Branch'}` : 'Hotel Rates Management'}
                    </CardTitle>
                </div>
                <CardDescription>
                    {selectedBranchId ? 'Manage rates for the selected branch.' : 'Please select a branch to view and manage its rates.'}
                </CardDescription>
            </div>
            {selectedBranchId && (
                <Dialog
                    key={isEditing ? `edit-rate-${selectedRate?.id}` : `add-rate-branch-${selectedBranchId}`}
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
                    <Button onClick={() => { setSelectedRate(null); form.reset({ ...defaultFormValuesCreate, status: HOTEL_ENTITY_STATUS.ACTIVE }); setIsAddDialogOpen(true); setIsEditDialogOpen(false); }} disabled={!selectedBranchId || isLoadingRates}>
                    <PlusCircle className="mr-2 h-4 w-4" /> Add Rate
                    </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-lg p-3 flex flex-col max-h-[85vh]">
                    <DialogHeader className="p-2 border-b"><DialogTitle>{isEditing ? `Edit Rate: ${selectedRate?.name}` : 'Add New Rate'}</DialogTitle></DialogHeader>
                    <Form {...form}>
                    <form onSubmit={form.handleSubmit(isEditing ? (d => handleEditSubmit(d as HotelRateUpdateData)) : (d => handleAddSubmit(d as HotelRateCreateData)))} className="bg-card rounded-md flex flex-col flex-grow overflow-hidden">
                        <div className="flex-grow space-y-3 p-1 overflow-y-auto">
                        {renderRateFormFields()}
                        </div>
                        <DialogFooter className="bg-card py-2 border-t px-3 sticky bottom-0 z-10">
                        <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                        <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : (isEditing ? "Save Changes" : "Create Rate")}</Button>
                        </DialogFooter>
                    </form>
                    </Form>
                </DialogContent>
                </Dialog>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!selectedBranchId ? (
            <div className="text-center py-10 text-muted-foreground">
              <Building className="h-12 w-12 mx-auto mb-3 opacity-50" />
              Please select a branch from the left to view its rates.
            </div>
          ) : isLoadingRates ? (
            <div className="flex justify-center items-center h-32"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2 text-muted-foreground">Loading rates...</p></div>
          ) : (
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="mb-4"><TabsTrigger value={HOTEL_ENTITY_STATUS.ACTIVE}>Active</TabsTrigger><TabsTrigger value={HOTEL_ENTITY_STATUS.ARCHIVED}>Archive</TabsTrigger></TabsList>
              <TabsContent value={HOTEL_ENTITY_STATUS.ACTIVE}>
                {filteredRates.length === 0 && <p className="text-muted-foreground text-center py-8">No active rates found for this branch.</p>}
                {filteredRates.length > 0 && (
                  <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Price</TableHead><TableHead>Hours</TableHead><TableHead>Excess Price/hr</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                    <TableBody>{filteredRates.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell>₱{r.price.toFixed(2)}</TableCell>
                        <TableCell>{r.hours}</TableCell>
                        <TableCell>{r.excess_hour_price ? `₱${r.excess_hour_price.toFixed(2)}` : '-'}</TableCell>
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
              <TabsContent value={HOTEL_ENTITY_STATUS.ARCHIVED}>
                {filteredRates.length === 0 && <p className="text-muted-foreground text-center py-8">No archived rates found for this branch.</p>}
                {filteredRates.length > 0 && (
                  <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Price</TableHead><TableHead>Hours</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                    <TableBody>{filteredRates.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell>₱{r.price.toFixed(2)}</TableCell>
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
        </CardContent>
      </Card>
    </div>
  );
}
