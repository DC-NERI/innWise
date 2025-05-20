
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogTrigger } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Bell, CheckSquare, CalendarPlus, PlusCircle } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import type { Notification, SimpleRate, SimpleBranch, TransactionCreateData } from '@/lib/types';
import { notificationCreateSchema, NotificationCreateData, transactionCreateSchema } from '@/lib/schemas'; // Using transactionCreateSchema for sub-form
import { listNotificationsForTenant, markNotificationAsRead, updateNotificationTransactionStatus, getRatesForBranchSimple, getBranchesForTenantSimple, createNotification } from '@/actions/admin';
import { createUnassignedReservation } from '@/actions/staff';
import { NOTIFICATION_STATUS, NOTIFICATION_STATUS_TEXT, NOTIFICATION_TRANSACTION_STATUS, NOTIFICATION_TRANSACTION_STATUS_TEXT, TRANSACTION_IS_ACCEPTED_STATUS_TEXT, TRANSACTION_STATUS } from '@/lib/constants';
import { format, parseISO, addDays, setHours, setMinutes, setSeconds, setMilliseconds } from 'date-fns';

interface NotificationsContentProps {
  tenantId: number;
  adminUserId: number;
}

const getDefaultCheckInDateTimeString = (): string => {
  const now = new Date();
  const checkIn = setMilliseconds(setSeconds(setMinutes(setHours(now, 14), 0), 0), 0);
  return format(checkIn, "yyyy-MM-dd'T'HH:mm");
};

const getDefaultCheckOutDateTimeString = (checkInDateString?: string | null): string => {
  let baseDate = new Date();
  if (checkInDateString) {
    try {
        const parsedCheckIn = parseISO(checkInDateString.replace(' ', 'T'));
        if (!isNaN(parsedCheckIn.getTime())) {
            baseDate = parsedCheckIn;
        }
    } catch (e) { /* ignore */ }
  } else {
    baseDate = setMilliseconds(setSeconds(setMinutes(setHours(baseDate, 14), 0), 0), 0);
  }
  const checkOut = setMilliseconds(setSeconds(setMinutes(setHours(addDays(baseDate, 1), 12), 0), 0), 0);
  return format(checkOut, "yyyy-MM-dd'T'HH:mm");
};

const defaultNotificationFormValues: NotificationCreateData = {
    message: '',
    target_branch_id: undefined,
    do_reservation: false,
    reservation_client_name: '',
    reservation_selected_rate_id: undefined,
    reservation_client_payment_method: undefined,
    reservation_notes: '',
    reservation_is_advance: false,
    reservation_check_in_datetime: null,
    reservation_check_out_datetime: null,
};

