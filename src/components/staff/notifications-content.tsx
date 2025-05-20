
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { MessageSquare, Loader2, RefreshCw, CalendarCheck, XCircle, Edit } from "lucide-react";
import type { Notification, Transaction, SimpleRate } from '@/lib/types';
import {
  listNotificationsForBranch,
  markStaffNotificationAsRead,
  acceptReservationByStaff,
  declineReservationByStaff,
  getActiveTransactionForRoom // Ensure this can fetch status '5' transactions
} from '@/actions/staff';
import { getRatesForBranchSimple } from '@/actions/admin';
import { transactionUnassignedUpdateSchema, TransactionUnassignedUpdateData } from '@/lib/schemas';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO, addDays, setHours, setMinutes, setSeconds, setMilliseconds } from 'date-fns';
import {
  NOTIFICATION_STATUS,
  NOTIFICATION_STATUS_TEXT,
  TRANSACTION_STATUS,
  TRANSACTION_STATUS_TEXT,
  TRANSACTION_IS_ACCEPTED_STATUS,
  TRANSACTION_IS_ACCEPTED_STATUS_TEXT
} from '@/lib/constants';
import { cn } from '@/lib/utils';

interface NotificationsContentProps {
  tenantId: number;
  branchId: number;
  staffUserId: number;
}

const formatDateTimeForInput = (dateString?: string | null): string => {
  if (!dateString) return "";
  try {
    // Ensure we replace space with 'T' for proper ISO parsing if DB format is "YYYY-MM-DD HH:MM:SS"
    return format(parseISO(dateString.replace(' ', 'T')), "yyyy-MM-dd'T'HH:mm");
  } catch (e) {
    console.warn("Error formatting date string for input:", dateString, e);
    return "";
  }
};

const getDefaultCheckInDateTimeString = (): string => {
  const now = new Date();
  const checkIn = setMilliseconds(setSeconds(setMinutes(setHours(now, 14), 0), 0), 0);
  return format(checkIn, "yyyy-MM-dd'T'HH:mm");
};

