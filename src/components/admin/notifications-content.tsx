
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Bell, CheckSquare, Edit, CalendarPlus, XSquare } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import type { Notification, SimpleRate, SimpleBranch } from '@/lib/types';
import { transactionCreateSchema, TransactionCreateData } from '@/lib/schemas';
import { listNotificationsForTenant, markNotificationAsRead, updateNotificationTransactionStatus, getRatesForBranchSimple, getBranchesForTenantSimple } from '@/actions/admin';
import { createUnassignedReservation } from '@/actions/staff'; // Admin will use staff action to create reservation
import { NOTIFICATION_STATUS, NOTIFICATION_STATUS_TEXT, NOTIFICATION_TRANSACTION_STATUS, NOTIFICATION_TRANSACTION_STATUS_TEXT, TRANSACTION_STATUS } from '@/lib/constants';
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

const defaultReservationFormValues: TransactionCreateData = {
  client_name: '',
  selected_rate_id: undefined,
  client_payment_method: undefined,
  notes: '',
  is_advance_reservation: false,
  reserved_check_in_datetime: null,
  reserved_check_out_datetime: null,
};

export default function NotificationsContent({ tenantId, adminUserId }: NotificationsContentProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreateReservationDialogOpen, setIsCreateReservationDialogOpen] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);
  const [availableRates, setAvailableRates] = useState<SimpleRate[]>([]);
  const { toast } = useToast();

  const reservationForm = useForm<TransactionCreateData>({
    resolver: zodResolver(transactionCreateSchema),
    defaultValues: defaultReservationFormValues,
  });
  const watchIsAdvanceReservation = reservationForm.watch("is_advance_reservation");

  const fetchNotifications = useCallback(async () => {
    if (!tenantId) return;
    setIsLoading(true);
    try {
      const data = await listNotificationsForTenant(tenantId);
      setNotifications(data);
    } catch (error) {
      toast({ title: "Error", description: "Could not fetch notifications.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [tenantId, toast]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    if (watchIsAdvanceReservation) {
        if (!reservationForm.getValues('reserved_check_in_datetime')) {
            reservationForm.setValue('reserved_check_in_datetime', getDefaultCheckInDateTimeString(), { shouldValidate: true });
        }
        const currentCheckIn = reservationForm.getValues('reserved_check_in_datetime');
        if (!reservationForm.getValues('reserved_check_out_datetime')) {
             reservationForm.setValue('reserved_check_out_datetime', getDefaultCheckOutDateTimeString(currentCheckIn), { shouldValidate: true });
        }
    } else {
        reservationForm.setValue('reserved_check_in_datetime', null, { shouldValidate: true });
        reservationForm.setValue('reserved_check_out_datetime', null, { shouldValidate: true });
    }
  }, [watchIsAdvanceReservation, reservationForm, isCreateReservationDialogOpen]);


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
    reservationForm.reset({
        ...defaultReservationFormValues,
        client_name: `Reservation based on Notification ID: ${notification.id}` // Placeholder
    });
    setIsLoading(true); // For rates
    try {
        const rates = await getRatesForBranchSimple(notification.target_branch_id, tenantId);
        setAvailableRates(rates);
        if (rates.length > 0) {
            reservationForm.setValue('selected_rate_id', rates[0].id); // Default to first rate
        }
    } catch (error) {
        toast({title: "Error", description: "Could not fetch rates for target branch.", variant: "destructive"});
        setAvailableRates([]);
    } finally {
        setIsLoading(false);
    }
    setIsCreateReservationDialogOpen(true);
  };

  const handleCreateReservationSubmit = async (data: TransactionCreateData) => {
    if (!selectedNotification || !selectedNotification.target_branch_id) {
      toast({ title: "Error", description: "Target notification or branch not selected.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await createUnassignedReservation(
        data,
        selectedNotification.tenant_id,
        selectedNotification.target_branch_id,
        adminUserId 
      );
      if (result.success && result.transaction) {
        toast({ title: "Success", description: "Unassigned reservation created." });
        // Update notification status
        const updateNotifResult = await updateNotificationTransactionStatus(
            selectedNotification.id, 
            NOTIFICATION_TRANSACTION_STATUS.RESERVATION_CREATED,
            result.transaction.id, // Link the created transaction ID
            tenantId
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center space-x-2">
          <Bell className="h-6 w-6 text-primary" />
          <CardTitle>Notifications & Messages</CardTitle>
        </div>
        <CardDescription>Manage notifications and take actions.</CardDescription>
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
                        <span className="text-xs text-green-600">Processed</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={isCreateReservationDialogOpen} onOpenChange={(open) => {
          if (!open) {
            setSelectedNotification(null);
            reservationForm.reset(defaultReservationFormValues);
            setAvailableRates([]);
          }
          setIsCreateReservationDialogOpen(open);
      }}>
        <DialogContent className="sm:max-w-md p-1 flex flex-col max-h-[85vh]">
            <DialogHeader className="p-2 border-b">
                <DialogTitle>Create Reservation from Notification</DialogTitle>
                <CardDescription>For Branch: {selectedNotification?.target_branch_name || 'N/A'}</CardDescription>
            </DialogHeader>
            <Form {...reservationForm}>
                <form onSubmit={reservationForm.handleSubmit(handleCreateReservationSubmit)} className="flex flex-col flex-grow overflow-hidden bg-card rounded-md">
                    <div className="flex-grow overflow-y-auto p-1 space-y-3">
                        <FormField control={reservationForm.control} name="client_name" render={({ field }) => (
                            <FormItem><FormLabel>Client Name *</FormLabel><FormControl><Input placeholder="Client Name" {...field} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={reservationForm.control} name="selected_rate_id" render={({ field }) => (
                            <FormItem>
                                <FormLabel>Select Rate</FormLabel>
                                <Select onValueChange={(value) => field.onChange(value ? parseInt(value) : undefined)} value={field.value?.toString()} disabled={availableRates.length === 0 || isLoading}>
                                    <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder={isLoading? "Loading rates..." : availableRates.length === 0 ? "No rates for branch" : "Select a rate (Optional)"} /></SelectTrigger></FormControl>
                                    <SelectContent>{availableRates.map(rate => (<SelectItem key={rate.id} value={rate.id.toString()}>{rate.name} (₱{Number(rate.price).toFixed(2)})</SelectItem>))}</SelectContent>
                                </Select><FormMessage />
                            </FormItem>
                        )} />
                        <FormField control={reservationForm.control} name="client_payment_method" render={({ field }) => (
                            <FormItem><FormLabel>Payment Method</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value ?? undefined}>
                                    <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder="Select payment method (Optional)" /></SelectTrigger></FormControl>
                                    <SelectContent><SelectItem value="Cash">Cash</SelectItem><SelectItem value="Card">Card</SelectItem><SelectItem value="Online Payment">Online Payment</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent>
                                </Select><FormMessage />
                            </FormItem>
                        )} />
                        <FormField control={reservationForm.control} name="notes" render={({ field }) => (
                            <FormItem><FormLabel>Notes (Optional)</FormLabel><FormControl><Textarea placeholder="Reservation notes..." {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={reservationForm.control} name="is_advance_reservation" render={({ field }) => (
                            <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-3 shadow-sm w-[90%]">
                                <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                <div className="space-y-1 leading-none"><FormLabel>Advance Future Reservation?</FormLabel></div>
                            </FormItem>
                        )} />
                        {watchIsAdvanceReservation && (
                            <>
                                <FormField control={reservationForm.control} name="reserved_check_in_datetime" render={({ field }) => (
                                    <FormItem><FormLabel>Reserved Check-in Date & Time *</FormLabel>
                                        <FormControl><Input type="datetime-local" className="w-[90%]" {...field} value={field.value || ""} min={format(new Date(), "yyyy-MM-dd'T'HH:mm")} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                                <FormField control={reservationForm.control} name="reserved_check_out_datetime" render={({ field }) => (
                                    <FormItem><FormLabel>Reserved Check-out Date & Time *</FormLabel>
                                        <FormControl><Input type="datetime-local" className="w-[90%]" {...field} value={field.value || ""} min={reservationForm.getValues('reserved_check_in_datetime') || format(new Date(), "yyyy-MM-dd'T'HH:mm")} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                            </>
                        )}
                    </div>
                    <DialogFooter className="bg-card py-2 border-t px-3 sticky bottom-0 z-10">
                        <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                        <Button type="submit" disabled={isSubmitting || (isLoading && availableRates.length === 0)}>
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
