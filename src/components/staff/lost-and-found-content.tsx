
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
import { Loader2, PlusCircle, Edit3, Archive as LostAndFoundIcon, RefreshCw } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import type { LostAndFoundLog } from '@/lib/types';
import { lostAndFoundCreateSchema, LostAndFoundCreateData, lostAndFoundUpdateStatusSchema, LostAndFoundUpdateStatusData } from '@/lib/schemas';
import { listLostAndFoundItems } from '@/actions/staff/lostandfound/listLostAndFoundItems';
import { addLostAndFoundItem } from '@/actions/staff/lostandfound/addLostAndFoundItem';
import { updateLostAndFoundItemStatus } from '@/actions/staff/lostandfound/updateLostAndFoundItemStatus';
import { LOST_AND_FOUND_STATUS, LOST_AND_FOUND_STATUS_TEXT, LOST_AND_FOUND_STATUS_OPTIONS } from '@/lib/constants';
import { format as formatDateTime, parseISO } from 'date-fns';

interface LostAndFoundContentProps {
  tenantId: number;
  branchId: number;
  staffUserId: number;
}

const defaultCreateFormValues: LostAndFoundCreateData = {
  item_name: '',
  description: '',
  found_location: '',
};

const defaultUpdateStatusFormValues: LostAndFoundUpdateStatusData = {
  status: LOST_AND_FOUND_STATUS.FOUND,
  claimed_by_details: '',
  disposed_details: '',
};

export default function LostAndFoundContent({ tenantId, branchId, staffUserId }: LostAndFoundContentProps) {
  const [items, setItems] = useState<LostAndFoundLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isUpdateStatusDialogOpen, setIsUpdateStatusDialogOpen] = useState(false);
  const [selectedItemForUpdate, setSelectedItemForUpdate] = useState<LostAndFoundLog | null>(null);
  const [activeTab, setActiveTab] = useState<string>(LOST_AND_FOUND_STATUS.FOUND.toString());
  const { toast } = useToast();

  const addItemForm = useForm<LostAndFoundCreateData>({
    resolver: zodResolver(lostAndFoundCreateSchema),
    defaultValues: defaultCreateFormValues,
  });

  const updateStatusForm = useForm<LostAndFoundUpdateStatusData>({
    resolver: zodResolver(lostAndFoundUpdateStatusSchema),
    defaultValues: defaultUpdateStatusFormValues,
  });

  const watchedStatusInUpdateForm = useWatch({ control: updateStatusForm.control, name: 'status' });

  const fetchItems = useCallback(async () => {
    if (!tenantId || !branchId) return;
    setIsLoading(true);
    try {
      const fetchedItems = await listLostAndFoundItems(tenantId, branchId);
      setItems(fetchedItems);
    } catch (error) {
      toast({ title: "Error", description: "Could not fetch lost and found items.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [tenantId, branchId, toast]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
      if (selectedItemForUpdate) {
        updateStatusForm.reset({
          status: (selectedItemForUpdate.status ?? LOST_AND_FOUND_STATUS.FOUND) as 0 | 1 | 2,
          claimed_by_details: selectedItemForUpdate.claimed_by_details || '',
          disposed_details: selectedItemForUpdate.disposed_details || '',
        });
      }
    }, [selectedItemForUpdate, updateStatusForm]);

  const handleAddItemSubmit = async (data: LostAndFoundCreateData) => {
    if (!staffUserId) {
      toast({ title: "Error", description: "User information not available.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await addLostAndFoundItem(data, tenantId, branchId, staffUserId);
      if (result.success && result.item) {
        toast({ title: "Success", description: "Item logged successfully." });
        setItems(prev => [result.item!, ...prev].sort((a,b) => new Date(b.found_at).getTime() - new Date(a.found_at).getTime()));
        setIsAddDialogOpen(false);
        addItemForm.reset(defaultCreateFormValues);
      } else {
        toast({ title: "Logging Failed", description: result.message, variant: "destructive" });
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
    if (!selectedItemForUpdate || !staffUserId) {
         toast({ title: "Error", description: "User or item information not available.", variant: "destructive" });
        return;
    }
    setIsSubmitting(true);
    try {
      const result = await updateLostAndFoundItemStatus(selectedItemForUpdate.id, data, tenantId, branchId, staffUserId);
      if (result.success && result.item) {
        toast({ title: "Success", description: "Item status updated." });
        setItems(prev => prev.map(i => i.id === result.item!.id ? result.item! : i).sort((a,b) => new Date(b.found_at).getTime() - new Date(a.found_at).getTime()));
        setIsUpdateStatusDialogOpen(false);
        setSelectedItemForUpdate(null);
      } else {
        toast({ title: "Update Failed", description: result.message, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "An unexpected error occurred.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredItems = items.filter(item => item.status.toString() === activeTab);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <LostAndFoundIcon className="h-6 w-6 text-primary" />
            <CardTitle>Lost & Found Log</CardTitle>
          </div>
          <CardDescription>Manage items reported as lost and found in your branch.</CardDescription>
        </div>
        <div className="flex items-center space-x-2">
            <Button variant="outline" onClick={fetchItems} disabled={isLoading}>
                <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
            <Dialog open={isAddDialogOpen} onOpenChange={(open) => {
                if (!open) addItemForm.reset(defaultCreateFormValues);
                setIsAddDialogOpen(open);
            }}>
            <DialogTrigger asChild>
              <Button><PlusCircle className="mr-2 h-4 w-4" /> Add New Item</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg p-3 flex flex-col max-h-[85vh]">
              <DialogHeader className="p-2 border-b"><DialogTitle>Log New Lost & Found Item</DialogTitle></DialogHeader>
              <Form {...addItemForm}>
                <form onSubmit={addItemForm.handleSubmit(handleAddItemSubmit)} className="bg-card rounded-md flex flex-col flex-grow overflow-hidden">
                  <div className="flex-grow overflow-y-auto p-1 space-y-3">
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
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3 mb-4">
            {LOST_AND_FOUND_STATUS_OPTIONS.map(opt => (
              <TabsTrigger key={opt.value} value={opt.value.toString()}>
                {opt.label} ({items.filter(i => i.status.toString() === opt.value.toString()).length})
              </TabsTrigger>
            ))}
          </TabsList>
          {LOST_AND_FOUND_STATUS_OPTIONS.map(opt => (
            <TabsContent key={`tab-content-${opt.value}`} value={opt.value.toString()}>
              {isLoading ? (
                <div className="flex justify-center items-center h-32"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
              ) : filteredItems.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No items in '{opt.label}' status.</p>
              ) : (
                <div className="max-h-[60vh] overflow-y-auto">
                    <Table>
                    <TableHeader>
                        <TableRow>
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
                        {filteredItems.map(item => (
                        <TableRow key={item.id}>
                            <TableCell className="font-medium max-w-xs truncate" title={item.item_name}>{item.item_name}</TableCell>
                            <TableCell className="max-w-xs truncate" title={item.description || undefined}>{item.description || '-'}</TableCell>
                            <TableCell>{item.found_location || '-'}</TableCell>
                            <TableCell>{LOST_AND_FOUND_STATUS_TEXT[item.status]}</TableCell>
                            <TableCell>{formatDateTime(parseISO(item.found_at.replace(' ', 'T')), 'yyyy-MM-dd hh:mm aa')}</TableCell>
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
          ))}
        </Tabs>
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