const getDefaultCheckOutDateTimeString = (checkInDateString?: string | null): string => {
  let baseDate = new Date();
  if (checkInDateString) {
    try {
        const parsedCheckIn = parseISO(checkInDateString.replace(' ', 'T')); // Ensure space replacement
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


export default function NotificationsContent({ tenantId, branchId, staffUserId }: NotificationsContentProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(true);
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isAcceptManageModalOpen, setIsAcceptManageModalOpen] = useState(false);
  const [transactionToManage, setTransactionToManage] = useState<Transaction | null>(null);
  const [ratesForAcceptModal, setRatesForAcceptModal] = useState<SimpleRate[]>([]);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [transactionToDecline, setTransactionToDecline] = useState<Transaction | null>(null);


  const { toast } = useToast();

  const acceptManageForm = useForm<TransactionUnassignedUpdateData>({
    resolver: zodResolver(transactionUnassignedUpdateSchema),
  });
  const watchIsAdvanceReservationForm = acceptManageForm.watch("is_advance_reservation");

  const fetchNotifications = useCallback(async () => {
    if (!tenantId || !branchId) return;
    setIsLoadingNotifications(true);
    try {
      const fetchedNotifications = await listNotificationsForBranch(tenantId, branchId);
      setNotifications(fetchedNotifications.sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
    } catch (error) {
      toast({ title: "Error", description: "Could not fetch notifications.", variant: "destructive" });
    } finally {
      setIsLoadingNotifications(false);
    }
  }, [tenantId, branchId, toast]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    if (isAcceptManageModalOpen && watchIsAdvanceReservationForm) {
        if (!acceptManageForm.getValues('reserved_check_in_datetime')) {
            acceptManageForm.setValue('reserved_check_in_datetime', getDefaultCheckInDateTimeString());
        }
        const currentCheckIn = acceptManageForm.getValues('reserved_check_in_datetime');
        if (!acceptManageForm.getValues('reserved_check_out_datetime')) {
             acceptManageForm.setValue('reserved_check_out_datetime', getDefaultCheckOutDateTimeString(currentCheckIn));
        }
    } else if (isAcceptManageModalOpen) {
        acceptManageForm.setValue('reserved_check_in_datetime', null);
        acceptManageForm.setValue('reserved_check_out_datetime', null);
    }
  }, [watchIsAdvanceReservationForm, acceptManageForm, isAcceptManageModalOpen]);


  const handleCardClick = async (notification: Notification) => {
    setSelectedNotification(notification);
    setIsDetailsModalOpen(true);
    if (notification.status === NOTIFICATION_STATUS.UNREAD) {
      try {
        // Optimistically update UI
        setNotifications(prev => prev.map(n => n.id === notification.id ? { ...n, status: NOTIFICATION_STATUS.READ, read_at: new Date().toISOString() } : n)
          .sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
        
        const result = await markStaffNotificationAsRead(notification.id, tenantId, branchId);
        if (!result.success) {
          // Revert optimistic update on failure
          toast({title: "Info", description: "Failed to mark notification as read on server.", variant:"default"})
          setNotifications(prev => prev.map(n => n.id === notification.id ? { ...n, status: NOTIFICATION_STATUS.UNREAD, read_at: null } : n) 
           .sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
        }
      } catch (error) {
        console.error("Failed to mark notification as read:", error);
        // Revert optimistic update on error
         setNotifications(prev => prev.map(n => n.id === notification.id ? { ...n, status: NOTIFICATION_STATUS.UNREAD, read_at: null } : n)
          .sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
      }
    }
  };

  const handleOpenAcceptManageModal = async () => {
    if (!selectedNotification || !selectedNotification.transaction_id) return;
    setIsSubmittingAction(true); // Use general purpose submitting flag or a new one like setIsModalLoading
    try {
      const [transaction, rates] = await Promise.all([
        getActiveTransactionForRoom(selectedNotification.transaction_id, tenantId, branchId),
        getRatesForBranchSimple(tenantId, branchId) // Branch ID for rates should be target_branch_id of notif
      ]);

      if (!transaction) {
        toast({ title: "Error", description: "Linked transaction not found or is inactive.", variant: "destructive" });
        setIsSubmittingAction(false);
        return;
      }
      setTransactionToManage(transaction);
      setRatesForAcceptModal(rates);

      acceptManageForm.reset({
        client_name: transaction.client_name,
        selected_rate_id: transaction.hotel_rate_id ?? undefined,
        client_payment_method: transaction.client_payment_method ?? undefined,
        notes: transaction.notes ?? '',
        is_advance_reservation: transaction.status === TRANSACTION_STATUS.ADVANCE_RESERVATION || (transaction.status === TRANSACTION_STATUS.PENDING_BRANCH_ACCEPTANCE && !!transaction.reserved_check_in_datetime),
        reserved_check_in_datetime: formatDateTimeForInput(transaction.reserved_check_in_datetime),
        reserved_check_out_datetime: formatDateTimeForInput(transaction.reserved_check_out_datetime),
      });

      setIsDetailsModalOpen(false); // Close details modal
      setIsAcceptManageModalOpen(true);
    } catch (error) {
      toast({ title: "Error", description: "Failed to load reservation details or rates.", variant: "destructive" });
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleAcceptReservationSubmit = async (data: TransactionUnassignedUpdateData) => {
    if (!transactionToManage || !transactionToManage.id) return;
    setIsSubmittingAction(true);
    try {
      const result = await acceptReservationByStaff(transactionToManage.id, data, tenantId, branchId, staffUserId);
      if (result.success) {
        toast({ title: "Success", description: "Reservation accepted and updated." });
        setIsAcceptManageModalOpen(false);
        fetchNotifications(); // Refresh notifications list
      } else {
        toast({ title: "Acceptance Failed", description: result.message, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Could not accept reservation.", variant: "destructive" });
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleOpenDeclineConfirmation = (transaction: Transaction | null) => {
    if (transaction) {
        setTransactionToDecline(transaction);
    }
  };

  const handleConfirmDeclineReservation = async () => {
    if (!transactionToDecline || !transactionToDecline.id) return;
    setIsSubmittingAction(true);
    try {
      const result = await declineReservationByStaff(transactionToDecline.id, tenantId, branchId, staffUserId);
      if (result.success) {
        toast({ title: "Success", description: "Reservation declined." });
        setIsAcceptManageModalOpen(false); // Close accept modal if decline came from there
        setIsDetailsModalOpen(false); // Also close details modal
        fetchNotifications(); // Refresh notifications list
      } else {
        toast({ title: "Decline Failed", description: result.message, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Could not decline reservation.", variant: "destructive" });
    } finally {
      setIsSubmittingAction(false);
      setTransactionToDecline(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <MessageSquare className="h-6 w-6 text-primary" />
            <CardTitle>Branch Notifications</CardTitle>
          </div>
          <CardDescription>View messages and notifications for your branch.</CardDescription>
        </div>
        <Button variant="outline" onClick={fetchNotifications} disabled={isLoadingNotifications}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoadingNotifications ? 'animate-spin' : ''}`} /> Refresh List
        </Button>
      </CardHeader>
      <CardContent>
        {isLoadingNotifications ? (
          <div className="flex justify-center items-center h-32"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : notifications.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No notifications for this branch.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {notifications.map(notif => (
              <Card
                key={notif.id}
                className={cn(
                  "hover:shadow-lg transition-shadow cursor-pointer",
                  notif.status === NOTIFICATION_STATUS.UNREAD && "border-primary border-2",
                  notif.transaction_id && {
                    [cn("bg-yellow-100 dark:bg-yellow-800/30 border-yellow-300 dark:border-yellow-700 animate-pulse-opacity-gentle")]: notif.transaction_is_accepted === TRANSACTION_IS_ACCEPTED_STATUS.PENDING,
                    [cn("bg-green-100 dark:bg-green-800/30 border-green-300 dark:border-green-700")]: notif.transaction_is_accepted === TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED,
                    [cn("bg-red-100 dark:bg-red-800/30 border-red-300 dark:border-red-700")]: notif.transaction_is_accepted === TRANSACTION_IS_ACCEPTED_STATUS.NOT_ACCEPTED,
                  }
                )}
                onClick={() => handleCardClick(notif)}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-md truncate">{notif.message.substring(0, 50)}{notif.message.length > 50 ? "..." : ""}</CardTitle>
                  <CardDescription className="text-xs">
                    From: {notif.creator_username || "System"} | {notif.created_at ? format(parseISO(notif.created_at.replace(' ', 'T')), 'MMM dd, yyyy HH:mm aa') : 'N/A'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-xs">
                  <p>Status: <span className={cn(notif.status === NOTIFICATION_STATUS.UNREAD ? "font-semibold text-primary" : "text-muted-foreground")}>{NOTIFICATION_STATUS_TEXT[notif.status]}</span></p>
                  {notif.transaction_id && (
                    <p>Linked Reservation: Status <span className="font-semibold">{TRANSACTION_STATUS_TEXT[notif.linked_transaction_status as keyof typeof TRANSACTION_STATUS_TEXT] || 'N/A'}</span> | Acceptance <span className="font-semibold">{TRANSACTION_IS_ACCEPTED_STATUS_TEXT[notif.transaction_is_accepted ?? 0]}</span> </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={isDetailsModalOpen} onOpenChange={setIsDetailsModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Notification Details</DialogTitle>
          </DialogHeader>
          {selectedNotification && (
            <div className="py-4 space-y-2">
              <div>
                <strong>Message:</strong>
                <pre className="whitespace-pre-wrap text-sm bg-muted p-2 rounded-md mt-1">{selectedNotification.message}</pre>
              </div>
              <p><strong>From:</strong> {selectedNotification.creator_username || "System"}</p>
              <p><strong>Date:</strong> {selectedNotification.created_at ? format(parseISO(selectedNotification.created_at.replace(' ', 'T')), 'yyyy-MM-dd hh:mm:ss aa') : 'N/A'}</p>
              <p><strong>Status:</strong> {NOTIFICATION_STATUS_TEXT[selectedNotification.status]}</p>
              {selectedNotification.transaction_id && (
                <>
                  <p><strong>Linked Reservation Status:</strong> {TRANSACTION_STATUS_TEXT[selectedNotification.linked_transaction_status as keyof typeof TRANSACTION_STATUS_TEXT] || 'N/A'}</p>
                  <p><strong>Acceptance by Branch:</strong> {TRANSACTION_IS_ACCEPTED_STATUS_TEXT[selectedNotification.transaction_is_accepted ?? 0]}</p>
                </>
              )}
            </div>
          )}
          <DialogFooter className="sm:justify-between">
            {selectedNotification?.transaction_id &&
             selectedNotification?.linked_transaction_status === TRANSACTION_STATUS.PENDING_BRANCH_ACCEPTANCE &&
             (selectedNotification?.transaction_is_accepted === TRANSACTION_IS_ACCEPTED_STATUS.PENDING) && (
              <Button onClick={handleOpenAcceptManageModal} disabled={isSubmittingAction}>
                {isSubmittingAction ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarCheck className="mr-2 h-4 w-4" />}
                Manage Reservation
              </Button>
            )}
            <DialogClose asChild><Button type="button" variant="outline">Close</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Accept/Manage Reservation Modal */}
      <Dialog open={isAcceptManageModalOpen} onOpenChange={(open) => {
          if (!open) { setTransactionToManage(null); setRatesForAcceptModal([]); acceptManageForm.reset(); }
          setIsAcceptManageModalOpen(open);
      }}>
        <DialogContent className="sm:max-w-md p-1 flex flex-col max-h-[85vh]">
          <DialogHeader className="p-2 border-b">
            <DialogTitle>Manage Admin-Created Reservation</DialogTitle>
            <CardDescription>Client: {transactionToManage?.client_name}</CardDescription>
          </DialogHeader>
          {transactionToManage && (
            <Form {...acceptManageForm}>
              <form className="flex flex-col flex-grow overflow-hidden bg-card rounded-md">
                <div className="flex-grow overflow-y-auto p-3 space-y-3">
                  {/* Form Fields for editing reservation */}
                  <FormField control={acceptManageForm.control} name="client_name" render={({ field }) => (
                    <FormItem><FormLabel>Client Name *</FormLabel><FormControl><Input placeholder="Jane Doe" {...field} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={acceptManageForm.control} name="selected_rate_id" render={({ field }) => (
                    <FormItem><FormLabel>Select Rate</FormLabel>
                      <Select onValueChange={(value) => field.onChange(value ? parseInt(value) : undefined)} value={field.value?.toString()} disabled={ratesForAcceptModal.length === 0}>
                        <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder={ratesForAcceptModal.length === 0 ? "No rates available" : "Select a rate (Optional)"} /></SelectTrigger></FormControl>
                        <SelectContent>{ratesForAcceptModal.map(rate => (<SelectItem key={rate.id} value={rate.id.toString()}>{rate.name} (₱{Number(rate.price).toFixed(2)})</SelectItem>))}</SelectContent>
                      </Select><FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={acceptManageForm.control} name="client_payment_method" render={({ field }) => (
                    <FormItem><FormLabel>Payment Method</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? undefined}>
                        <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder="Select payment method (Optional)" /></SelectTrigger></FormControl>
                        <SelectContent><SelectItem value="Cash">Cash</SelectItem><SelectItem value="Card">Card</SelectItem><SelectItem value="Online Payment">Online Payment</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent>
                      </Select><FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={acceptManageForm.control} name="notes" render={({ field }) => (
                    <FormItem><FormLabel>Notes (Optional)</FormLabel><FormControl><Textarea placeholder="Reservation notes..." {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={acceptManageForm.control} name="is_advance_reservation" render={({ field }) => (
                    <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-3 shadow-sm w-[90%]"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                      <div className="space-y-1 leading-none"><FormLabel>Advance Future Reservation?</FormLabel></div>
                    </FormItem>
                  )} />
                  {watchIsAdvanceReservationForm && (
                    <>
                      <FormField control={acceptManageForm.control} name="reserved_check_in_datetime" render={({ field }) => (
                        <FormItem><FormLabel>Reserved Check-in Date & Time *</FormLabel><FormControl><Input type="datetime-local" className="w-[90%]" {...field} value={field.value || ""} min={format(new Date(), "yyyy-MM-dd'T'HH:mm")} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={acceptManageForm.control} name="reserved_check_out_datetime" render={({ field }) => (
                        <FormItem><FormLabel>Reserved Check-out Date & Time *</FormLabel><FormControl><Input type="datetime-local" className="w-[90%]" {...field} value={field.value || ""} min={acceptManageForm.getValues('reserved_check_in_datetime') || format(new Date(), "yyyy-MM-dd'T'HH:mm")} /></FormControl><FormMessage /></FormItem>
                      )} />
                    </>
                  )}
                </div>
                <DialogFooter className="bg-card py-2 border-t px-3 sticky bottom-0 z-10 flex justify-between">
                  <AlertDialog open={!!transactionToDecline} onOpenChange={(open) => { if (!open) setTransactionToDecline(null); }}>
                    <AlertDialogTrigger asChild>
                      <Button type="button" variant="destructive" onClick={() => handleOpenDeclineConfirmation(transactionToManage)} disabled={isSubmittingAction}>
                          <XCircle className="mr-2 h-4 w-4" /> Decline Reservation
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader><AlertDialogTitle>Confirm Decline</AlertDialogTitle>
                            <AlertDialogDescription>Are you sure you want to decline this reservation for "{transactionToDecline?.client_name}"? This action cannot be undone.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel onClick={() => setTransactionToDecline(null)}>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleConfirmDeclineReservation} disabled={isSubmittingAction}>
                                {isSubmittingAction ? <Loader2 className="animate-spin" /> : "Yes, Decline"}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <div className="space-x-2">
                    <DialogClose asChild><Button type="button" variant="outline">Cancel Update</Button></DialogClose>
                    <Button type="button" onClick={acceptManageForm.handleSubmit(handleAcceptReservationSubmit)} disabled={isSubmittingAction}>
                      {isSubmittingAction ? <Loader2 className="animate-spin" /> : <CalendarCheck className="mr-2 h-4 w-4"/>}
                      Accept Reservation
                    </Button>
                  </div>
                </DialogFooter>
              </form>
            </Form>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

    
