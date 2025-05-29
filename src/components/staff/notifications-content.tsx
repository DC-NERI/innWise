
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, CardContent, CardHeader, CardTitle,
  CardDescription as ShadCardDescription
} from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle as ShadDialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription as ShadDialogDescriptionAliased
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription as ShadAlertDialogDescriptionConfirm,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle as ShadAlertDialogTitleConfirm,
} from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { MessageSquare, Loader2, RefreshCw, CalendarCheck, XCircle, Edit3, CheckCircle2, User, CalendarClock, Ban } from "lucide-react";
import type { Notification, Transaction, SimpleRate } from '@/lib/types';

import { listNotificationsForBranch } from '@/actions/staff/notifications/listNotificationsForBranch';
import { markStaffNotificationAsRead } from '@/actions/staff/notifications/markStaffNotificationAsRead';
import { getTransactionDetailsForManagement } from '@/actions/staff/transactions/getTransactionDetailsForManagement';
import { acceptReservationByStaff } from '@/actions/staff/reservations/acceptReservationByStaff';
import { declineReservationByStaff } from '@/actions/staff/reservations/declineReservationByStaff';
import { getRatesForBranchSimple } from '@/actions/admin/rates/getRatesForBranchSimple';

import { transactionUnassignedUpdateSchema, TransactionUnassignedUpdateData } from '@/lib/schemas';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO, addDays, setHours, setMinutes, setSeconds, setMilliseconds } from 'date-fns';
import {
  NOTIFICATION_STATUS,
  NOTIFICATION_STATUS_TEXT,
  TRANSACTION_LIFECYCLE_STATUS,
  TRANSACTION_LIFECYCLE_STATUS_TEXT,
  TRANSACTION_IS_ACCEPTED_STATUS,
  TRANSACTION_IS_ACCEPTED_STATUS_TEXT,
  TRANSACTION_PAYMENT_STATUS,
  HOTEL_ENTITY_STATUS
} from '@/lib/constants';
import { cn } from '@/lib/utils';

interface NotificationsContentProps {
  tenantId: number;
  branchId: number;
  staffUserId: number;
  refreshReservationCount?: () => void;
}

const formatDateTimeForInput = (dateString?: string | null): string => {
  if (!dateString) return "";
  try {
    // PostgreSQL TIMESTAMPTZ often returns with a space, not 'T'. parseISO handles both.
    const parsableDateString = dateString.includes('T') ? dateString : dateString.replace(' ', 'T');
    return format(parseISO(parsableDateString), "yyyy-MM-dd'T'HH:mm");
  } catch (e) {
    console.warn("Invalid date string for formatting:", dateString, e);
    return "";
  }
};

const getDefaultCheckInDateTimeString = (): string => {
  const now = new Date();
  const checkIn = setMilliseconds(setSeconds(setMinutes(setHours(now, 14), 0), 0), 0); // Default to 2 PM
  return format(checkIn, "yyyy-MM-dd'T'HH:mm");
};

const getDefaultCheckOutDateTimeString = (checkInDateString?: string | null): string => {
  let baseDate = new Date();
  if (checkInDateString) {
    try {
        const parsableDateString = checkInDateString.includes('T') ? checkInDateString : checkInDateString.replace(' ', 'T');
        const parsedCheckIn = parseISO(parsableDateString);
        if (!isNaN(parsedCheckIn.getTime())) {
            baseDate = parsedCheckIn;
        }
    } catch (e) { /* ignore, use current date */ }
  } else {
    baseDate = setMilliseconds(setSeconds(setMinutes(setHours(baseDate, 14), 0), 0), 0);
  }
  const checkOut = setMilliseconds(setSeconds(setMinutes(setHours(addDays(baseDate, 1), 12), 0), 0), 0);
  return format(checkOut, "yyyy-MM-dd'T'HH:mm");
};