export default function NotificationsContent({ tenantId, adminUserId }: NotificationsContentProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreateReservationDialogOpen, setIsCreateReservationDialogOpen] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);
  
  const [availableTenantBranches, setAvailableTenantBranches] = useState<SimpleBranch[]>([]);
  const [isAddNotificationDialogOpen, setIsAddNotificationDialogOpen] = useState(false);

  const [ratesForCreateReservationDialog, setRatesForCreateReservationDialog] = useState<SimpleRate[]>([]);
  const [ratesForAddNotificationSubForm, setRatesForAddNotificationSubForm] = useState<SimpleRate[]>([]);


  const { toast } = useToast();

  const createReservationForm = useForm<TransactionCreateData>({
    resolver: zodResolver(transactionCreateSchema),
    defaultValues: {
        client_name: '',
        selected_rate_id: undefined,
        client_payment_method: undefined,
        notes: '',
        is_advance_reservation: false,
        reserved_check_in_datetime: null,
        reserved_check_out_datetime: null,
    }
  });
  const watchIsAdvanceReservationCreate = createReservationForm.watch("is_advance_reservation");

  const addNotificationForm = useForm<NotificationCreateData>({
    resolver: zodResolver(notificationCreateSchema),
    defaultValues: defaultNotificationFormValues,
  });

  const watchTargetBranchForNotif = addNotificationForm.watch("target_branch_id");
  const watchDoReservationForNotif = addNotificationForm.watch("do_reservation");
  const watchIsAdvanceForNotifSubForm = addNotificationForm.watch("reservation_is_advance");

  const fetchNotificationsAndBranches = useCallback(async () => {
    if (!tenantId) return;
    setIsLoading(true);
    try {
      const [notifData, branchData] = await Promise.all([
        listNotificationsForTenant(tenantId),
        getBranchesForTenantSimple(tenantId)
      ]);
      setNotifications(notifData);
      setAvailableTenantBranches(branchData);
    } catch (error) {
      toast({ title: "Error", description: "Could not fetch initial data.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [tenantId, toast]);

  useEffect(() => {
    fetchNotificationsAndBranches();
  }, [fetchNotificationsAndBranches]);

  // Effect for "Create Reservation" dialog from existing notification
   useEffect(() => {
    if (watchIsAdvanceReservationCreate && isCreateReservationDialogOpen) {
        if (!createReservationForm.getValues('reserved_check_in_datetime')) {
            createReservationForm.setValue('reserved_check_in_datetime', getDefaultCheckInDateTimeString(), { shouldValidate: true });
        }
        const currentCheckIn = createReservationForm.getValues('reserved_check_in_datetime');
        if (!createReservationForm.getValues('reserved_check_out_datetime')) {
             createReservationForm.setValue('reserved_check_out_datetime', getDefaultCheckOutDateTimeString(currentCheckIn), { shouldValidate: true });
        }
    } else if (isCreateReservationDialogOpen) { // If not advance, clear the dates
        createReservationForm.setValue('reserved_check_in_datetime', null);
        createReservationForm.setValue('reserved_check_out_datetime', null);
    }
  }, [watchIsAdvanceReservationCreate, createReservationForm, isCreateReservationDialogOpen]);


  // Effect for "Add Notification" dialog's reservation sub-form
  useEffect(() => {
    if (watchDoReservationForNotif && watchIsAdvanceForNotifSubForm) {
        if (!addNotificationForm.getValues('reservation_check_in_datetime')) {
            addNotificationForm.setValue('reservation_check_in_datetime', getDefaultCheckInDateTimeString());
        }
        const currentCheckIn = addNotificationForm.getValues('reservation_check_in_datetime');
        if (!addNotificationForm.getValues('reservation_check_out_datetime')) {
             addNotificationForm.setValue('reservation_check_out_datetime', getDefaultCheckOutDateTimeString(currentCheckIn));
        }
    } else if (watchDoReservationForNotif) {
        addNotificationForm.setValue('reservation_check_in_datetime', null);
        addNotificationForm.setValue('reservation_check_out_datetime', null);
    }
  }, [watchDoReservationForNotif, watchIsAdvanceForNotifSubForm, addNotificationForm]);

  useEffect(() => {
    if (watchDoReservationForNotif && watchTargetBranchForNotif) {
        const fetchRates = async () => {
            try {
                const rates = await getRatesForBranchSimple(watchTargetBranchForNotif, tenantId);
                setRatesForAddNotificationSubForm(rates);
                if (rates.length > 0 && !addNotificationForm.getValues('reservation_selected_rate_id')) {
                   // addNotificationForm.setValue('reservation_selected_rate_id', rates[0].id);
                }
            } catch (error) {
                toast({title: "Error", description: "Could not fetch rates for selected branch.", variant: "destructive"});
                setRatesForAddNotificationSubForm([]);
            }
        };
        fetchRates();
    } else {
        setRatesForAddNotificationSubForm([]);
    }
  }, [watchDoReservationForNotif, watchTargetBranchForNotif, tenantId, addNotificationForm, toast]);


  const handleMarkAsRead = async (notificationId: number) => {
    setIsSubmitting(true);
    try {
      const result = await markNotificationAsRead(notificationId, tenantId);
      if (result.success && result.notification) {
        setNotifications(prev => prev.map(n => n.id === notificationId ? result.notification! : n));
        toast({ title: "Success", description: "Notification marked as read." });
      } else {
        toast({ title: "Error", description: result.message, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to mark notification as read.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenCreateReservationDialog = async (notification: Notification) => {
    if (!notification.target_branch_id) {
      toast({ title: "Error", description: "Notification does not specify a target branch.", variant: "destructive" });
      return;
    }
    setSelectedNotification(notification);
    createReservationForm.reset({
        client_name: `For: ${notification.message.substring(0, 30)}${notification.message.length > 30 ? '...' : ''}`,
        selected_rate_id: undefined,
        client_payment_method: undefined,
        notes: `Ref: Notification #${notification.id}`,
        is_advance_reservation: false,
        reserved_check_in_datetime: null,
        reserved_check_out_datetime: null,
    });
    setIsLoading(true);
    try {
        const rates = await getRatesForBranchSimple(notification.target_branch_id, tenantId);
        setRatesForCreateReservationDialog(rates);
        if (rates.length > 0) {
            // createReservationForm.setValue('selected_rate_id', rates[0].id);
        }
    } catch (error) {
        toast({title: "Error", description: "Could not fetch rates for target branch.", variant: "destructive"});
        setRatesForCreateReservationDialog([]);
    } finally {
        setIsLoading(false);
    }
    setIsCreateReservationDialogOpen(true);
  };

  const handleCreateReservationFromNotificationSubmit = async (data: TransactionCreateData) => {
    if (!selectedNotification || !selectedNotification.target_branch_id || !selectedNotification.tenant_id) {
      toast({ title: "Error", description: "Target notification or branch not selected.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await createUnassignedReservation(
        data,
        selectedNotification.tenant_id, // Use notification's tenant_id
        selectedNotification.target_branch_id,
        adminUserId,
        true // is_admin_created_flag
      );
      if (result.success && result.transaction) {
        toast({ title: "Success", description: "Unassigned reservation created." });

        const updateNotifResult = await updateNotificationTransactionStatus(
            selectedNotification.id,
            NOTIFICATION_TRANSACTION_STATUS.RESERVATION_CREATED,
            result.transaction.id,
            tenantId // Use current admin's tenantId for scoping the notification update
        );
        if (updateNotifResult.success && updateNotifResult.notification) {
             setNotifications(prev => prev.map(n => n.id === selectedNotification.id ? updateNotifResult.notification! : n));
        } else {
            toast({title: "Warning", description: `Reservation created, but failed to update notification status: ${updateNotifResult.message}`, variant: "default"});
        }
        setIsCreateReservationDialogOpen(false);
      } else {
        toast({ title: "Creation Failed", description: result.message, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "An unexpected error occurred while creating reservation.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddNotificationSubmit = async (data: NotificationCreateData) => {
    setIsSubmitting(true);
    try {
      const result = await createNotification(data, tenantId, adminUserId);
      if (result.success && result.notification) {
        toast({title: "Success", description: result.message});
        setNotifications(prev => [result.notification!, ...prev].sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
        setIsAddNotificationDialogOpen(false);
        addNotificationForm.reset(defaultNotificationFormValues);
      } else {
        toast({title: "Creation Failed", description: result.message, variant: "destructive"});
      }
    } catch (error) {
        toast({ title: "Error", description: "An unexpected error occurred.", variant: "destructive" });
    } finally {
        setIsSubmitting(false);
    }
  };

  const renderReservationSubFormFields = (formInstance: any, rates: SimpleRate[], prefix: string) => (
    <div className="border p-3 rounded-md mt-2 space-y-3 bg-muted/50">
        <FormField control={formInstance.control} name={`${prefix}_client_name`} render={({ field }) => (
            <FormItem><FormLabel>Client Name for Reservation *</FormLabel><FormControl><Input placeholder="Client Name" {...field} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={formInstance.control} name={`${prefix}_selected_rate_id`} render={({ field }) => (
            <FormItem>
                <FormLabel>Select Rate for Reservation</FormLabel>
                <Select onValueChange={(value) => field.onChange(value ? parseInt(value) : undefined)} value={field.value?.toString()} disabled={rates.length === 0}>
                    <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder={rates.length === 0 ? "No rates for branch" : "Select a rate (Optional)"} /></SelectTrigger></FormControl>
                    <SelectContent>{rates.map(rate => (<SelectItem key={rate.id} value={rate.id.toString()}>{rate.name} (₱{Number(rate.price).toFixed(2)})</SelectItem>))}</SelectContent>
                </Select><FormMessage />
            </FormItem>
        )} />
        <FormField control={formInstance.control} name={`${prefix}_client_payment_method`} render={({ field }) => (
            <FormItem><FormLabel>Payment Method for Reservation</FormLabel>
                <Select onValueChange={field.onChange} value={field.value ?? undefined}>
                    <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder="Select payment method (Optional)" /></SelectTrigger></FormControl>
                    <SelectContent><SelectItem value="Cash">Cash</SelectItem><SelectItem value="Card">Card</SelectItem><SelectItem value="Online Payment">Online Payment</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent>
                </Select><FormMessage />
            </FormItem>
        )} />
        <FormField control={formInstance.control} name={`${prefix}_notes`} render={({ field }) => (
            <FormItem><FormLabel>Notes for Reservation (Optional)</FormLabel><FormControl><Textarea placeholder="Reservation notes..." {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={formInstance.control} name={`${prefix}_is_advance`} render={({ field }) => (
            <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-3 shadow-sm w-[90%] bg-background">
                <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                <div className="space-y-1 leading-none"><FormLabel>This is an Advance Future Reservation?</FormLabel></div>
            </FormItem>
        )} />
        {formInstance.getValues(`${prefix}_is_advance`) && (
            <>
                <FormField control={formInstance.control} name={`${prefix}_check_in_datetime`} render={({ field }) => (
                    <FormItem><FormLabel>Reserved Check-in Date & Time *</FormLabel>
                        <FormControl><Input type="datetime-local" className="w-[90%]" {...field} value={field.value || ""} min={format(new Date(), "yyyy-MM-dd'T'HH:mm")} /></FormControl>
                        <FormMessage />
                    </FormItem>
                )} />
                <FormField control={formInstance.control} name={`${prefix}_check_out_datetime`} render={({ field }) => (
                    <FormItem><FormLabel>Reserved Check-out Date & Time *</FormLabel>
                        <FormControl><Input type="datetime-local" className="w-[90%]" {...field} value={field.value || ""} min={formInstance.getValues(`${prefix}_check_in_datetime`) || format(new Date(), "yyyy-MM-dd'T'HH:mm")} /></FormControl>
                        <FormMessage />
                    </FormItem>
                )} />
            </>
        )}
    </div>
  );


  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
            <div className="flex items-center space-x-2">
            <Bell className="h-6 w-6 text-primary" />
            <CardTitle>Notifications & Messages</CardTitle>
            </div>
            <CardDescription>Manage notifications and take actions.</CardDescription>
        </div>
        <Dialog open={isAddNotificationDialogOpen} onOpenChange={(open) => {
            if (!open) { addNotificationForm.reset(defaultNotificationFormValues); setRatesForAddNotificationSubForm([]); }
            setIsAddNotificationDialogOpen(open);
        }}>
            <DialogTrigger asChild>
                <Button><PlusCircle className="mr-2 h-4 w-4" /> Add Notification</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg p-1 flex flex-col max-h-[85vh]">
                <DialogHeader className="p-2 border-b">
                    <DialogTitle>Create New Notification</DialogTitle>
                </DialogHeader>
                <Form {...addNotificationForm}>
                    <form onSubmit={addNotificationForm.handleSubmit(handleAddNotificationSubmit)} className="flex flex-col flex-grow overflow-hidden bg-card rounded-md">
                        <div className="flex-grow overflow-y-auto p-3 space-y-3">
                            <FormField control={addNotificationForm.control} name="message" render={({ field }) => (
                                <FormItem><FormLabel>Message *</FormLabel><FormControl><Textarea placeholder="Enter notification message..." {...field} className="w-full" rows={3} /></FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={addNotificationForm.control} name="target_branch_id" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Target Branch (Optional)</FormLabel>
                                    <Select onValueChange={(value) => field.onChange(value ? parseInt(value) : undefined)} value={field.value?.toString()}>
                                        <FormControl><SelectTrigger className="w-full"><SelectValue placeholder="Select branch if applicable" /></SelectTrigger></FormControl>
                                        <SelectContent>{availableTenantBranches.map(branch => (<SelectItem key={branch.id} value={branch.id.toString()}>{branch.branch_name}</SelectItem>))}</SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            {watchTargetBranchForNotif && (
                                <FormField control={addNotificationForm.control} name="do_reservation" render={({ field }) => (
                                    <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-3 shadow-sm w-full bg-background">
                                        <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                        <div className="space-y-1 leading-none"><FormLabel>Create Reservation with this Notification?</FormLabel></div>
                                    </FormItem>
                                )} />
                            )}
                            {watchTargetBranchForNotif && watchDoReservationForNotif && renderReservationSubFormFields(addNotificationForm, ratesForAddNotificationSubForm, 'reservation')}
                        </div>
                        <DialogFooter className="bg-card py-2 border-t px-3 sticky bottom-0 z-10">
                            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                            <Button type="submit" disabled={isSubmitting}>
                                {isSubmitting ? <Loader2 className="animate-spin" /> : "Create Notification"}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center items-center h-32"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : notifications.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No notifications found.</p>
        ) : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Message</TableHead>
              <TableHead>Creator</TableHead>
              <TableHead>Target Branch</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reservation Status</TableHead>
              <TableHead>Transaction Acceptance</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {notifications.map(notif => (
                <TableRow key={notif.id} className={notif.status === NOTIFICATION_STATUS.UNREAD ? 'font-semibold' : ''}>
                  <TableCell className="max-w-xs truncate" title={notif.message}>{notif.message}</TableCell>
                  <TableCell>{notif.creator_username || 'System'}</TableCell>
                  <TableCell>{notif.target_branch_name || 'N/A'}</TableCell>
                  <TableCell>{NOTIFICATION_STATUS_TEXT[notif.status]}</TableCell>
                  <TableCell>{NOTIFICATION_TRANSACTION_STATUS_TEXT[notif.transaction_status]}</TableCell>
                  <TableCell>{notif.transaction_id ? (TRANSACTION_IS_ACCEPTED_STATUS_TEXT[notif.transaction_is_accepted ?? 0]) : 'N/A'}</TableCell>
                  <TableCell>{format(parseISO(notif.created_at.replace(' ', 'T')), 'yyyy-MM-dd hh:mm aa')}</TableCell>
                  <TableCell className="text-right space-x-2">
                    {notif.status === NOTIFICATION_STATUS.UNREAD && (
                      <Button variant="outline" size="sm" onClick={() => handleMarkAsRead(notif.id)} disabled={isSubmitting}>
                        <CheckSquare className="mr-1 h-3 w-3" /> Mark Read
                      </Button>
                    )}
                    {notif.target_branch_id && notif.transaction_status === NOTIFICATION_TRANSACTION_STATUS.PENDING_ACTION && (
                      <Button variant="default" size="sm" onClick={() => handleOpenCreateReservationDialog(notif)} disabled={isSubmitting}>
                        <CalendarPlus className="mr-1 h-3 w-3" /> Create Reservation
                      </Button>
                    )}
                     {notif.transaction_status === NOTIFICATION_TRANSACTION_STATUS.RESERVATION_CREATED && (
                        <span className="text-xs text-green-600">Processed (Tx ID: {notif.transaction_id || 'N/A'})</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Dialog for Creating Reservation from Existing Notification */}
      <Dialog open={isCreateReservationDialogOpen} onOpenChange={(open) => {
          if (!open) {
            setSelectedNotification(null);
            createReservationForm.reset({
                client_name: '', selected_rate_id: undefined, client_payment_method: undefined, notes: '',
                is_advance_reservation: false, reserved_check_in_datetime: null, reserved_check_out_datetime: null,
            });
            setRatesForCreateReservationDialog([]);
          }
          setIsCreateReservationDialogOpen(open);
      }}>
        <DialogContent className="sm:max-w-lg p-1 flex flex-col max-h-[85vh]">
            <DialogHeader className="p-2 border-b">
                <DialogTitle>Create Reservation from Notification</DialogTitle>
                <CardDescription>For Branch: {selectedNotification?.target_branch_name || 'N/A'}</CardDescription>
            </DialogHeader>
            <Form {...createReservationForm}>
                <form onSubmit={createReservationForm.handleSubmit(handleCreateReservationFromNotificationSubmit)} className="flex flex-col flex-grow overflow-hidden bg-card rounded-md">
                    <div className="flex-grow overflow-y-auto p-3 space-y-3">
                        {renderReservationSubFormFields(createReservationForm, ratesForCreateReservationDialog, '')}
                    </div>
                    <DialogFooter className="bg-card py-2 border-t px-3 sticky bottom-0 z-10">
                        <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                        <Button type="submit" disabled={isSubmitting || (isLoading && ratesForCreateReservationDialog.length === 0 && createReservationForm.getValues('selected_rate_id'))}>
                            {isSubmitting ? <Loader2 className="animate-spin" /> : "Create Reservation"}
                        </Button>
                    </DialogFooter>
                </form>
            </Form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
