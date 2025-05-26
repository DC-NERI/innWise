"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, PlusCircle, Edit3, Archive as LostAndFoundIcon, RefreshCw, Search as SearchIcon } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import type { LostAndFoundLog, SimpleBranch } from '@/lib/types';
import { 
  lostAndFoundCreateSchema, LostAndFoundCreateData, 
  lostAndFoundUpdateStatusSchema, LostAndFoundUpdateStatusData 
} from '@/lib/schemas';
import { listLostAndFoundItemsForTenant } from '@/actions/admin/lostandfound/listLostAndFoundItemsForTenant';
import { addLostAndFoundItem } from '@/actions/staff/lostandfound/addLostAndFoundItem'; // Reusing staff action
import { updateLostAndFoundItemStatus } from '@/actions/staff/lostandfound/updateLostAndFoundItemStatus'; // Reusing staff action
import { getBranchesForTenantSimple } from '@/actions/admin/branches/getBranchesForTenantSimple';
import { LOST_AND_FOUND_STATUS, LOST_AND_FOUND_STATUS_TEXT, LOST_AND_FOUND_STATUS_OPTIONS, HOTEL_ENTITY_STATUS } from '@/lib/constants';
import { format as formatDateTime, parseISO } from 'date-fns';

interface LostAndFoundAdminContentProps {
  tenantId: number;
  adminUserId: number;
}

const defaultCreateFormValues: LostAndFoundCreateData & { target_branch_id?: number } = {
  item_name: '',
  description: '',
  found_location: '',
  target_branch_id: undefined,
};

const defaultUpdateStatusFormValues: LostAndFoundUpdateStatusData = {
  status: LOST_AND_FOUND_STATUS.FOUND,
  claimed_by_details: '',
  disposed_details: '',
};