export default function NotificationsContent({ tenantId, branchId, staffUserId, refreshReservationCount }: NotificationsContentProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(true);
  const [selectedNotificationForDetails, setSelectedNotificationForDetails] = useState<Notification | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);

  const [transactionToManage, setTransactionToManage] = useState<Transaction | null>(null);
  const [isAcceptManageModalOpen, setIsAcceptManageModalOpen] = useState(false);
  const [ratesForAcceptModal, setRatesForAcceptModal] = useState<SimpleRate[]>([]);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);

  const [notificationToDeclineViaManageModal, setNotificationToDeclineViaManageModal] = useState<Notification | null>(null);
  const [isDeclineConfirmOpen, setIsDeclineConfirmOpen] = useState(false);

  const { toast } = useToast();

  const acceptManageForm = useForm<TransactionUnassignedUpdateData>({
    resolver: zodResolver(transactionUnassignedUpdateSchema),
    defaultValues: {
        client_name: '',
        selected_rate_id: undefined,
        client_payment_method: undefined,
        notes: '',
        is_advance_reservation: false,
        reserved_check_in_datetime: null,
        reserved_check_out_datetime: null,
        is_paid: TRANSACTION_PAYMENT_STATUS.UNPAID,
        tender_amount_at_checkin: null,
    }
  });
  const watchIsAdvanceReservationForm = useWatch({ control: acceptManageForm.control, name: 'is_advance_reservation' });
  const watchIsPaidAcceptManageForm = useWatch({ control: acceptManageForm.control, name: 'is_paid' });

  const fetchNotifications = useCallback(async () => {
    if (!tenantId || !branchId) {
        setIsLoadingNotifications(false);
        return;
    }
    setIsLoadingNotifications(true);
    try {
      const fetchedNotifications = await listNotificationsForBranch(tenantId, branchId);
      setNotifications(fetchedNotifications.sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
    } catch (error) {
      toast({ title: "Error", description: `Could not fetch notifications: ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
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
            acceptManageForm.setValue('reserved_check_in_datetime', getDefaultCheckInDateTimeString(), { shouldValidate: true, shouldDirty: true });
        }
        const currentCheckIn = acceptManageForm.getValues('reserved_check_in_datetime');
        if (!acceptManageForm.getValues('reserved_check_out_datetime')) {
             acceptManageForm.setValue('reserved_check_out_datetime', getDefaultCheckOutDateTimeString(currentCheckIn), { shouldValidate: true, shouldDirty: true });
        }
    } else if (isAcceptManageModalOpen) {
        acceptManageForm.setValue('reserved_check_in_datetime', null, { shouldValidate: true });
        acceptManageForm.setValue('reserved_check_out_datetime', null, { shouldValidate: true });
    }
  }, [watchIsAdvanceReservationForm, acceptManageForm, isAcceptManageModalOpen]);

  const handleCardClick = async (notification: Notification) => {
    if (!tenantId || !branchId) return;
    setSelectedNotificationForDetails(notification);
    setIsDetailsModalOpen(true);
    if (Number(notification.status) === NOTIFICATION_STATUS.UNREAD) {
      // Optimistic UI update
      setNotifications(prev => prev.map(n => n.id === notification.id ? { ...n, status: NOTIFICATION_STATUS.READ, read_at: new Date().toISOString() } : n)
        .sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
      try {
        const result = await markStaffNotificationAsRead(notification.id, tenantId, branchId);
        if (!result.success && result.notification === undefined) {
          toast({title: "Info", description: result.message || "Failed to mark notification as read on server.", variant:"default"})
           // Revert optimistic update if server failed
           setNotifications(prev => prev.map(n => n.id === notification.id ? { ...n, status: NOTIFICATION_STATUS.UNREAD, read_at: null } : n)
            .sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
        } else if (result.success && result.notification) {
            // Sync with server state
            setNotifications(prev => prev.map(n => n.id === notification.id ? result.notification! : n)
            .sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
        }
      } catch (error) {
        // Revert optimistic update on error
         setNotifications(prev => prev.map(n => n.id === notification.id ? { ...n, status: NOTIFICATION_STATUS.UNREAD, read_at: null } : n)
          .sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
      }
    }
  };

  const handleOpenAcceptManageModal = async () => {
    if (!selectedNotificationForDetails || !selectedNotificationForDetails.transaction_id || !tenantId || !staffUserId || !selectedNotificationForDetails.target_branch_id ) {
      toast({ title: "Error", description: "Notification, transaction, user ID, or target branch ID not available for managing reservation.", variant: "destructive" });
      return;
    }
    setIsSubmittingAction(true); // Use general submitting action state
    try {
      const transaction = await getTransactionDetailsForManagement(selectedNotificationForDetails.transaction_id, tenantId, selectedNotificationForDetails.target_branch_id);
      if (!transaction) {
        toast({ title: "Error", description: "Linked transaction not found or is not in a state pending acceptance.", variant: "destructive" });
        setIsSubmittingAction(false);
        return;
      }
      setTransactionToManage(transaction);

      const rates = await getRatesForBranchSimple(tenantId, selectedNotificationForDetails.target_branch_id);
      setRatesForAcceptModal(rates);

      let initialRateId = transaction.hotel_rate_id ?? undefined;
      if (rates.length > 0) {
        if (initialRateId && !rates.some(rate => rate.id === initialRateId)) {
          toast({title: "Info", description: "Previously selected rate is no longer active. Please select a new rate.", variant: "default"});
          initialRateId = undefined;
        } else if (!initialRateId && rates.length > 0) {
          // If admin didn't set a rate, staff must choose one
          // initialRateId will remain undefined, form validation for required rate will apply
        }
      } else {
        initialRateId = undefined; // No active rates, form validation will show error
      }

      acceptManageForm.reset({
        client_name: transaction.client_name || '',
        selected_rate_id: initialRateId,
        client_payment_method: transaction.client_payment_method ?? undefined,
        notes: transaction.notes ?? '',
        is_advance_reservation: !!transaction.reserved_check_in_datetime,
        reserved_check_in_datetime: formatDateTimeForInput(transaction.reserved_check_in_datetime),
        reserved_check_out_datetime: formatDateTimeForInput(transaction.reserved_check_out_datetime),
        is_paid: transaction.is_paid !== null && transaction.is_paid !== undefined ? transaction.is_paid as 0 | 1 | 2 : TRANSACTION_PAYMENT_STATUS.UNPAID,
        tender_amount_at_checkin: transaction.tender_amount ?? null,
      });

      setIsDetailsModalOpen(false);
      setIsAcceptManageModalOpen(true);
    } catch (error) {
      toast({ title: "Error Loading Details", description: `Failed to load reservation details or rates. ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
      setRatesForAcceptModal([]);
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleAcceptReservationSubmit = async (data: TransactionUnassignedUpdateData) => {
    if (!transactionToManage || !transactionToManage.id || !tenantId || !selectedNotificationForDetails?.target_branch_id || !staffUserId) {
        toast({ title: "Error", description: "Required data for accepting reservation is missing.", variant: "destructive" });
        return;
    }
    setIsSubmittingAction(true);
    try {
      const result = await acceptReservationByStaff(transactionToManage.id, data, tenantId, selectedNotificationForDetails.target_branch_id, staffUserId);
      if (result.success) {
        toast({ title: "Success", description: result.message });
        setIsAcceptManageModalOpen(false);
        fetchNotifications();
        refreshReservationCount?.();
      } else {
        toast({ title: "Acceptance Failed", description: result.message || "Could not accept reservation.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: `Could not accept reservation: ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleOpenDeclineConfirmation = () => {
    if (!selectedNotificationForDetails) return;
    setNotificationToDeclineViaManageModal(selectedNotificationForDetails);
    setIsDeclineConfirmOpen(true);
  };

  const handleConfirmDeclineReservation = async () => {
    if (!notificationToDeclineViaManageModal || !notificationToDeclineViaManageModal.transaction_id || !notificationToDeclineViaManageModal.target_branch_id || !tenantId || !staffUserId) {
        toast({ title: "Error", description: "Required data for declining reservation is missing.", variant: "destructive" });
        setIsDeclineConfirmOpen(false);
        return;
    }
    setIsSubmittingAction(true);
    try {
      const result = await declineReservationByStaff(notificationToDeclineViaManageModal.transaction_id, tenantId, notificationToDeclineViaManageModal.target_branch_id, staffUserId);
      if (result.success) {
        toast({ title: "Success", description: "Reservation declined." });
        setIsAcceptManageModalOpen(false);
        setIsDetailsModalOpen(false);
        fetchNotifications();
        refreshReservationCount?.();
      } else {
        toast({ title: "Decline Failed", description: result.message || "Could not decline reservation.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: `Could not decline reservation: ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
    } finally {
      setIsSubmittingAction(false);
      setNotificationToDeclineViaManageModal(null);
      setIsDeclineConfirmOpen(false);
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
          <ShadCardDescription>View messages and notifications for your branch. Click a notification to view details and take action.</ShadCardDescription>
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
            {notifications.map(notif => {
              let cardBgClass = "bg-card border-border";
              let cardTitleClass = "text-card-foreground";
              let cardDescriptionClass = "text-muted-foreground";
              let cardContentTextClass = "text-card-foreground";

              const isUnread = Number(notif.status) === NOTIFICATION_STATUS.UNREAD;
              const isPendingAcceptance = notif.transaction_id && Number(notif.transaction_is_accepted) === TRANSACTION_IS_ACCEPTED_STATUS.PENDING && Number(notif.linked_transaction_lifecycle_status) === TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE;
              const isAcceptedByBranch = notif.transaction_id && Number(notif.transaction_is_accepted) === TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED;
              const isDeclinedByBranch = notif.transaction_id && Number(notif.transaction_is_accepted) === TRANSACTION_IS_ACCEPTED_STATUS.NOT_ACCEPTED;

              if (isPendingAcceptance) {
                cardBgClass = "bg-red-500 border-red-700 animate-pulse-opacity-gentle";
                cardTitleClass = "text-white"; cardDescriptionClass = "text-red-100"; cardContentTextClass = "text-red-50";
              } else if (isAcceptedByBranch) {
                cardBgClass = "bg-green-100 dark:bg-green-800/30 border-green-300 dark:border-green-700";
                cardTitleClass = "text-green-700 dark:text-green-200"; cardDescriptionClass = "text-green-600 dark:text-green-300"; cardContentTextClass = "text-green-700 dark:text-green-200";
              } else if (isDeclinedByBranch) {
                cardBgClass = "bg-red-500 border-red-700";
                cardTitleClass = "text-white"; cardDescriptionClass = "text-red-100"; cardContentTextClass = "text-red-50";
              } else if (isUnread) {
                cardBgClass = cn(cardBgClass, "border-primary");
              }

              return (
                <Card
                  key={notif.id}
                  className={cn("hover:shadow-lg transition-shadow cursor-pointer border-2", cardBgClass)}
                  onClick={() => handleCardClick(notif)}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className={cn("text-md truncate", cardTitleClass)} title={notif.message}>
                        {notif.message.substring(0, 50)}{notif.message.length > 50 ? "..." : ""}
                    </CardTitle>
                    <ShadCardDescription className={cn("text-xs", cardDescriptionClass)}>
                      From: {notif.creator_username || "System"} | {notif.created_at ? format(parseISO(notif.created_at.replace(' ', 'T')), 'yyyy-MM-dd hh:mm aa') : 'N/A'}
                    </ShadCardDescription>
                  </CardHeader>
                  <CardContent className={cn("text-xs pb-3", cardContentTextClass)}>
                    <p>Status: <span className={cn(isUnread && !isPendingAcceptance ? "font-semibold text-primary" : "font-normal", notif.status === NOTIFICATION_STATUS.READ && cardContentTextClass !== "text-card-foreground" ? cardContentTextClass : "") }>{NOTIFICATION_STATUS_TEXT[notif.status]}</span></p>
                    {notif.transaction_id && (
                      <p>Linked Reservation: Status 
                          <span className="font-semibold">
                            {notif.linked_transaction_lifecycle_status !== null ? 
                            (TRANSACTION_LIFECYCLE_STATUS_TEXT[Number(notif.linked_transaction_lifecycle_status) as keyof typeof TRANSACTION_LIFECYCLE_STATUS_TEXT] || 'N/A') 
                            : 'N/A'}
                          </span> | 
                          Acceptance 
                            <span className="font-semibold">
                               {notif.transaction_is_accepted !== null && notif.transaction_is_accepted !== undefined
                                  ? TRANSACTION_IS_ACCEPTED_STATUS_TEXT[notif.transaction_is_accepted as keyof typeof TRANSACTION_IS_ACCEPTED_STATUS_TEXT] : 'N/A'}
                        </span> 
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={isDetailsModalOpen} onOpenChange={setIsDetailsModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <ShadDialogTitle>Notification Details</ShadDialogTitle>
          </DialogHeader>
          {selectedNotificationForDetails && (
            <div className="py-4 space-y-2">
              <div>
                <p><strong>Message:</strong></p>
                <pre className="whitespace-pre-wrap text-sm bg-muted p-2 rounded-md mt-1">{selectedNotificationForDetails.message}</pre>
              </div>
              <p><strong>From:</strong> {selectedNotificationForDetails.creator_username || "System"}</p>
              <p><strong>Target Branch:</strong> {selectedNotificationForDetails.target_branch_name || "Tenant-wide"}</p>
              <p><strong>Date:</strong> {selectedNotificationForDetails.created_at ? format(parseISO(selectedNotificationForDetails.created_at.replace(' ', 'T')), 'yyyy-MM-dd hh:mm:ss aa') : 'N/A'}</p>
              <p><strong>Status:</strong> {NOTIFICATION_STATUS_TEXT[selectedNotificationForDetails.status]}</p>
              {selectedNotificationForDetails.transaction_id && (
                <>
                  <p><strong>Linked Transaction ID:</strong> {selectedNotificationForDetails.transaction_id}</p>
                  <p><strong>Linked Reservation Status:</strong> {selectedNotificationForDetails.linked_transaction_lifecycle_status !== null ? (TRANSACTION_LIFECYCLE_STATUS_TEXT[Number(selectedNotificationForDetails.linked_transaction_lifecycle_status) as keyof typeof TRANSACTION_LIFECYCLE_STATUS_TEXT] || 'N/A') : 'N/A'}</p>
                  <p><strong>Acceptance by Branch:</strong> 
                  {selectedNotificationForDetails.transaction_is_accepted !== null && selectedNotificationForDetails.transaction_is_accepted !== undefined
                                  ? TRANSACTION_IS_ACCEPTED_STATUS_TEXT[selectedNotificationForDetails.transaction_is_accepted as keyof typeof TRANSACTION_IS_ACCEPTED_STATUS_TEXT] : 'N/A'}
                  {/* selectedNotificationForDetails.transaction_is_accepted !== null ? TRANSACTION_IS_ACCEPTED_STATUS_TEXT[selectedNotificationForDetails.transaction_is_accepted] : 'N/A'} */}
                  </p> 
                </>
              )}
            </div>
          )}
          <DialogFooter className="sm:justify-between">
            {selectedNotificationForDetails?.transaction_id &&
             Number(selectedNotificationForDetails?.linked_transaction_lifecycle_status) === TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE &&
             Number(selectedNotificationForDetails?.transaction_is_accepted) === TRANSACTION_IS_ACCEPTED_STATUS.PENDING && (
              <Button onClick={handleOpenAcceptManageModal} disabled={isSubmittingAction || !selectedNotificationForDetails.target_branch_id}>
                {(isSubmittingAction && transactionToManage?.id === selectedNotificationForDetails.transaction_id) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarCheck className="mr-2 h-4 w-4" />}
                Manage Reservation
              </Button>
            )}
            <DialogClose asChild><Button type="button" variant="outline">Close</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isAcceptManageModalOpen} onOpenChange={(open) => {
          if (!open) { setTransactionToManage(null); setRatesForAcceptModal([]); acceptManageForm.reset(); }
          setIsAcceptManageModalOpen(open);
      }}>
        <DialogContent className="sm:max-w-md p-1 flex flex-col max-h-[85vh]">
          <DialogHeader className="p-2 border-b">
            <ShadDialogTitle>Manage Admin-Created Reservation</ShadDialogTitle>
            <ShadDialogDescriptionAliased>Client: {transactionToManage?.client_name}</ShadDialogDescriptionAliased>
          </DialogHeader>
          {transactionToManage && (
            <Form {...acceptManageForm}>
              <form className="flex flex-col flex-grow overflow-hidden bg-card rounded-md">
                <div className="flex-grow overflow-y-auto p-3 space-y-3">
                  <FormField control={acceptManageForm.control} name="client_name" render={({ field }) => (
                    <FormItem><FormLabel>Client Name</FormLabel><FormControl><Input placeholder="Jane Doe" {...field} value={field.value ?? ''} className="w-full" /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={acceptManageForm.control} name="selected_rate_id" render={({ field }) => (
                    <FormItem><FormLabel>Select Rate *</FormLabel>
                      <Select
                        onValueChange={(value) => field.onChange(value ? parseInt(value) : undefined)}
                        value={field.value?.toString() ?? ""}
                        disabled={ratesForAcceptModal.length === 0 || isSubmittingAction}
                      >
                        <FormControl><SelectTrigger className="w-full"><SelectValue placeholder={ratesForAcceptModal.length === 0 ? "No active rates for target branch" : "Select a rate *"} /></SelectTrigger></FormControl>
                        <SelectContent>{ratesForAcceptModal.map(rate => (<SelectItem key={rate.id} value={rate.id.toString()}>{rate.name} (₱{Number(rate.price).toFixed(2)} for {rate.hours}hr/s)</SelectItem>))}</SelectContent>
                      </Select><FormMessage />
                      {ratesForAcceptModal.length === 0 && !isSubmittingAction && <p className="text-xs text-destructive mt-1">No active rates found. A rate is required to accept.</p>}
                    </FormItem>
                  )} />
                  <FormField control={acceptManageForm.control} name="client_payment_method" render={({ field }) => (
                    <FormItem><FormLabel>Payment Method</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? undefined}>
                        <FormControl><SelectTrigger className="w-full"><SelectValue placeholder="Select payment method (Optional)" /></SelectTrigger></FormControl>
                        <SelectContent><SelectItem value="Cash">Cash</SelectItem><SelectItem value="Card">Card</SelectItem><SelectItem value="Online Payment">Online Payment</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent>
                      </Select><FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={acceptManageForm.control} name="notes" render={({ field }) => (
                    <FormItem><FormLabel>Notes (Optional)</FormLabel><FormControl><Textarea placeholder="Reservation notes..." {...field} value={field.value ?? ''} className="w-full" /></FormControl><FormMessage /></FormItem>
                  )} />
                   <FormField
                      control={acceptManageForm.control}
                      name="is_paid"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-3 shadow-sm w-full">
                          <FormControl>
                            <Checkbox
                              checked={field.value === TRANSACTION_PAYMENT_STATUS.PAID || field.value === TRANSACTION_PAYMENT_STATUS.ADVANCE_PAID}
                              onCheckedChange={(checked) => {
                                const currentIsAdvance = acceptManageForm.getValues("is_advance_reservation");
                                field.onChange(checked ? (currentIsAdvance ? TRANSACTION_PAYMENT_STATUS.ADVANCE_PAID : TRANSACTION_PAYMENT_STATUS.PAID) : TRANSACTION_PAYMENT_STATUS.UNPAID);
                                if (!checked) {
                                  acceptManageForm.setValue('tender_amount_at_checkin', null, { shouldValidate: true });
                                }
                              }}
                            />
                          </FormControl>
                          <div className="space-y-1 leading-none">
                            <FormLabel>Mark as Paid?</FormLabel>
                          </div>
                        </FormItem>
                      )}
                    />
                    {(watchIsPaidAcceptManageForm === TRANSACTION_PAYMENT_STATUS.PAID || watchIsPaidAcceptManageForm === TRANSACTION_PAYMENT_STATUS.ADVANCE_PAID) && (
                      <FormField
                        control={acceptManageForm.control}
                        name="tender_amount_at_checkin"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Tender Amount *</FormLabel>
                            <FormControl>
                              <Input
                                type="text"
                                placeholder="0.00"
                                {...field}
                                value={field.value === null || field.value === undefined ? "" : String(field.value)}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val === "" || /^[0-9]*\.?[0-9]{0,2}$/.test(val)) {
                                    field.onChange(val === "" ? null : parseFloat(val));
                                  }
                                }}
                                className="w-full"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                  <FormField control={acceptManageForm.control} name="is_advance_reservation"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-3 shadow-sm w-full">
                        <FormControl>
                          <Checkbox
                            checked={!!field.value}
                            onCheckedChange={(checked) => {
                                field.onChange(!!checked);
                                const currentIsPaid = acceptManageForm.getValues("is_paid");
                                if (currentIsPaid !== TRANSACTION_PAYMENT_STATUS.UNPAID) {
                                    acceptManageForm.setValue("is_paid", !!checked ? TRANSACTION_PAYMENT_STATUS.ADVANCE_PAID : TRANSACTION_PAYMENT_STATUS.PAID, { shouldValidate: true });
                                }
                            }}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none"><FormLabel>Advance Future Reservation?</FormLabel></div>
                      </FormItem>
                    )}
                  />
                  {watchIsAdvanceReservationForm && (
                    <>
                      <FormField control={acceptManageForm.control} name="reserved_check_in_datetime" render={({ field }) => (
                        <FormItem><FormLabel>Reserved Check-in Date & Time *</FormLabel><FormControl><Input type="datetime-local" className="w-full" {...field} value={field.value || ""} min={format(new Date(), "yyyy-MM-dd'T'HH:mm")} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={acceptManageForm.control} name="reserved_check_out_datetime" render={({ field }) => (
                        <FormItem><FormLabel>Reserved Check-out Date & Time *</FormLabel><FormControl><Input type="datetime-local" className="w-full" {...field} value={field.value || ""} min={acceptManageForm.getValues('reserved_check_in_datetime') || format(new Date(), "yyyy-MM-dd'T'HH:mm")} /></FormControl><FormMessage /></FormItem>
                      )} />
                    </>
                  )}
                </div>
                <DialogFooter className="bg-card py-2 border-t px-3 sticky bottom-0 z-10 flex flex-row justify-between sm:justify-between space-x-2">
                    <Button type="button" variant="destructive" className="flex-1 w-1/3 sm:w-auto" onClick={handleOpenDeclineConfirmation} disabled={isSubmittingAction}>
                        <Ban className="mr-2 h-4 w-4" /> Decline
                    </Button>
                    <DialogClose asChild className="flex-1 w-1/3 sm:w-auto">
                        <Button type="button" variant="outline">Cancel</Button>
                    </DialogClose>
                    <Button
                        type="button"
                        className="flex-1 w-1/3 sm:w-auto"
                        onClick={acceptManageForm.handleSubmit(handleAcceptReservationSubmit)}
                        disabled={isSubmittingAction || !acceptManageForm.formState.isValid || (ratesForAcceptModal.length === 0 && !acceptManageForm.getValues('selected_rate_id')) }
                    >
                        {isSubmittingAction && <Loader2 className="mr-2 h-4 w-4 animate-spin" /> }
                        <CheckCircle2 className="mr-2 h-4 w-4"/> Accept
                    </Button>
                </DialogFooter>
              </form>
            </Form>
          )}
        </DialogContent>
      </Dialog>

       <AlertDialog open={isDeclineConfirmOpen} onOpenChange={(open) => { if(!open) { setNotificationToDeclineViaManageModal(null); setIsDeclineConfirmOpen(false); }}}>
            <AlertDialogContent>
                <AlertDialogHeader><ShadAlertDialogTitleConfirm>Confirm Decline</ShadAlertDialogTitleConfirm>
                    <ShadAlertDialogDescriptionConfirm>Are you sure you want to decline this reservation for "{notificationToDeclineViaManageModal?.message.substring(0,30)}..." (linked to Notification ID: {notificationToDeclineViaManageModal?.id})?</ShadAlertDialogDescriptionConfirm>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => {setNotificationToDeclineViaManageModal(null); setIsDeclineConfirmOpen(false);}}>No</AlertDialogCancel>
                    <AlertDialogAction onClick={handleConfirmDeclineReservation} disabled={isSubmittingAction}>
                        {isSubmittingAction ? <Loader2 className="animate-spin" /> : "Yes, Decline"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    </Card>
  );
}