export default function LostAndFoundAdminContent({ tenantId, adminUserId }: LostAndFoundAdminContentProps) {
  const [items, setItems] = useState<LostAndFoundLog[]>([]);
  const [tenantBranches, setTenantBranches] = useState<SimpleBranch[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(true);
  const [isLoadingBranches, setIsLoadingBranches] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isUpdateStatusDialogOpen, setIsUpdateStatusDialogOpen] = useState(false);
  const [selectedItemForUpdate, setSelectedItemForUpdate] = useState<LostAndFoundLog | null>(null);
  const [activeItemStatusTab, setActiveItemStatusTab] = useState<string>(LOST_AND_FOUND_STATUS.FOUND.toString());
  const [searchTerm, setSearchTerm] = useState('');
  const { toast } = useToast();

  const addItemForm = useForm<LostAndFoundCreateData & { target_branch_id?: number }>({
    resolver: zodResolver(lostAndFoundCreateSchema.extend({
      target_branch_id: z.coerce.number().int().positive({ message: "Target branch is required." })
    })),
    defaultValues: defaultCreateFormValues,
  });

  const updateStatusForm = useForm<LostAndFoundUpdateStatusData>({
    resolver: zodResolver(lostAndFoundUpdateStatusSchema),
    defaultValues: defaultUpdateStatusFormValues,
  });

  const watchedStatusInUpdateForm = useWatch({ control: updateStatusForm.control, name: 'status' });

  const fetchTenantData = useCallback(async () => {
    if (!tenantId) return;
    setIsLoadingBranches(true);
    setIsLoadingItems(true);
    try {
      const [fetchedItems, fetchedBranches] = await Promise.all([
        listLostAndFoundItemsForTenant(tenantId),
        getBranchesForTenantSimple(tenantId)
      ]);
      setItems(fetchedItems);
      setTenantBranches(fetchedBranches.filter(b => b.status === HOTEL_ENTITY_STATUS.ACTIVE));
    } catch (error) {
      toast({ title: "Error", description: "Could not fetch initial lost & found data.", variant: "destructive" });
      setItems([]);
      setTenantBranches([]);
    } finally {
      setIsLoadingBranches(false);
      setIsLoadingItems(false);
    }
  }, [tenantId, toast]);

  useEffect(() => {
    fetchTenantData();
  }, [fetchTenantData]);

  useEffect(() => {
    if (selectedItemForUpdate) {
      updateStatusForm.reset({
        status: selectedItemForUpdate.status || LOST_AND_FOUND_STATUS.FOUND,
        claimed_by_details: selectedItemForUpdate.claimed_by_details || '',
        disposed_details: selectedItemForUpdate.disposed_details || '',
      });
    }
  }, [selectedItemForUpdate, updateStatusForm]);

  const handleAddItemSubmit = async (data: LostAndFoundCreateData & { target_branch_id: number }) => {
    if (!adminUserId) {
      toast({ title: "Error", description: "Admin User ID not available.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    const { target_branch_id, ...itemData } = data;
    try {
      const result = await addLostAndFoundItem(itemData, tenantId, target_branch_id, adminUserId);
      if (result.success && result.item) {
        toast({ title: "Success", description: "Item logged successfully." });
        setItems(prev => [result.item!, ...prev].sort((a,b) => new Date(b.found_at || 0).getTime() - new Date(a.found_at || 0).getTime()));
        setIsAddDialogOpen(false);
        addItemForm.reset(defaultCreateFormValues);
      } else {
        toast({ title: "Logging Failed", description: result.message || "Could not log item.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "An unexpected error occurred.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenUpdateStatusDialog = (item: LostAndFoundLog) => {
    setSelectedItemForUpdate(item);
    setIsUpdateStatusDialogOpen(true);
  };

  const handleUpdateStatusSubmit = async (data: LostAndFoundUpdateStatusData) => {
    if (!selectedItemForUpdate || !selectedItemForUpdate.branch_id || !adminUserId) {
         toast({ title: "Error", description: "User, item, or branch information not available for update.", variant: "destructive" });
        return;
    }
    setIsSubmitting(true);
    try {
      const result = await updateLostAndFoundItemStatus(selectedItemForUpdate.id, data, tenantId, selectedItemForUpdate.branch_id, adminUserId);
      if (result.success && result.item) {
        toast({ title: "Success", description: "Item status updated." });
        setItems(prev => prev.map(i => i.id === result.item!.id ? result.item! : i).sort((a,b) => new Date(b.found_at || 0).getTime() - new Date(a.found_at || 0).getTime()));
        setIsUpdateStatusDialogOpen(false);
        setSelectedItemForUpdate(null);
      } else {
        toast({ title: "Update Failed", description: result.message || "Could not update item status.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "An unexpected error occurred.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getFilteredItemsForStatusTab = (statusValue: number) => {
    return items.filter(item => {
      const statusMatch = (item.status || LOST_AND_FOUND_STATUS.FOUND) === statusValue;
      if (!statusMatch) return false;
      if (!searchTerm.trim()) return true;
      const lowerSearchTerm = searchTerm.toLowerCase();
      return (
        item.item_name.toLowerCase().includes(lowerSearchTerm) ||
        (item.description && item.description.toLowerCase().includes(lowerSearchTerm)) ||
        (item.branch_name && item.branch_name.toLowerCase().includes(lowerSearchTerm))
      );
    });
  };

  if (isLoadingBranches) {
    return <div className="flex justify-center items-center h-32"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2 text-muted-foreground">Loading initial data...</p></div>;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <LostAndFoundIcon className="h-6 w-6 text-primary" />
            <CardTitle>Lost &amp; Found Log (Admin)</CardTitle>
          </div>
          <CardDescription>Manage lost and found items across all tenant branches.</CardDescription>
        </div>
        <div className="flex items-center space-x-2">
            <Button variant="outline" onClick={fetchTenantData} disabled={isLoadingItems}>
                <RefreshCw className={`mr-2 h-4 w-4 ${isLoadingItems ? 'animate-spin' : ''}`} /> Refresh Items
            </Button>
            <Dialog open={isAddDialogOpen} onOpenChange={(open) => {
                if (!open) addItemForm.reset(defaultCreateFormValues);
                setIsAddDialogOpen(open);
            }}>
                <DialogTrigger asChild>
                <Button disabled={isLoadingBranches || tenantBranches.length === 0} title={tenantBranches.length === 0 ? "No active branches to assign item" : "Add new item"}>
                    <PlusCircle className="mr-2 h-4 w-4" /> Add New Item
                </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-lg p-3 flex flex-col max-h-[85vh]">
                <DialogHeader className="p-2 border-b"><DialogTitle>Log New Lost &amp; Found Item</DialogTitle></DialogHeader>
                <Form {...addItemForm}>
                    <form onSubmit={addItemForm.handleSubmit(handleAddItemSubmit)} className="bg-card rounded-md flex flex-col flex-grow overflow-hidden">
                    <div className="flex-grow overflow-y-auto p-1 space-y-3">
                        <FormField control={addItemForm.control} name="target_branch_id" render={({ field }) => (
                        <FormItem>
                            <FormLabel>Target Branch *</FormLabel>
                            <Select onValueChange={(value) => field.onChange(value ? parseInt(value) : undefined)} value={field.value?.toString()} disabled={tenantBranches.length === 0}>
                            <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder={tenantBranches.length === 0 ? "No active branches" : "Select branch for the item"} /></SelectTrigger></FormControl>
                            <SelectContent>{tenantBranches.map(branch => (<SelectItem key={branch.id} value={branch.id.toString()}>{branch.branch_name}</SelectItem>))}</SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                        )} />
                        <FormField control={addItemForm.control} name="item_name" render={({ field }) => (
                        <FormItem><FormLabel>Item Name *</FormLabel><FormControl><Input placeholder="E.g., Black Wallet, iPhone 13" {...field} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={addItemForm.control} name="description" render={({ field }) => (
                        <FormItem><FormLabel>Description (Optional)</FormLabel><FormControl><Textarea placeholder="Detailed description of the item..." {...field} value={field.value ?? ''} className="w-[90%]" rows={3} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={addItemForm.control} name="found_location" render={({ field }) => (
                        <FormItem><FormLabel>Location Found (Optional)</FormLabel><FormControl><Input placeholder="E.g., Lobby, Room 101" {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
                        )} />
                    </div>
                    <DialogFooter className="bg-card py-2 border-t px-3 sticky bottom-0 z-10">
                        <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                        <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : "Log Item"}</Button>
                    </DialogFooter>
                    </form>
                </Form>
                </DialogContent>
            </Dialog>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative mt-4 mb-4">
          <SearchIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search by item name, description, or branch..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 w-full sm:w-1/2"
          />
        </div>

        {isLoadingItems && <div className="flex justify-center items-center h-32"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2 text-muted-foreground">Loading items...</p></div>}
        
        {!isLoadingItems && (
          <Tabs value={activeItemStatusTab} onValueChange={setActiveItemStatusTab}>
            <TabsList className="grid w-full grid-cols-3 mb-4">
              {LOST_AND_FOUND_STATUS_OPTIONS.map(opt => (
                <TabsTrigger key={`item-status-tab-${opt.value}`} value={opt.value.toString()}>
                  {opt.label} ({getFilteredItemsForStatusTab(opt.value).length})
                </TabsTrigger>
              ))}
            </TabsList>
            {LOST_AND_FOUND_STATUS_OPTIONS.map(opt => {
              const currentFilteredItems = getFilteredItemsForStatusTab(opt.value);
              return (
                <TabsContent key={`item-status-content-${opt.value}`} value={opt.value.toString()}>
                  {currentFilteredItems.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">No items in '{opt.label}' status {searchTerm.trim() ? `matching "${searchTerm}"` : ''}.</p>
                  ) : (
                    <div className="max-h-[60vh] overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Branch</TableHead>
                            <TableHead>Item Name</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead>Location</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Found At</TableHead>
                            <TableHead>Reported By</TableHead>
                            <TableHead>Claimed At</TableHead>
                            <TableHead>Claimed By</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {currentFilteredItems.map(item => (
                            <TableRow key={item.id}>
                              <TableCell>{item.branch_name || 'N/A'}</TableCell>
                              <TableCell className="font-medium max-w-xs truncate" title={item.item_name}>{item.item_name}</TableCell>
                              <TableCell className="max-w-xs truncate" title={item.description || undefined}>{item.description || '-'}</TableCell>
                              <TableCell>{item.found_location || '-'}</TableCell>
                              <TableCell>{LOST_AND_FOUND_STATUS_TEXT[item.status || LOST_AND_FOUND_STATUS.FOUND]}</TableCell>
                              <TableCell>{item.found_at ? formatDateTime(parseISO(item.found_at.replace(' ', 'T')), 'yyyy-MM-dd hh:mm aa') : 'N/A'}</TableCell>
                              <TableCell>{item.reported_by_username || '-'}</TableCell>
                              <TableCell>{item.claimed_at ? formatDateTime(parseISO(item.claimed_at.replace(' ', 'T')), 'yyyy-MM-dd hh:mm aa') : '-'}</TableCell>
                              <TableCell className="max-w-xs truncate" title={item.claimed_by_details || undefined}>{item.claimed_by_details || '-'}</TableCell>
                              <TableCell className="text-right">
                                <Button variant="outline" size="sm" onClick={() => handleOpenUpdateStatusDialog(item)}>
                                  <Edit3 className="mr-1 h-3 w-3" /> Update Status
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </TabsContent>
              );
            })}
          </Tabs>
        )}
      </CardContent>

      <Dialog open={isUpdateStatusDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setSelectedItemForUpdate(null);
          updateStatusForm.reset(defaultUpdateStatusFormValues);
        }
        setIsUpdateStatusDialogOpen(open);
      }}>
        <DialogContent className="sm:max-w-lg p-3 flex flex-col max-h-[85vh]">
          <DialogHeader className="p-2 border-b">
            <DialogTitle>Update Status: {selectedItemForUpdate?.item_name}</DialogTitle>
            <CardDescription>Found at: {selectedItemForUpdate?.found_at ? formatDateTime(parseISO(selectedItemForUpdate.found_at.replace(' ', 'T')), 'yyyy-MM-dd hh:mm aa') : 'N/A'}</CardDescription>
          </DialogHeader>
          <Form {...updateStatusForm}>
            <form onSubmit={updateStatusForm.handleSubmit(handleUpdateStatusSubmit)} className="bg-card rounded-md flex flex-col flex-grow overflow-hidden">
              <div className="flex-grow overflow-y-auto p-1 space-y-3">
                <FormField control={updateStatusForm.control} name="status" render={({ field }) => (
                  <FormItem><FormLabel>New Status *</FormLabel>
                    <Select onValueChange={(value) => field.onChange(Number(value))} value={field.value?.toString()}>
                      <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder="Select new status" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {LOST_AND_FOUND_STATUS_OPTIONS.map(opt => (
                          <SelectItem key={opt.value} value={opt.value.toString()}>{opt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select><FormMessage />
                  </FormItem>
                )} />
                {watchedStatusInUpdateForm === LOST_AND_FOUND_STATUS.CLAIMED && (
                  <FormField control={updateStatusForm.control} name="claimed_by_details" render={({ field }) => (
                    <FormItem><FormLabel>Claimed By Details *</FormLabel><FormControl><Textarea placeholder="Name, contact, ID, etc." {...field} value={field.value ?? ''} className="w-[90%]" rows={3} /></FormControl><FormMessage /></FormItem>
                  )} />
                )}
                {watchedStatusInUpdateForm === LOST_AND_FOUND_STATUS.DISPOSED && (
                  <FormField control={updateStatusForm.control} name="disposed_details" render={({ field }) => (
                    <FormItem><FormLabel>Disposal Details *</FormLabel><FormControl><Textarea placeholder="How was it disposed? E.g., Donated, Discarded." {...field} value={field.value ?? ''} className="w-[90%]" rows={3} /></FormControl><FormMessage /></FormItem>
                  )} />
                )}
              </div>
              <DialogFooter className="bg-card py-2 border-t px-3 sticky bottom-0 z-10">
                <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : "Save Status"}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
