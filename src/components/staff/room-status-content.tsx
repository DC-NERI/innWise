
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription as ShadCardDescription } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle as ShadDialogTitle, DialogFooter, DialogClose, DialogDescription as ShadDialogDescriptionAliased } from '@/components/ui/dialog'; // Aliased for clarity
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle as ShadAlertDialogTitle, AlertDialogDescription as ShadAlertDialogDescriptionFromUI, AlertDialogTrigger } from "@/components/ui/alert-dialog"; // Aliased for clarity
import { Form, FormControl, FormField, FormItem, FormLabel as RHFFormLabel, FormMessage } from '@/components/ui/form';
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { BedDouble, Loader2, Info, User as UserIcon, LogOutIcon, LogIn, CalendarClock, Edit3, Ban, CheckCircle2, CalendarPlus, Tags, Eye, X, XCircle, Search, AlertTriangle, Users as UsersIconLucide, RefreshCw, Wrench } from "lucide-react";
import type { HotelRoom, Transaction, SimpleRate, GroupedRooms, RoomCleaningStatusUpdateData, CheckoutFormData } from '@/lib/types';
import { listRoomsForBranch, getRatesForBranchSimple } from '@/actions/admin';
import {
  createTransactionAndOccupyRoom,
  getActiveTransactionForRoom,
  checkOutGuestAndFreeRoom,
  updateTransactionNotes,
  createReservation,
  updateReservedTransactionDetails,
  cancelReservation,
  checkInReservedGuest,
  updateRoomCleaningStatus,
  updateRoomCleaningNotes
} from '@/actions/staff';
import { transactionCreateSchema, TransactionCreateData, transactionUpdateNotesSchema, TransactionUpdateNotesData, transactionReservedUpdateSchema, roomCleaningStatusUpdateSchema, checkoutFormSchema } from '@/lib/schemas';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  ROOM_AVAILABILITY_STATUS,
  ROOM_AVAILABILITY_STATUS_TEXT,
  TRANSACTION_STATUS,
  TRANSACTION_STATUS_TEXT,
  ROOM_CLEANING_STATUS,
  ROOM_CLEANING_STATUS_TEXT,
  ROOM_CLEANING_STATUS_OPTIONS
} from '@/lib/constants';
import { format, parseISO, addHours, differenceInMilliseconds } from 'date-fns';
import type { z } from 'zod';

interface RoomStatusContentProps {
  tenantId: number | null;
  branchId: number | null;
  staffUserId: number | null;
  showAvailableRoomsOverview: boolean;
  onCloseAvailableRoomsOverview: () => void;
}

const defaultBookingFormValues: TransactionCreateData = {
  client_name: '',
  selected_rate_id: undefined,
  client_payment_method: 'Cash',
  notes: '',
};

const defaultNotesEditFormValues: TransactionUpdateNotesData = {
  notes: '',
};

const defaultReservationEditFormValues: z.infer<typeof transactionReservedUpdateSchema> = {
  client_name: '',
  client_payment_method: undefined,
  notes: '',
};

const defaultCheckoutFormValues: CheckoutFormData = {
    tender_amount: 0,
};

const defaultCleaningFormValues: RoomCleaningStatusUpdateData = {
  cleaning_status: ROOM_CLEANING_STATUS.CLEAN,
};


export default function RoomStatusContent({ tenantId, branchId, staffUserId, showAvailableRoomsOverview, onCloseAvailableRoomsOverview }: RoomStatusContentProps) {
  const [rooms, setRooms] = useState<HotelRoom[]>([]);
  const [groupedRooms, setGroupedRooms] = useState<GroupedRooms>({});
  const [isLoading, setIsLoading] = useState(true);
  
  const [bookingMode, setBookingMode] = useState<'book' | 'reserve' | null>(null);
  const [isBookingDialogOpen, setIsBookingDialogOpen] = useState(false);
  const [selectedRoomForBooking, setSelectedRoomForBooking] = useState<HotelRoom | null>(null);
  const [allBranchActiveRates, setAllBranchActiveRates] = useState<SimpleRate[]>([]);
  const [applicableRatesForBookingDialog, setApplicableRatesForBookingDialog] = useState<SimpleRate[]>([]);

  const [isTransactionDetailsDialogOpen, setIsTransactionDetailsDialogOpen] = useState(false);
  const [transactionDetails, setTransactionDetails] = useState<Transaction | null>(null);
  const [editingModeForDialog, setEditingModeForDialog] = useState<'notesOnly' | 'fullReservation' | null>(null);
  const [isEditNotesMode, setIsEditNotesMode] = useState(false);
  
  const [roomForActionConfirmation, setRoomForActionConfirmation] = useState<HotelRoom | null>(null);
  const [activeTransactionIdForAction, setActiveTransactionIdForAction] = useState<number | null>(null);
  
  const [activeTransactionIdForCheckout, setActiveTransactionIdForCheckout] = useState<number | null>(null);
  const [transactionDetailsForCheckout, setTransactionDetailsForCheckout] = useState<Transaction | null>(null);
  const [currentBillForCheckout, setCurrentBillForCheckout] = useState<number | null>(null);
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);

  const [isCancelReservationConfirmOpen, setIsCancelReservationConfirmOpen] = useState(false);
  const [isCheckInReservedConfirmOpen, setIsCheckInReservedConfirmOpen] = useState(false);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentTimeForCheckoutModal, setCurrentTimeForCheckoutModal] = useState<string>('');

  const [isCleaningNotesModalOpen, setIsCleaningNotesModalOpen] = useState(false);
  const [selectedRoomForCleaningNotes, setSelectedRoomForCleaningNotes] = useState<HotelRoom | null>(null);
  const [isSubmittingCleaningStatusForRoomId, setIsSubmittingCleaningStatusForRoomId] = useState<number | null>(null);

  const [isNotesOnlyModalOpen, setIsNotesOnlyModalOpen] = useState(false);
  const [currentNotesForDisplay, setCurrentNotesForDisplay] = useState<string | null>(null);
  
  const [isRoomRatesDetailModalOpen, setIsRoomRatesDetailModalOpen] = useState(false);
  const [selectedRoomForRatesDisplay, setSelectedRoomForRatesDisplay] = useState<HotelRoom | null>(null);

  const { toast } = useToast();

  const bookingForm = useForm<TransactionCreateData>({
    resolver: zodResolver(transactionCreateSchema),
    defaultValues: defaultBookingFormValues,
  });

  const notesEditForm = useForm<TransactionUpdateNotesData>({ 
    resolver: zodResolver(transactionUpdateNotesSchema),
    defaultValues: defaultNotesEditFormValues,
  });

  const reservationEditForm = useForm<z.infer<typeof transactionReservedUpdateSchema>>({
    resolver: zodResolver(transactionReservedUpdateSchema),
    defaultValues: defaultReservationEditFormValues,
  });

  const checkoutForm = useForm<CheckoutFormData>({
    resolver: zodResolver(checkoutFormSchema),
    defaultValues: defaultCheckoutFormValues,
  });
  const tenderAmountWatch = useWatch({ control: checkoutForm.control, name: 'tender_amount'});

  const cleaningNotesForm = useForm<{ notes: string }>({
    defaultValues: { notes: '' },
  });
  
  const cleaningStatusUpdateForm = useForm<RoomCleaningStatusUpdateData>({
    resolver: zodResolver(roomCleaningStatusUpdateSchema),
    defaultValues: defaultCleaningFormValues,
  });
  const [selectedRoomIdForCleaningUpdate, setSelectedRoomIdForCleaningUpdate] = useState<string>('');


  const updateRoomInLocalState = useCallback((updatedRoomPartial: Partial<HotelRoom> & { id: number }) => {
    console.log("[updateRoomInLocalState] Updating room ID:", updatedRoomPartial.id, "with data:", updatedRoomPartial);
    setRooms(prevRooms => {
      const newRooms = prevRooms.map(r =>
        r.id === updatedRoomPartial.id ? { ...r, ...updatedRoomPartial } : r
      );

      const newGrouped = newRooms.reduce((acc, currentRoom) => {
        const floorKey = currentRoom.floor?.toString() ?? 'Ground Floor / Other';
        if (!acc[floorKey]) acc[floorKey] = [];
        acc[floorKey].push(currentRoom);
        acc[floorKey].sort((a, b) => (a.room_code || "").localeCompare(b.room_code || ""));
        return acc;
      }, {} as GroupedRooms);

      const sortedFloors = Object.keys(newGrouped).sort((a, b) => {
          const numA = parseInt(a); const numB = parseInt(b);
          if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
          if (!isNaN(numA)) return -1; if (!isNaN(numB)) return 1;
          return a.localeCompare(b);
      });
      const sortedGroupedRooms: GroupedRooms = {};
      for (const floor of sortedFloors) sortedGroupedRooms[floor] = newGrouped[floor];
      setGroupedRooms(sortedGroupedRooms);
      return newRooms;
    });
  }, []);


  const fetchRoomsAndRatesData = useCallback(async () => {
    if (!tenantId || !branchId) {
      setIsLoading(false);
      setRooms([]);
      setGroupedRooms({});
      setAllBranchActiveRates([]);
      return;
    }
    setIsLoading(true);
    console.log(`[fetchRoomsAndRatesData] Fetching for tenantId: ${tenantId}, branchId: ${branchId}`);
    try {
      const [fetchedRooms, fetchedBranchRates] = await Promise.all([
        listRoomsForBranch(branchId, tenantId),
        getRatesForBranchSimple(tenantId, branchId) 
      ]);
      
      console.log("[fetchRoomsAndRatesData] Fetched rooms count:", fetchedRooms.length);
      console.log("[fetchRoomsAndRatesData] Fetched branch rates count:", fetchedBranchRates.length);

      setRooms(fetchedRooms);
      setAllBranchActiveRates(fetchedBranchRates);

      const grouped = fetchedRooms.reduce((acc, room) => {
        const floorKey = room.floor?.toString() ?? 'Ground Floor / Other';
        if (!acc[floorKey]) acc[floorKey] = [];
        acc[floorKey].push(room);
        acc[floorKey].sort((a, b) => (a.room_code || "").localeCompare(b.room_code || ""));
        return acc;
      }, {} as GroupedRooms);

      const sortedFloors = Object.keys(grouped).sort((a, b) => {
          const numA = parseInt(a); const numB = parseInt(b);
          if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
          if (!isNaN(numA)) return -1; if (!isNaN(numB)) return 1;
          return a.localeCompare(b);
      });
      const sortedGroupedRooms: GroupedRooms = {};
      for (const floor of sortedFloors) sortedGroupedRooms[floor] = grouped[floor];
      setGroupedRooms(sortedGroupedRooms);

    } catch (error) {
      console.error("Error fetching room/rate data:", error);
      toast({ title: "Error", description: `Could not fetch room statuses or rates. ${error instanceof Error ? error.message : ''}`, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [tenantId, branchId, toast]);

  useEffect(() => {
    fetchRoomsAndRatesData();
  }, [fetchRoomsAndRatesData]);

  const handleOpenBookingDialog = (room: HotelRoom, mode: 'book' | 'reserve') => {
    if (!tenantId || !branchId) {
      toast({ title: "Error", description: "Tenant or branch information missing.", variant: "destructive" });
      return;
    }
     if (room.is_available !== ROOM_AVAILABILITY_STATUS.AVAILABLE || room.cleaning_status !== ROOM_CLEANING_STATUS.CLEAN) {
        toast({ title: `Cannot ${mode}`, description: `Room must be "Available" and "${ROOM_CLEANING_STATUS_TEXT[ROOM_CLEANING_STATUS.CLEAN]}". Current: ${ROOM_AVAILABILITY_STATUS_TEXT[room.is_available]}, ${ROOM_CLEANING_STATUS_TEXT[room.cleaning_status || ROOM_CLEANING_STATUS.CLEAN]}`, variant: "default" });
        return;
    }

    setSelectedRoomForBooking(room);
    setBookingMode(mode);

    const roomRateIds = Array.isArray(room.hotel_rate_id) ? room.hotel_rate_id : [];
    const applicable = allBranchActiveRates.filter(branchRate => roomRateIds.includes(branchRate.id));
    setApplicableRatesForBookingDialog(applicable);
    
    const defaultRateIdForForm = applicable.length > 0 ? applicable[0].id : undefined;
    bookingForm.reset({...defaultBookingFormValues, selected_rate_id: defaultRateIdForForm });
    setIsBookingDialogOpen(true);
  };

  const handleBookingSubmit = async (data: TransactionCreateData) => {
     if (!selectedRoomForBooking || !staffUserId || !tenantId || !branchId || !data.selected_rate_id || !bookingMode) {
        console.error("Booking Submit Error - Missing Data:", {
          selectedRoomForBooking, staffUserId, tenantId, branchId, data_selected_rate_id: data.selected_rate_id, bookingMode
        });
        toast({ title: "Submission Error",
        description: `Booking details incomplete. Room: ${!!selectedRoomForBooking}, Staff: ${!!staffUserId}, Rate: ${!!data.selected_rate_id}, Mode: ${bookingMode}`,
        variant: "destructive" });
        return;
    }
    setIsSubmitting(true);
    try {
      let result;
      if (bookingMode === 'book') {
        result = await createTransactionAndOccupyRoom(
          data, tenantId, branchId, selectedRoomForBooking.id, data.selected_rate_id, staffUserId
        );
      } else if (bookingMode === 'reserve') {
         result = await createReservation(
          data, tenantId, branchId, selectedRoomForBooking.id, data.selected_rate_id, staffUserId
        );
      } else {
        toast({title: "Error", description: "Invalid booking mode.", variant: "destructive"});
        setIsSubmitting(false);
        return;
      }

      if (result.success && result.updatedRoomData) {
        toast({ title: "Success", description: result.message || (bookingMode === 'book' ? "Guest checked in." : "Room reserved.") });
        setIsBookingDialogOpen(false);
        updateRoomInLocalState(result.updatedRoomData);
      } else {
        toast({ title: `${bookingMode === 'book' ? "Booking" : "Reservation"} Failed`, description: result.message, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: `An unexpected error occurred during ${bookingMode}.`, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleViewDetails = useCallback(async (room: HotelRoom) => {
    if (!tenantId || !branchId) {
      toast({ title: "Error", description: "Tenant or branch ID missing.", variant: "destructive" });
      return;
    }
    if (!room.transaction_id) {
      toast({ title: "Info", description: "No active transaction linked to this room for details.", variant: "default" });
      setTransactionDetails(null);
      setEditingModeForDialog(null);
      setIsTransactionDetailsDialogOpen(true); 
      return;
    }
    
    console.log(`[handleViewDetails] Room ID: ${room.id}, Transaction ID: ${room.transaction_id}`);
    setIsSubmitting(true); 
    try {
      const transaction = await getActiveTransactionForRoom(room.transaction_id, tenantId, branchId);
      console.log("[handleViewDetails] Fetched transaction:", transaction);
      if (transaction) {
        setTransactionDetails(transaction);
        if (room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED && transaction.status === TRANSACTION_STATUS.UNPAID) {
          setEditingModeForDialog('notesOnly');
          setIsEditNotesMode(false);
          notesEditForm.reset({ notes: transaction.notes || '' });
        } else if (room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED && (transaction.status === TRANSACTION_STATUS.ADVANCE_PAID || transaction.status === TRANSACTION_STATUS.ADVANCE_RESERVATION)) {
          setEditingModeForDialog('fullReservation');
          reservationEditForm.reset({
            client_name: transaction.client_name,
            client_payment_method: transaction.client_payment_method || undefined,
            notes: transaction.notes || '',
          });
        } else {
          setEditingModeForDialog(null); 
          notesEditForm.reset({ notes: transaction.notes || '' }); 
        }
      } else {
        toast({ title: "No Details", description: `No active transaction found for ID ${room.transaction_id}.`, variant: "default" });
        setTransactionDetails(null);
        setEditingModeForDialog(null);
      }
      setIsTransactionDetailsDialogOpen(true);
    } catch (error) {
      toast({ title: "Error", description: "Failed to fetch transaction details.", variant: "destructive" });
      setTransactionDetails(null);
      setEditingModeForDialog(null);
    } finally {
      setIsSubmitting(false);
    }
  }, [tenantId, branchId, toast, notesEditForm, reservationEditForm, rooms]);


  const handleOpenCheckoutConfirmation = useCallback(async (room: HotelRoom) => {
    console.log("[handleOpenCheckoutConfirmation] Clicked for room:", room);
    if (!tenantId || !branchId || !staffUserId) {
        toast({ title: "Error", description: "Tenant, branch, or staff information missing.", variant: "destructive" });
        return;
    }
    if (room.is_available !== ROOM_AVAILABILITY_STATUS.OCCUPIED) {
        toast({ title: "Action Not Allowed", description: "Room is not currently occupied.", variant: "default" });
        return;
    }
    if (!room.transaction_id) {
        toast({ title: "Action Not Allowed", description: "No transaction linked for checkout.", variant: "default" });
        return;
    }
    
    setIsSubmitting(true); 
    try {
        const transaction = await getActiveTransactionForRoom(room.transaction_id, tenantId, branchId);
        if (!transaction || transaction.status !== TRANSACTION_STATUS.UNPAID) { 
            toast({ title: "Action Not Allowed", description: `Transaction (ID: ${room.transaction_id}) is not in an 'Unpaid/Occupied' state. Current status: ${transaction ? TRANSACTION_STATUS_TEXT[transaction.status as keyof typeof TRANSACTION_STATUS_TEXT] : 'Unknown'}.`, variant: "default"});
            setIsSubmitting(false);
            return;
        }

        setRoomForActionConfirmation(room);
        setActiveTransactionIdForCheckout(room.transaction_id);
        setTransactionDetailsForCheckout(transaction);

        const check_in_time_str = transaction.check_in_time;
        const check_in_time = parseISO(check_in_time_str.replace(' ', 'T'));
        const current_time = new Date();
        setCurrentTimeForCheckoutModal(format(current_time, 'yyyy-MM-dd hh:mm:ss aa'));

        const diffMillisecondsVal = differenceInMilliseconds(current_time, check_in_time);
        let hours_used = Math.ceil(diffMillisecondsVal / (1000 * 60 * 60));
        if (hours_used <= 0) hours_used = 1;

        let bill = parseFloat(transaction.rate_price?.toString() || '0');
        const rate_hours_val = parseInt(transaction.rate_hours?.toString() || '0', 10);
        const rate_excess_hour_price_val = transaction.rate_excess_hour_price ? parseFloat(transaction.rate_excess_hour_price.toString()) : null;

        if (rate_hours_val > 0 && hours_used > rate_hours_val) {
            const excess_hours = hours_used - rate_hours_val;
            if (rate_excess_hour_price_val && rate_excess_hour_price_val > 0) {
                bill += excess_hours * rate_excess_hour_price_val;
            }
        }
         if (hours_used > 0 && bill < parseFloat(transaction.rate_price?.toString() || '0')) {
             bill = parseFloat(transaction.rate_price?.toString() || '0');
        }
        setCurrentBillForCheckout(bill);
        
        checkoutForm.reset({ tender_amount: 0 });
        setIsCheckoutModalOpen(true);

    } catch (error) {
        toast({ title: "Error", description: "Failed to fetch details for checkout.", variant: "destructive" });
    } finally {
        setIsSubmitting(false);
    }
  }, [tenantId, branchId, staffUserId, toast, checkoutForm]);

  const handleConfirmCheckout = async (formData: CheckoutFormData) => {
      if (!activeTransactionIdForCheckout || !roomForActionConfirmation || !staffUserId || !tenantId || !branchId || currentBillForCheckout === null) {
          toast({ title: "Checkout Error", description: "Missing critical details for checkout.", variant: "destructive" });
          return;
      }
      const tenderAmountValue = parseFloat(String(formData.tender_amount)); 
      console.log("[Checkout] Tender Amount from form:", tenderAmountValue, "Current Bill:", currentBillForCheckout);

      if (isNaN(tenderAmountValue) || tenderAmountValue < currentBillForCheckout) {
          checkoutForm.setError("tender_amount", { type: "manual", message: "Tender amount must be a valid number and greater than or equal to the total bill."});
          return;
      }
      setIsSubmitting(true);
      try {
          const result = await checkOutGuestAndFreeRoom(
              activeTransactionIdForCheckout, staffUserId, tenantId, branchId, roomForActionConfirmation.id, tenderAmountValue
          );
          if (result.success && result.updatedRoomData) {
              toast({ title: "Success", description: result.message || "Guest checked out successfully." });
              updateRoomInLocalState(result.updatedRoomData);
              setIsCheckoutModalOpen(false);
          } else {
              toast({ title: "Check-out Failed", description: result.message || "Could not complete check-out.", variant: "destructive" });
          }
      } catch (error) {
          toast({ title: "Error", description: "An unexpected error occurred during check-out.", variant: "destructive" });
      } finally {
          setIsSubmitting(false);
      }
  };

  const handleOpenCheckInReservedConfirmation = useCallback(async (room: HotelRoom) => {
    if (!tenantId || !branchId || !staffUserId) {
        toast({ title: "Error", description: "Required details missing for check-in.", variant: "destructive" });
        return;
    }
    if (room.is_available !== ROOM_AVAILABILITY_STATUS.RESERVED) {
        toast({ title: "Action Not Allowed", description: "Room is not currently reserved.", variant: "default" });
        return;
    }
    if (!room.transaction_id) { 
        toast({ title: "Action Not Allowed", description: "No transaction linked to this reserved room.", variant: "default" });
        return;
    }
    if (room.cleaning_status !== ROOM_CLEANING_STATUS.CLEAN) {
      toast({ title: "Action Not Allowed", description: `Room must be clean to check-in reserved guest. Current: ${ROOM_CLEANING_STATUS_TEXT[room.cleaning_status || ROOM_CLEANING_STATUS.CLEAN]}.`, variant: "default" });
      return;
    }
    
    setIsSubmitting(true);
    const transaction = await getActiveTransactionForRoom(room.transaction_id, tenantId, branchId);
    setIsSubmitting(false);

    if (!transaction || (transaction.status !== TRANSACTION_STATUS.ADVANCE_PAID && transaction.status !== TRANSACTION_STATUS.ADVANCE_RESERVATION && transaction.status !== TRANSACTION_STATUS.UNPAID /* For admin created, then accepted -> unpaid */ )) { 
        toast({ title: "Action Not Allowed", description: `Reservation (ID: ${room.transaction_id}) is not in a check-in ready state. Status: ${transaction ? TRANSACTION_STATUS_TEXT[transaction.status as keyof typeof TRANSACTION_STATUS_TEXT] : 'Unknown'}.`, variant: "default"});
        return;
    }

    setRoomForActionConfirmation(room);
    setActiveTransactionIdForAction(room.transaction_id); 
    setIsCheckInReservedConfirmOpen(true);
  }, [tenantId, branchId, staffUserId, toast]);

  const handleConfirmCheckInReservedGuest = async () => {
    if (!activeTransactionIdForAction || !roomForActionConfirmation || !staffUserId || !tenantId || !branchId) {
        toast({ title: "Check-in Error", description: "Required information for reserved check-in is missing.", variant: "destructive" });
        setIsCheckInReservedConfirmOpen(false);
        return;
    }
    setIsSubmitting(true);
    try {
        const result = await checkInReservedGuest(
            activeTransactionIdForAction, 
            roomForActionConfirmation.id,
            tenantId,
            branchId,
            staffUserId
        );
        if (result.success && result.updatedRoomData) {
            toast({ title: "Success", description: result.message || "Reserved guest checked in." });
            updateRoomInLocalState(result.updatedRoomData);
             if (isTransactionDetailsDialogOpen && transactionDetails?.id === activeTransactionIdForAction) {
                setIsTransactionDetailsDialogOpen(false);
                setTransactionDetails(null);
            }
        } else {
            toast({ title: "Check-in Failed", description: result.message, variant: "destructive" });
        }
    } catch (error) {
        toast({ title: "Error", description: "An unexpected error occurred during reserved check-in.", variant: "destructive" });
    } finally {
        setIsSubmitting(false);
        setIsCheckInReservedConfirmOpen(false);
        setRoomForActionConfirmation(null);
        setActiveTransactionIdForAction(null);
    }
  };

  const handleOpenCancelReservationConfirmation = useCallback(async (room: HotelRoom) => {
    if (!tenantId || !branchId ) { 
        toast({ title: "Error", description: "Required details missing.", variant: "destructive" });
        return;
    }
    if (room.is_available !== ROOM_AVAILABILITY_STATUS.RESERVED) {
        toast({ title: "Action Not Allowed", description: "Room is not currently reserved for cancellation.", variant: "default" });
        return;
    }
    if (!room.transaction_id) {
        toast({ title: "Action Not Allowed", description: "No transaction linked to cancel.", variant: "default" });
        return;
    }
    setIsSubmitting(true);
    const transaction = await getActiveTransactionForRoom(room.transaction_id, tenantId, branchId);
    setIsSubmitting(false);

    if (!transaction || (transaction.status !== TRANSACTION_STATUS.ADVANCE_PAID && transaction.status !== TRANSACTION_STATUS.ADVANCE_RESERVATION && transaction.status !== TRANSACTION_STATUS.UNPAID)) { 
        toast({ title: "Action Not Allowed", description: `Reservation (ID: ${room.transaction_id}) is not in a cancellable state. Status: ${transaction ? TRANSACTION_STATUS_TEXT[transaction.status as keyof typeof TRANSACTION_STATUS_TEXT] : 'Unknown'}.`, variant: "default"});
        return;
    }

    setRoomForActionConfirmation(room);
    setActiveTransactionIdForAction(room.transaction_id);
    setIsCancelReservationConfirmOpen(true);
  }, [tenantId, branchId, toast]);


  const handleConfirmCancelReservation = async () => {
    if (!activeTransactionIdForAction || !roomForActionConfirmation || !tenantId || !branchId) {
        toast({ title: "Cancellation Error", description: "Missing required data for cancellation.", variant: "destructive" });
        setIsCancelReservationConfirmOpen(false);
        return;
    }
    setIsSubmitting(true);
    try {
        const result = await cancelReservation(activeTransactionIdForAction, tenantId, branchId, roomForActionConfirmation.id);
        if (result.success && result.updatedRoomData) {
            toast({ title: "Success", description: "Reservation cancelled successfully." });
            updateRoomInLocalState(result.updatedRoomData);
            if (isTransactionDetailsDialogOpen && transactionDetails?.id === activeTransactionIdForAction) {
                 setIsTransactionDetailsDialogOpen(false);
                 setTransactionDetails(null);
            }
        } else {
            toast({ title: "Cancellation Failed", description: result.message || "Could not cancel reservation.", variant: "destructive" });
        }
    } catch (error) {
        toast({ title: "Error", description: "An unexpected error occurred during cancellation.", variant: "destructive" });
    } finally {
        setIsSubmitting(false);
        setIsCancelReservationConfirmOpen(false);
        setRoomForActionConfirmation(null);
        setActiveTransactionIdForAction(null);
    }
  };


  const handleUpdateTransactionDetails = async (data: TransactionUpdateNotesData) => {
    if (!transactionDetails || !transactionDetails.id || !tenantId || !branchId) {
        toast({ title: "Error", description: "Missing details to update.", variant: "destructive" });
        return;
    }
    setIsSubmitting(true);
    try {
        const result = await updateTransactionNotes(transactionDetails.id, data.notes, tenantId, branchId);
        if (result.success && result.updatedTransaction) {
            toast({ title: "Success", description: "Transaction notes updated." });
            setTransactionDetails(prev => prev ? { ...prev, notes: result.updatedTransaction!.notes } : null);
            notesEditForm.reset({ notes: result.updatedTransaction!.notes || '' });
            setIsEditNotesMode(false);
        } else {
            toast({ title: "Update Failed", description: result.message || "Could not update notes.", variant: "destructive" });
        }
    } catch (error) {
        toast({ title: "Error", description: "Unexpected error updating notes.", variant: "destructive" });
    } finally {
        setIsSubmitting(false);
    }
  };

  const handleReservationEditSubmit = async (data: z.infer<typeof transactionReservedUpdateSchema>) => {
    if (!transactionDetails || !transactionDetails.id || !tenantId || !branchId) {
      toast({ title: "Error", description: "Missing transaction details for update.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await updateReservedTransactionDetails(transactionDetails.id, data, tenantId, branchId);
      if (result.success && result.updatedTransaction) {
        toast({ title: "Success", description: "Reservation details updated." });
        setTransactionDetails(result.updatedTransaction);
        
        const roomToUpdate = rooms.find(r => r.transaction_id === result.updatedTransaction!.id);
        if (roomToUpdate && data.client_name !== roomToUpdate.active_transaction_client_name) {
          updateRoomInLocalState({
            id: roomToUpdate.id,
            active_transaction_client_name: result.updatedTransaction.client_name,
          });
        }
        setEditingModeForDialog(null); 
      } else {
        toast({ title: "Update Failed", description: result.message, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "An unexpected error occurred while updating reservation details.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenNotesOnlyModal = useCallback(async (room: HotelRoom) => {
    console.log("[handleOpenNotesOnlyModal] Room clicked:", room);
    if (!room.transaction_id || !tenantId || !branchId) {
      toast({ title: "Info", description: "Transaction details not available for notes.", variant: "default" });
      return;
    }
    setIsSubmitting(true); 
    try {
      const transaction = await getActiveTransactionForRoom(room.transaction_id, tenantId, branchId);
      console.log("[handleOpenNotesOnlyModal] Fetched transaction:", transaction);
      if (transaction) {
        setCurrentNotesForDisplay(transaction.notes || "No notes recorded for this transaction.");
        setSelectedRoomForCleaningNotes(room); // Though this state is for cleaning notes, it can hold the room context here.
        setIsNotesOnlyModalOpen(true);
      } else {
        toast({ title: "Info", description: "No active transaction found to display notes.", variant: "default" });
      }
    } catch (error) {
      console.error("[handleOpenNotesOnlyModal] Error fetching notes:", error);
      toast({ title: "Error", description: "Failed to fetch notes.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  }, [tenantId, branchId, toast]);
  
  const handleSaveRoomCleaningNotes = async (data: { notes: string }) => {
    if (!selectedRoomForCleaningNotes || !tenantId || !branchId || !staffUserId) {
        toast({ title: "Error", description: "Missing details to update cleaning notes.", variant: "destructive" });
        return;
    }
    setIsSubmitting(true);
    try {
        const result = await updateRoomCleaningNotes(
            selectedRoomForCleaningNotes.id,
            data.notes,
            tenantId,
            branchId,
            staffUserId
        );
        if (result.success && result.updatedRoom) {
            toast({ title: "Success", description: "Cleaning notes updated." });
            updateRoomInLocalState({ id: selectedRoomForCleaningNotes.id, cleaning_notes: result.updatedRoom.cleaning_notes });
            setIsCleaningNotesModalOpen(false);
        } else {
            toast({ title: "Update Failed", description: result.message || "Could not update cleaning notes.", variant: "destructive" });
        }
    } catch (error) {
        toast({ title: "Error", description: "An unexpected error occurred saving cleaning notes.", variant: "destructive" });
    } finally {
        setIsSubmitting(false);
    }
  };

  const handleOpenCleaningNotesModal = (room: HotelRoom) => {
    setSelectedRoomForCleaningNotes(room);
    cleaningNotesForm.reset({ notes: room.cleaning_notes || '' });
    setIsCleaningNotesModalOpen(true);
  };


  const handleQuickSetCleaningStatus = async (roomId: number, newStatus: string) => {
    if (!tenantId || !branchId || !staffUserId) {
      toast({ title: "Error", description: "Missing required identifiers.", variant: "destructive" });
      return;
    }
    setIsSubmittingCleaningStatusForRoomId(roomId);
    try {
      const result = await updateRoomCleaningStatus(roomId, tenantId, branchId, newStatus, staffUserId);
      if (result.success && result.updatedRoom) {
        toast({ title: "Success", description: `Room cleaning status set to ${ROOM_CLEANING_STATUS_TEXT[newStatus]}.` });
        updateRoomInLocalState({ id: roomId, cleaning_status: newStatus });
      } else {
        toast({ title: "Update Failed", description: result.message || "Could not update cleaning status.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "An unexpected error occurred.", variant: "destructive" });
    } finally {
      setIsSubmittingCleaningStatusForRoomId(null);
    }
  };

  const getRoomRateNameForCard = (room: HotelRoom) => {
    if (room.active_transaction_rate_name) { 
        return room.active_transaction_rate_name;
    }
    if (!Array.isArray(room.hotel_rate_id) || room.hotel_rate_id.length === 0) {
      return "N/A";
    }
    const firstRateId = room.hotel_rate_id[0];
    const rate = allBranchActiveRates.find(r => r.id === firstRateId);
    return rate ? rate.name : `Rate ID: ${firstRateId}`;
  };

  const cleaningStatusIcons: { [key: string]: React.ReactElement } = {
    [ROOM_CLEANING_STATUS.CLEAN]: <CheckCircle2 size={16} className="text-green-500" />,
    [ROOM_CLEANING_STATUS.DIRTY]: <XCircle size={16} className="text-red-500" />,
    [ROOM_CLEANING_STATUS.INSPECTION]: <Search size={16} className="text-yellow-500" />,
    [ROOM_CLEANING_STATUS.OUT_OF_ORDER]: <AlertTriangle size={16} className="text-orange-500" />,
  };
  
  const cleaningStatusActionButtons = [
    { status: ROOM_CLEANING_STATUS.CLEAN, icon: <CheckCircle2 size={18} />, label: "Mark Clean", variant: "ghost" as const, className:"hover:bg-green-100 dark:hover:bg-green-700 text-green-600 dark:text-green-400" },
    { status: ROOM_CLEANING_STATUS.DIRTY, icon: <XCircle size={18} />, label: "Mark Dirty", variant: "ghost" as const, className:"hover:bg-red-100 dark:hover:bg-red-700 text-red-600 dark:text-red-400" },
    { status: ROOM_CLEANING_STATUS.INSPECTION, icon: <Search size={18} />, label: "Needs Inspection", variant: "ghost" as const, className:"hover:bg-yellow-100 dark:hover:bg-yellow-700 text-yellow-600 dark:text-yellow-400" },
    { status: ROOM_CLEANING_STATUS.OUT_OF_ORDER, icon: <AlertTriangle size={18} />, label: "Out of Order", variant: "ghost" as const, className:"hover:bg-orange-100 dark:hover:bg-orange-700 text-orange-600 dark:text-orange-400" },
  ];

  const calculatedChange = useMemo(() => {
    const tender = parseFloat(String(tenderAmountWatch));
    console.log(`[CheckoutModal - useMemo] tenderAmountWatch: ${tenderAmountWatch} (coerced to ${tender}), currentBillForCheckout: ${currentBillForCheckout}`);
    if (currentBillForCheckout !== null && !isNaN(tender)) {
      const change = tender - currentBillForCheckout;
      console.log(`[CheckoutModal - useMemo] Calculated Change: ${change}`);
      return change;
    }
    return null;
  }, [tenderAmountWatch, currentBillForCheckout]);


  if (isLoading && rooms.length === 0 && allBranchActiveRates.length === 0) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2 text-muted-foreground">Loading room statuses...</p></div>;
  }
  if (!branchId && !isLoading) {
    return <Card><CardHeader><div className="flex items-center space-x-2"><BedDouble className="h-6 w-6 text-primary" /><ShadDialogTitle>Room Status</ShadDialogTitle></div><ShadCardDescription>View current room availability.</ShadCardDescription></CardHeader><CardContent><p className="text-muted-foreground">No branch assigned or selected. Please ensure your staff account is assigned to a branch.</p></CardContent></Card>;
  }
  
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <Wrench className="h-5 w-5 text-primary" />
            <CardTitle>Update Room Cleaning Status</CardTitle>
          </div>
          <ShadCardDescription className="flex justify-between items-center">
            <span>Quickly update the cleaning status for rooms.</span>
            <Button variant="ghost" size="sm" onClick={fetchRoomsAndRatesData} className="ml-4" disabled={isLoading}>
              <RefreshCw className={`mr-2 h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} /> Refresh Room List
            </Button>
          </ShadCardDescription>
        </CardHeader>
        <CardContent>
           <div className="flex items-center space-x-4 mb-4 text-xs text-muted-foreground">
            <p className="font-semibold">Legend:</p>
            {cleaningStatusActionButtons.map(btn => (
              <span key={btn.status} className="flex items-center">
                {React.cloneElement(btn.icon, {className: cn("mr-1", btn.className.replace(/hover:[^ ]+ /g, '').replace(/text-[^-]+-\d+/g, ''))})} {btn.label}
              </span>
            ))}
          </div>
          <Accordion type="multiple" defaultValue={[]} className="w-full">
            {Object.entries(groupedRooms).map(([floor, floorRooms]) => (
              <AccordionItem value={floor} key={`cleaning-floor-${floor}`} className="border bg-card rounded-md shadow-sm mb-2">
                <AccordionTrigger className="px-4 py-3 hover:no-underline text-lg">Floor: {floor.replace('Ground Floor / Other', 'Ground Floor / Unspecified')}</AccordionTrigger>
                <AccordionContent className="px-4 pb-4 pt-0">
                  <div className="space-y-2">
                    {floorRooms.filter(r => r.status === '1').map(room => (
                      <div key={`cleaning-room-${room.id}`} className="flex items-center justify-between p-2 border-b last:border-b-0 hover:bg-muted/50 rounded">
                        <div>
                          <p className="font-medium">{room.room_name} <span className="text-sm text-muted-foreground">(Room #: {room.room_code})</span></p>
                           <p className="text-xs flex items-center mb-1">
                            Current: 
                            <span className="ml-1 mr-2 flex items-center">
                               {cleaningStatusIcons[room.cleaning_status || ROOM_CLEANING_STATUS.CLEAN] || <Wrench size={14} />}
                               <span className="ml-1">{ROOM_CLEANING_STATUS_TEXT[room.cleaning_status || ROOM_CLEANING_STATUS.CLEAN]}</span>
                            </span>
                          </p>
                        </div>
                        <div className="flex space-x-1 items-center">
                           <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-primary"
                                onClick={() => handleOpenCleaningNotesModal(room)}
                                title="View/Edit Cleaning Notes"
                                disabled={isSubmittingCleaningStatusForRoomId === room.id}
                            >
                                <Edit3 className="h-4 w-4" />
                            </Button>
                          {cleaningStatusActionButtons.map(actionBtn => (
                            <Button
                              key={actionBtn.status}
                              variant={actionBtn.variant}
                              size="icon"
                              className={cn("h-8 w-8", actionBtn.className)}
                              onClick={() => handleQuickSetCleaningStatus(room.id, actionBtn.status)}
                              disabled={isSubmittingCleaningStatusForRoomId === room.id || room.cleaning_status === actionBtn.status || room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED || room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED }
                              title={room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED || room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED ? `Cannot change cleaning status: Room is ${ROOM_AVAILABILITY_STATUS_TEXT[room.is_available]}` : actionBtn.label}
                            >
                              {isSubmittingCleaningStatusForRoomId === room.id ? <Loader2 className="h-4 w-4 animate-spin" /> : actionBtn.icon}
                            </Button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>

      <Accordion type="multiple" defaultValue={[]} className="w-full space-y-1">
        {Object.entries(groupedRooms).map(([floor, floorRooms]) => {
          const availableCleanCount = floorRooms.filter(room => room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && room.status === '1' && room.cleaning_status === ROOM_CLEANING_STATUS.CLEAN).length;
          const occupiedCount = floorRooms.filter(room => room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED && room.status === '1').length;
          const reservedCount = floorRooms.filter(room => room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED && room.status === '1').length;
          const availableNotCleanCount = floorRooms.filter(room => room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && room.status === '1' && room.cleaning_status !== ROOM_CLEANING_STATUS.CLEAN && room.cleaning_status !== ROOM_CLEANING_STATUS.OUT_OF_ORDER).length;


          return (
            <AccordionItem value={floor} key={`status-floor-${floor}`} className="border bg-card rounded-md shadow-sm">
               <AccordionTrigger className={cn(
                "text-xl font-semibold px-4 py-3 hover:no-underline sticky top-0 z-10 shadow-sm bg-inherit"
              )}>
                <div className="flex justify-between items-center w-full">
                  <span>Floor: {floor.replace('Ground Floor / Other', 'Ground Floor / Unspecified')}</span>
                    <span className="text-xs font-normal ml-4 flex items-center space-x-3">
                        <span className="flex items-center text-green-600"><CheckCircle2 className="h-4 w-4 mr-1" />{availableCleanCount}</span>
                        <span className="flex items-center text-orange-600"><UserIcon className="h-4 w-4 mr-1" />{occupiedCount}</span>
                        <span className="flex items-center text-yellow-600"><CalendarClock className="h-4 w-4 mr-1" />{reservedCount}</span>
                        <span className="flex items-center text-slate-500"><Wrench className="h-4 w-4 mr-1" />{availableNotCleanCount}</span>
                    </span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4 pt-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {floorRooms.filter(r => r.status === '1').map(room => {
                    console.log(`Rendering Room Card: Name: ${room.room_name}, Available: ${room.is_available}, Cleaning: ${room.cleaning_status}, Active Tx ID: ${room.transaction_id}, Client Name: ${room.active_transaction_client_name}`);
                    let headerBgClass = "bg-card"; 
                    let headerSpecificTextColor = "text-card-foreground";
                    let statusDotClass = "bg-gray-400";
                    let statusText = ROOM_AVAILABILITY_STATUS_TEXT[room.is_available];
                    
                    if (room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE) {
                        if (room.cleaning_status === ROOM_CLEANING_STATUS.CLEAN) {
                            headerBgClass = "bg-green-500 text-white";
                            statusDotClass = "bg-green-500";
                            statusText = "Available";
                            headerSpecificTextColor = "text-white";
                        } else {
                            headerBgClass = "bg-slate-400 text-white"; 
                            statusDotClass = "bg-slate-500";
                            statusText = ROOM_CLEANING_STATUS_TEXT[room.cleaning_status || ROOM_CLEANING_STATUS.CLEAN] || "Needs Attention";
                            headerSpecificTextColor = "text-white";
                        }
                    } else if (room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED) {
                        headerBgClass = "bg-orange-500 text-white";
                        statusDotClass = "bg-orange-500";
                        headerSpecificTextColor = "text-white";
                        statusText = "Occupied";
                    } else if (room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED) {
                        headerBgClass = "bg-yellow-500 text-white"; 
                        statusDotClass = "bg-yellow-500"; 
                        headerSpecificTextColor = "text-white";
                        statusText = "Reserved";
                    }

                    return (
                      <Card
                        key={room.id}
                        className="shadow-md hover:shadow-lg transition-shadow duration-200 flex flex-col"
                      >
                        <CardHeader className={cn("p-3 rounded-t-lg relative", headerBgClass)}>
                           <div className="flex justify-between items-start">
                            <div>
                              <CardTitle className={cn("text-lg", headerSpecificTextColor)}>{room.room_name}</CardTitle>
                              <ShadCardDescription className={cn("text-xs", headerSpecificTextColor === "text-white" ? "text-white/90" : "text-muted-foreground")}>
                                Room # : {room.room_code}
                              </ShadCardDescription>
                            </div>
                            {room.transaction_id && (room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED || room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED) && (
                               <Button
                                  variant="ghost"
                                  size="icon"
                                  className={cn(
                                    "h-7 w-7 p-1 absolute top-2 right-2",
                                     headerSpecificTextColor === "text-white" ? "text-white hover:bg-white/20" : "text-muted-foreground hover:bg-accent"
                                  )}
                                  title="View Transaction Notes"
                                  onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenNotesOnlyModal(room);
                                  }}
                                >
                                  <Info className="h-4 w-4" />
                                </Button>
                             )}
                          </div>
                        </CardHeader>
                        <CardContent className="p-3 pt-2 flex-grow flex flex-col justify-between">
                          <div className="mb-3 space-y-1">
                            <div className="flex items-center space-x-2">
                                <span className={cn("h-3 w-3 rounded-full", statusDotClass, room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && room.cleaning_status === ROOM_CLEANING_STATUS.CLEAN && "animate-pulse")}></span>
                                <span className={cn("text-sm font-medium", 
                                    room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && room.cleaning_status === ROOM_CLEANING_STATUS.CLEAN ? "text-green-700 dark:text-green-300" :
                                    room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && room.cleaning_status !== ROOM_CLEANING_STATUS.CLEAN && room.cleaning_status !== ROOM_CLEANING_STATUS.OUT_OF_ORDER ? "text-slate-700 dark:text-slate-300" :
                                    room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && room.cleaning_status === ROOM_CLEANING_STATUS.OUT_OF_ORDER ? "text-red-700 dark:text-red-400" : 
                                    room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED ? "text-orange-700 dark:text-orange-300" :
                                    room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED ? "text-yellow-600 dark:text-yellow-400" : 
                                    "text-gray-600 dark:text-gray-400"
                                )}>{statusText}</span>
                            </div>

                            {room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED && room.active_transaction_client_name && (
                                <div className="flex items-center text-xs mt-1">
                                    <UserIcon className="h-3 w-3 mr-1 flex-shrink-0 text-primary" />
                                    <span className="font-medium text-foreground mr-1">Guest:</span>
                                    <span className="text-muted-foreground truncate" title={room.active_transaction_client_name}>
                                    {room.active_transaction_client_name}
                                    </span>
                                </div>
                            )}
                            {room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED && room.active_transaction_check_in_time && (
                                <p className="text-xs text-muted-foreground">
                                In: {format(parseISO(room.active_transaction_check_in_time.replace(' ', 'T')), 'yyyy-MM-dd hh:mm:ss aa')}
                                </p>
                            )}
                            {room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED && room.active_transaction_client_name && ( 
                                <div className="flex items-center text-xs mt-1">
                                    <UserIcon className="h-3 w-3 mr-1 flex-shrink-0 text-primary" />
                                    <span className="font-medium text-foreground mr-1">Client:</span>
                                    <span className="text-muted-foreground truncate" title={room.active_transaction_client_name}>
                                    {room.active_transaction_client_name}
                                    </span>
                                </div>
                            )}
                            {room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED && room.transaction_id && room.active_transaction_check_in_time && ( 
                                <p className="text-xs text-muted-foreground">
                                Reserved: {format(parseISO(room.active_transaction_check_in_time.replace(' ', 'T')), 'yyyy-MM-dd hh:mm:ss aa')}
                                </p>
                            )}
                            <div className="flex items-center text-xs mt-1">
                                <Wrench size={12} className="inline mr-1 text-muted-foreground" />
                                <span className="text-muted-foreground">{ROOM_CLEANING_STATUS_TEXT[room.cleaning_status || ROOM_CLEANING_STATUS.CLEAN]}</span>
                            </div>
                            {room.cleaning_notes && (
                                <p className="text-xs text-muted-foreground truncate" title={room.cleaning_notes}>
                                    Cleaning Note: {room.cleaning_notes.substring(0, 25)}{room.cleaning_notes.length > 25 ? "..." : ""}
                                </p>
                            )}
                          </div>

                          <div className="mt-auto pt-3 border-t">
                             <div className="flex flex-col space-y-2 w-full">
                                {room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && (
                                    <>
                                        <Button
                                            variant="default"
                                            size="sm"
                                            className="w-full"
                                            onClick={(e) => { e.stopPropagation(); handleOpenBookingDialog(room, 'book'); }}
                                            disabled={room.cleaning_status !== ROOM_CLEANING_STATUS.CLEAN}
                                            title={room.cleaning_status !== ROOM_CLEANING_STATUS.CLEAN ? `Room not clean: ${ROOM_CLEANING_STATUS_TEXT[room.cleaning_status || ROOM_CLEANING_STATUS.CLEAN]}` : "Book this room for immediate check-in"}
                                        >
                                           {(room.cleaning_status !== ROOM_CLEANING_STATUS.CLEAN) && <Ban className="mr-2 h-4 w-4" />}
                                            <LogIn className="mr-2 h-4 w-4" /> Book Room
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="w-full"
                                            onClick={(e) => { e.stopPropagation(); handleOpenBookingDialog(room, 'reserve'); }}
                                            disabled={room.cleaning_status !== ROOM_CLEANING_STATUS.CLEAN}
                                            title={room.cleaning_status !== ROOM_CLEANING_STATUS.CLEAN ? `Room not clean: ${ROOM_CLEANING_STATUS_TEXT[room.cleaning_status || ROOM_CLEANING_STATUS.CLEAN]}` : "Reserve this room"}
                                        >
                                            {(room.cleaning_status !== ROOM_CLEANING_STATUS.CLEAN) && <Ban className="mr-2 h-4 w-4" />}
                                            <CalendarPlus className="mr-2 h-4 w-4" /> Reserve Room
                                        </Button>
                                    </>
                                )}
                                {room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED && (
                                    <div className="flex flex-col space-y-2 w-full">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="w-full"
                                            title="View Transaction Details"
                                            onClick={(e) => { e.stopPropagation(); if (room.transaction_id) handleViewDetails(room); else toast({ title: "Info", description: "No transaction ID linked to this occupied room.", variant: "default" }); }}
                                        >
                                            <Info className="mr-2 h-4 w-4" /> View Details
                                        </Button>
                                        
                                        <AlertDialog 
                                            open={isCheckoutModalOpen && roomForActionConfirmation?.id === room.id && activeTransactionIdForCheckout === room.transaction_id} 
                                            onOpenChange={(open) => { if (!open && roomForActionConfirmation?.id === room.id) { setIsCheckoutModalOpen(false); setTransactionDetailsForCheckout(null); setCurrentBillForCheckout(null); setRoomForActionConfirmation(null); setActiveTransactionIdForCheckout(null); checkoutForm.reset(defaultCheckoutFormValues); }}}
                                        >
                                            <AlertDialogTrigger asChild>
                                                <Button
                                                    variant="destructive"
                                                    size="sm"
                                                    className="w-full"
                                                    title="Check-out Guest"
                                                    onClick={(e) => { e.stopPropagation(); handleOpenCheckoutConfirmation(room);}}
                                                >
                                                    <LogOutIcon className="mr-2 h-4 w-4" /> Check-out
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                                                <AlertDialogHeader>
                                                    <ShadAlertDialogTitle>Confirm Check-out: {roomForActionConfirmation?.room_name}</ShadAlertDialogTitle>
                                                    <ShadAlertDialogDescriptionFromUI>Room #: {roomForActionConfirmation?.room_code}</ShadAlertDialogDescriptionFromUI>
                                                </AlertDialogHeader>
                                                {transactionDetailsForCheckout && currentBillForCheckout !== null && (
                                                    <div className="space-y-2 text-sm">
                                                        <p><strong>Checked-in:</strong> {format(parseISO(transactionDetailsForCheckout.check_in_time.replace(' ', 'T')), 'yyyy-MM-dd hh:mm:ss aa')}</p>
                                                        <p><strong>Current Time:</strong> {currentTimeForCheckoutModal}</p>
                                                        <p><strong>Rate:</strong> {transactionDetailsForCheckout.rate_name || 'N/A'}</p>
                                                        <p className="text-lg font-semibold">Total Bill: ₱{currentBillForCheckout.toFixed(2)}</p>
                                                        
                                                        <Form {...checkoutForm}>
                                                            <form className="space-y-3 pt-3 border-t mt-3">
                                                                 <FormField
                                                                    control={checkoutForm.control}
                                                                    name="tender_amount"
                                                                    render={({ field }) => (
                                                                        <FormItem>
                                                                            <RHFFormLabel>Tender Amount *</RHFFormLabel>
                                                                            <FormControl>
                                                                                <Input
                                                                                    type="number"
                                                                                    step="0.01"
                                                                                    placeholder="0.00"
                                                                                    {...field}
                                                                                    onChange={(e) => field.onChange(e.target.value === '' ? '' : parseFloat(e.target.value))}
                                                                                    value={field.value === 0 && !checkoutForm.formState.dirtyFields.tender_amount ? '' : String(field.value)} // Ensure value is string or empty string
                                                                                    className="w-full"
                                                                                />
                                                                            </FormControl>
                                                                            <FormMessage />
                                                                        </FormItem>
                                                                    )}
                                                                />
                                                                {console.log("[CheckoutModal] Rendering. Tender watched:", tenderAmountWatch, "Bill:", currentBillForCheckout, "Type of tenderAmountWatch:", typeof tenderAmountWatch)}
                                                                {calculatedChange !== null && (
                                                                    <p className={cn("text-sm font-medium", calculatedChange < 0 ? "text-destructive" : "text-foreground")}>
                                                                        Change: ₱{calculatedChange.toFixed(2)}
                                                                    </p>
                                                                )}
                                                            </form>
                                                        </Form>
                                                    </div>
                                                )}
                                                <DialogFooter className="sm:justify-between pt-3">
                                                    <Button type="button" variant="outline" onClick={(e) => { e.stopPropagation(); setIsCheckoutModalOpen(false); }}>Cancel</Button>
                                                    <Button 
                                                        type="button" 
                                                        onClick={checkoutForm.handleSubmit(handleConfirmCheckout)}
                                                         disabled={
                                                            isSubmitting ||
                                                            currentBillForCheckout === null ||
                                                            typeof tenderAmountWatch !== 'number' || 
                                                            isNaN(tenderAmountWatch) || 
                                                            tenderAmountWatch < currentBillForCheckout
                                                          }
                                                    >
                                                        {isSubmitting ? <Loader2 className="animate-spin h-4 w-4" /> : "Confirm Check-out & Pay"}
                                                    </Button>
                                                </DialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                          
                                    </div>
                                )}
                                {room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED && (
                                    <div className="flex flex-col space-y-2 w-full">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="w-full"
                                            title="View Reservation Details"
                                            onClick={(e) => { e.stopPropagation(); if (room.transaction_id) handleViewDetails(room); else toast({title: "Info", description:"No linked transaction to view for this reserved room.", variant:"default"}); }}
                                        >
                                            <Info className="mr-2 h-4 w-4" /> View Details
                                        </Button>
                                         <AlertDialog 
                                            open={isCheckInReservedConfirmOpen && roomForActionConfirmation?.id === room.id && activeTransactionIdForAction === room.transaction_id} 
                                            onOpenChange={(open) => { if (!open && roomForActionConfirmation?.id === room.id) { setIsCheckInReservedConfirmOpen(false); setRoomForActionConfirmation(null); setActiveTransactionIdForAction(null); }  }}
                                        >
                                            <AlertDialogTrigger asChild>
                                                <Button
                                                    variant="default"
                                                    size="sm"
                                                    className="w-full"
                                                    title="Check-in Reserved Guest"
                                                    disabled={room.cleaning_status !== ROOM_CLEANING_STATUS.CLEAN}
                                                    onClick={(e) => { e.stopPropagation(); if (room.transaction_id) handleOpenCheckInReservedConfirmation(room); }}
                                                >
                                                    {(room.cleaning_status !== ROOM_CLEANING_STATUS.CLEAN) && <Ban className="mr-2 h-4 w-4" />}
                                                    <LogIn className="mr-2 h-4 w-4" /> Check-in Reserved
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                                                <AlertDialogHeader>
                                                    <ShadAlertDialogTitle>Confirm Reserved Check-in</ShadAlertDialogTitle>
                                                    <ShadAlertDialogDescriptionFromUI>
                                                        Are you sure you want to check-in the guest for room {roomForActionConfirmation?.room_name}? This will update the reservation to an active booking.
                                                    </ShadAlertDialogDescriptionFromUI>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel onClick={(e) => { e.stopPropagation(); setIsCheckInReservedConfirmOpen(false); setRoomForActionConfirmation(null); setActiveTransactionIdForAction(null); }}>Cancel</AlertDialogCancel>
                                                    <AlertDialogAction onClick={(e) => { e.stopPropagation(); handleConfirmCheckInReservedGuest(); }} disabled={isSubmitting}>
                                                        {isSubmitting ? <Loader2 className="animate-spin" /> : "Confirm Check-in"}
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                        <AlertDialog 
                                            open={isCancelReservationConfirmOpen && roomForActionConfirmation?.id === room.id && activeTransactionIdForAction === room.transaction_id} 
                                            onOpenChange={(open) => { if (!open && roomForActionConfirmation?.id === room.id) { setIsCancelReservationConfirmOpen(false); setRoomForActionConfirmation(null); setActiveTransactionIdForAction(null); } }}
                                        >
                                            <AlertDialogTrigger asChild>
                                                <Button
                                                    variant="destructive"
                                                    size="sm"
                                                    className="w-full"
                                                    title="Cancel this Reservation"
                                                    onClick={(e) => { e.stopPropagation(); if (room.transaction_id) handleOpenCancelReservationConfirmation(room); }}
                                                >
                                                    <Ban className="mr-2 h-4 w-4" /> Cancel Reservation
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                                                <AlertDialogHeader>
                                                    <ShadAlertDialogTitle>Confirm Cancellation</ShadAlertDialogTitle>
                                                    <ShadAlertDialogDescriptionFromUI>
                                                        Are you sure you want to cancel the reservation for room {roomForActionConfirmation?.room_name || ' (unassigned)'}?
                                                    </ShadAlertDialogDescriptionFromUI>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel onClick={(e) => { e.stopPropagation(); setIsCancelReservationConfirmOpen(false); setRoomForActionConfirmation(null); setActiveTransactionIdForAction(null); }}>No</AlertDialogCancel>
                                                    <AlertDialogAction onClick={(e) => { e.stopPropagation(); handleConfirmCancelReservation(); }} disabled={isSubmitting}>
                                                        {isSubmitting ? <Loader2 className="animate-spin" /> : "Yes, Cancel"}
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </div>
                                )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              </AccordionContent>
            </AccordionItem>
          )
        })}
      </Accordion>

      {/* Booking/Reservation Dialog */}
      <Dialog open={isBookingDialogOpen} onOpenChange={(isOpen) => {
          if (!isOpen) {
            setSelectedRoomForBooking(null);
            setBookingMode(null);
            bookingForm.reset(defaultBookingFormValues);
            setApplicableRatesForBookingDialog([]);
          }
          setIsBookingDialogOpen(isOpen);
      }}>
        <DialogContent className="sm:max-w-md p-1 flex flex-col max-h-[85vh]">
          <DialogHeader className="p-2 border-b">
            <ShadDialogTitle>
                {bookingMode === 'book' ? `Book Room: ${selectedRoomForBooking?.room_name} (${selectedRoomForBooking?.room_code})` :
                 bookingMode === 'reserve' ? `Reserve Room: ${selectedRoomForBooking?.room_name} (${selectedRoomForBooking?.room_code})` :
                 'Room Action'}
            </ShadDialogTitle>
          </DialogHeader>
          <Form {...bookingForm}>
            <form onSubmit={bookingForm.handleSubmit(handleBookingSubmit)} className="flex flex-col flex-grow overflow-hidden bg-card rounded-md">
              <div className="flex-grow space-y-3 p-1 overflow-y-auto">
                <FormField control={bookingForm.control} name="client_name" render={({ field }) => (
                  <FormItem><RHFFormLabel>Client Name *</RHFFormLabel><FormControl><Input placeholder="John Doe" {...field} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={bookingForm.control} name="selected_rate_id" render={({ field }) => (
                  <FormItem>
                      <RHFFormLabel>Select Rate *</RHFFormLabel>
                      <Select
                          onValueChange={(value) => field.onChange(value ? parseInt(value, 10) : undefined)}
                          value={field.value?.toString()}
                          disabled={applicableRatesForBookingDialog.length === 0}
                      >
                          <FormControl>
                              <SelectTrigger className="w-[90%]">
                                  <SelectValue placeholder={ applicableRatesForBookingDialog.length === 0 ? "No rates for this room" : "Select a rate"} />
                              </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                              {applicableRatesForBookingDialog.map(rate => (
                                  <SelectItem key={rate.id} value={rate.id.toString()}>
                                      {rate.name} (₱{Number(rate.price).toFixed(2)} for {rate.hours}hr/s)
                                  </SelectItem>
                              ))}
                          </SelectContent>
                      </Select>
                      <FormMessage />
                  </FormItem>
                )} />
                <FormField control={bookingForm.control} name="client_payment_method" render={({ field }) => (
                  <FormItem><RHFFormLabel>Payment Method *</RHFFormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? undefined} defaultValue="Cash">
                      <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder="Select payment method" /></SelectTrigger></FormControl>
                      <SelectContent>
                          <SelectItem value="Cash">Cash</SelectItem>
                          <SelectItem value="Card">Card</SelectItem>
                          <SelectItem value="Online Payment">Online Payment</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select><FormMessage />
                  </FormItem>
                )} />
                <FormField control={bookingForm.control} name="notes" render={({ field }) => (
                  <FormItem><RHFFormLabel>Notes (Optional)</RHFFormLabel><FormControl><Textarea placeholder="Any special requests or notes..." {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <DialogFooter className="bg-card py-2 border-t px-3 sticky bottom-0 z-10">
                <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                <Button type="submit" disabled={isSubmitting || applicableRatesForBookingDialog.length === 0 || !bookingForm.formState.isValid}>
                    {isSubmitting ? <Loader2 className="animate-spin" /> : (bookingMode === 'book' ? "Confirm Booking" : "Confirm Reservation")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Transaction Details / Edit Notes / Edit Reservation Dialog */}
      <Dialog open={isTransactionDetailsDialogOpen} onOpenChange={(open) => {
          if (!open) {
              setIsTransactionDetailsDialogOpen(false);
              setTransactionDetails(null);
              setEditingModeForDialog(null);
              setIsEditNotesMode(false);
              notesEditForm.reset(defaultNotesEditFormValues);
              reservationEditForm.reset(defaultReservationEditFormValues);
          } else {
              setIsTransactionDetailsDialogOpen(open);
          }
      }}>
        <DialogContent className="sm:max-w-md p-3">
          <DialogHeader>
            <ShadDialogTitle>Transaction Details</ShadDialogTitle>
            {transactionDetails?.room_name && <ShadDialogDescriptionAliased>Room: {transactionDetails.room_name} ({transactionDetails.rate_name || 'Rate N/A'})</ShadDialogDescriptionAliased>}
          </DialogHeader>
          {transactionDetails ? (
            <div className="space-y-3 text-sm py-2">
              <p><strong>Status:</strong> {TRANSACTION_STATUS_TEXT[transactionDetails.status as keyof typeof TRANSACTION_STATUS_TEXT] || 'Unknown'}</p>
              {transactionDetails.check_in_time && (<p><strong>Checked-in/Reserved On:</strong> {format(parseISO(transactionDetails.check_in_time.replace(' ', 'T')), 'yyyy-MM-dd hh:mm:ss aa')}</p>)}
              {transactionDetails.reserved_check_in_datetime && (<p><strong>Expected Check-in:</strong> {format(parseISO(transactionDetails.reserved_check_in_datetime.replace(' ', 'T')), 'yyyy-MM-dd hh:mm:ss aa')}</p>)}
              {transactionDetails.check_out_time && (<p><strong>Check-out:</strong> {format(parseISO(transactionDetails.check_out_time.replace(' ', 'T')), 'yyyy-MM-dd hh:mm:ss aa')}</p>)}
              {transactionDetails.hours_used !== undefined && transactionDetails.hours_used !== null && (<p><strong>Hours Used:</strong> {transactionDetails.hours_used}</p>)}
              {transactionDetails.total_amount !== undefined && transactionDetails.total_amount !== null && (<p><strong>Total Amount:</strong> ₱{Number(transactionDetails.total_amount).toFixed(2)}</p>)}

              {editingModeForDialog === 'fullReservation' ? (
                <Form {...reservationEditForm}>
                  <form onSubmit={reservationEditForm.handleSubmit(data => handleReservationEditSubmit(data as z.infer<typeof transactionReservedUpdateSchema>))} className="space-y-3 pt-3 border-t mt-3">
                    <FormField control={reservationEditForm.control} name="client_name" render={({ field }) => (
                      <FormItem><RHFFormLabel>Client Name *</RHFFormLabel><FormControl><Input {...field} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={reservationEditForm.control} name="client_payment_method" render={({ field }) => (
                      <FormItem><RHFFormLabel>Payment Method</RHFFormLabel>
                        <Select onValueChange={field.onChange} value={field.value ?? undefined} >
                          <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder="Select payment method" /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="Cash">Cash</SelectItem><SelectItem value="Card">Card</SelectItem>
                            <SelectItem value="Online Payment">Online Payment</SelectItem><SelectItem value="Other">Other</SelectItem>
                          </SelectContent>
                        </Select><FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={reservationEditForm.control} name="notes" render={({ field }) => ( 
                      <FormItem><RHFFormLabel>Notes</RHFFormLabel><FormControl><Textarea {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
                    )} />
                     <div className="flex justify-end space-x-2 pt-2">
                        <Button type="submit" size="sm" disabled={isSubmitting || !reservationEditForm.formState.isValid}>
                            {isSubmitting ? <Loader2 className="animate-spin h-3 w-3" /> : "Save Reservation Changes"}
                        </Button>
                         <Button type="button" variant="outline" size="sm" onClick={() => { setEditingModeForDialog(null); reservationEditForm.reset(defaultReservationEditFormValues); notesEditForm.reset({ notes: transactionDetails.notes || ''}); setIsEditNotesMode(false); }}>Cancel Edit</Button>
                    </div>
                  </form>
                </Form>
              ) : (
                 <div className="pt-3 border-t mt-3 space-y-1">
                    <p><strong>Client:</strong> {transactionDetails.client_name}</p>
                    <p><strong>Payment Method:</strong> {transactionDetails.client_payment_method || 'N/A'}</p>
                    <div className="flex justify-between items-center">
                        {isEditNotesMode ? null : <Label>Notes:</Label>}
                        {!isEditNotesMode && (transactionDetails.status === TRANSACTION_STATUS.UNPAID || transactionDetails.status === TRANSACTION_STATUS.ADVANCE_PAID || transactionDetails.status === TRANSACTION_STATUS.ADVANCE_RESERVATION) && (
                            <Button variant="ghost" size="sm" onClick={() => setIsEditNotesMode(true)}><Edit3 className="h-3 w-3 mr-1" /> Edit Notes</Button>
                        )}
                    </div>
                    {isEditNotesMode ? (
                         <Form {...notesEditForm}>
                            <form onSubmit={notesEditForm.handleSubmit(data => handleUpdateTransactionDetails(data))} className="space-y-3">
                                <FormField control={notesEditForm.control} name="notes" render={({ field }) => (
                                <FormItem><RHFFormLabel className="sr-only">Notes</RHFFormLabel><FormControl><Textarea {...field} value={field.value ?? ''} className="w-full" rows={3} /></FormControl><FormMessage /></FormItem>
                                )} />
                                <div className="flex justify-end space-x-2">
                                    <Button type="submit" size="sm" disabled={isSubmitting || !notesEditForm.formState.isValid}>
                                        {isSubmitting ? <Loader2 className="animate-spin h-3 w-3" /> : "Save Notes"}
                                    </Button>
                                    <Button type="button" variant="outline" size="sm" onClick={() => setIsEditNotesMode(false)}>Cancel</Button>
                                </div>
                            </form>
                        </Form>
                    ) : (
                        <p className="text-muted-foreground whitespace-pre-wrap min-h-[40px] p-2 border rounded-md bg-accent/10">
                            {transactionDetails.notes || "No notes yet."}
                        </p>
                    )}
                 </div>
              )}

            </div>
          ) : <p className="py-4">Loading details or no active transaction...</p>}
          <DialogFooter className="pt-4 flex flex-row justify-end space-x-2">
             {transactionDetails && (transactionDetails.status === TRANSACTION_STATUS.ADVANCE_PAID || transactionDetails.status === TRANSACTION_STATUS.ADVANCE_RESERVATION) && editingModeForDialog !== 'fullReservation' && editingModeForDialog !== 'notesOnly' && (
                 <AlertDialog
                    open={isCancelReservationConfirmOpen && activeTransactionIdForAction === transactionDetails.id}
                    onOpenChange={(open) => {
                        if (!open && activeTransactionIdForAction === transactionDetails.id) {
                            setIsCancelReservationConfirmOpen(false);
                            const originalRoom = rooms.find(r => r.transaction_id === transactionDetails.id);
                            setRoomForActionConfirmation(originalRoom || null);
                        } else if(open && transactionDetails?.id){
                            const originalRoom = rooms.find(r => r.transaction_id === transactionDetails.id);
                            setRoomForActionConfirmation(originalRoom || null);
                            setActiveTransactionIdForAction(transactionDetails.id);
                            setIsCancelReservationConfirmOpen(true);
                        }
                    }}
                >
                    <AlertDialogTrigger asChild>
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={(e) => { e.stopPropagation();
                                const originalRoom = rooms.find(r => r.transaction_id === transactionDetails.id);
                                if (transactionDetails.id && originalRoom) {
                                    setRoomForActionConfirmation(originalRoom); 
                                    setActiveTransactionIdForAction(transactionDetails.id);
                                    setIsCancelReservationConfirmOpen(true);
                                } else {
                                    toast({title: "Error", description: "Could not find transaction or room for cancellation.", variant: "destructive"});
                                }
                            }}
                            disabled={isSubmitting}
                        >
                            <Ban className="mr-2 h-4 w-4" /> Cancel Reservation
                        </Button>
                    </AlertDialogTrigger>
                     <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                        <AlertDialogHeader>
                            <ShadAlertDialogTitle>Confirm Cancellation</ShadAlertDialogTitle>
                            <ShadAlertDialogDescriptionFromUI>
                                Are you sure you want to cancel this reservation for room {roomForActionConfirmation?.room_name || ' (unassigned)'}?
                            </ShadAlertDialogDescriptionFromUI>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel onClick={(e) => { e.stopPropagation(); setIsCancelReservationConfirmOpen(false); setRoomForActionConfirmation(null); setActiveTransactionIdForAction(null); }}>No</AlertDialogCancel>
                            <AlertDialogAction onClick={(e) => { e.stopPropagation(); handleConfirmCancelReservation(); }} disabled={isSubmitting}>
                                {isSubmitting ? <Loader2 className="animate-spin" /> : "Yes, Cancel"}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}
            <DialogClose asChild><Button variant="outline" onClick={() => {
              setIsTransactionDetailsDialogOpen(false);
              setTransactionDetails(null);
              setEditingModeForDialog(null);
              setIsEditNotesMode(false);
              notesEditForm.reset(defaultNotesEditFormValues);
              reservationEditForm.reset(defaultReservationEditFormValues);
            }}>Close</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Checkout Confirmation Dialog */}
      <Dialog open={isCheckoutModalOpen} onOpenChange={(open) => {
        if (!open) {
            setIsCheckoutModalOpen(false);
            setTransactionDetailsForCheckout(null);
            setCurrentBillForCheckout(null);
            setRoomForActionConfirmation(null);
            setActiveTransactionIdForCheckout(null);
            checkoutForm.reset(defaultCheckoutFormValues);
        }
      }}>
        <DialogContent className="sm:max-w-md p-3">
            <DialogHeader className="border-b pb-2 mb-2">
                <ShadDialogTitle>Confirm Check-out: {roomForActionConfirmation?.room_name}</ShadDialogTitle>
                <ShadDialogDescriptionAliased>Room #: {roomForActionConfirmation?.room_code}</ShadDialogDescriptionAliased>
            </DialogHeader>
            {transactionDetailsForCheckout && currentBillForCheckout !== null && (
                <div className="space-y-2 text-sm">
                    <p><strong>Checked-in:</strong> {format(parseISO(transactionDetailsForCheckout.check_in_time.replace(' ', 'T')), 'yyyy-MM-dd hh:mm:ss aa')}</p>
                    <p><strong>Current Time:</strong> {currentTimeForCheckoutModal}</p>
                    <p><strong>Rate:</strong> {transactionDetailsForCheckout.rate_name || 'N/A'}</p>
                    <p className="text-lg font-semibold">Total Bill: ₱{currentBillForCheckout.toFixed(2)}</p>
                    
                    <Form {...checkoutForm}>
                        <form className="space-y-3 pt-3 border-t mt-3">
                             <FormField
                                control={checkoutForm.control}
                                name="tender_amount"
                                render={({ field }) => (
                                    <FormItem>
                                        <RHFFormLabel>Tender Amount *</RHFFormLabel>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                step="0.01"
                                                placeholder="0.00"
                                                {...field}
                                                onChange={(e) => field.onChange(e.target.value)} 
                                                value={field.value === 0 && !checkoutForm.formState.dirtyFields.tender_amount ? '' : String(field.value)}
                                                className="w-full"
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            {console.log("[CheckoutModal] Rendering. Tender watched:", tenderAmountWatch, "Bill:", currentBillForCheckout, "Type of tenderAmountWatch:", typeof tenderAmountWatch, "Tender >= Bill:", parseFloat(String(tenderAmountWatch)) >= (currentBillForCheckout ?? Infinity) )}
                            {calculatedChange !== null && (
                                <p className={cn("text-sm font-medium", calculatedChange < 0 ? "text-destructive" : "text-foreground")}>
                                    Change: ₱{calculatedChange.toFixed(2)}
                                </p>
                            )}
                            <DialogFooter className="sm:justify-between pt-3">
                                <Button type="button" variant="outline" onClick={(e) => { e.stopPropagation(); setIsCheckoutModalOpen(false); }}>Cancel</Button>
                                <Button 
                                    type="button" 
                                    onClick={checkoutForm.handleSubmit(handleConfirmCheckout)}
                                     disabled={
                                        isSubmitting ||
                                        currentBillForCheckout === null ||
                                        typeof tenderAmountWatch !== 'number' || 
                                        isNaN(tenderAmountWatch) || 
                                        tenderAmountWatch < currentBillForCheckout
                                      }
                                >
                                    {isSubmitting ? <Loader2 className="animate-spin h-4 w-4" /> : "Confirm Check-out & Pay"}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </div>
            )}
        </DialogContent>
      </Dialog>


      {/* Notes Only Modal (triggered by info icon in card header) */}
      <Dialog open={isNotesOnlyModalOpen} onOpenChange={setIsNotesOnlyModalOpen}>
        <DialogContent className="sm:max-w-md p-3">
          <DialogHeader className="border-b pb-2 mb-2">
            <ShadDialogTitle>Transaction Notes</ShadDialogTitle>
             <ShadDialogDescriptionAliased className="text-sm text-muted-foreground">Room: { rooms.find(r => r.id === (selectedRoomForCleaningNotes?.id || transactionDetails?.hotel_room_id))?.room_name || 'N/A'}</ShadDialogDescriptionAliased>
          </DialogHeader>
          <div className="py-4 text-sm text-muted-foreground whitespace-pre-wrap min-h-[100px] max-h-[300px] overflow-y-auto border p-2 rounded-md">
            {currentNotesForDisplay || "No notes available."}
          </div>
          <DialogFooter className="sm:justify-end">
            <Button variant="outline" onClick={() => setIsNotesOnlyModalOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

       {/* Cleaning Notes Modal */}
       <Dialog open={isCleaningNotesModalOpen} onOpenChange={(isOpen) => {
            if (!isOpen) {
                setSelectedRoomForCleaningNotes(null);
                cleaningNotesForm.reset({ notes: '' });
            }
             setIsCleaningNotesModalOpen(isOpen);
        }}>
            <DialogContent className="sm:max-w-md p-3">
                <DialogHeader className="border-b pb-2 mb-2">
                    <ShadDialogTitle>
                        Cleaning Notes for Room: {selectedRoomForCleaningNotes?.room_name}
                    </ShadDialogTitle>
                    <ShadDialogDescriptionAliased className="text-sm text-muted-foreground">
                       Current Status: {ROOM_CLEANING_STATUS_TEXT[selectedRoomForCleaningNotes?.cleaning_status || ROOM_CLEANING_STATUS.CLEAN]}
                    </ShadDialogDescriptionAliased>
                </DialogHeader>

                <Form {...cleaningNotesForm}>
                    <form onSubmit={cleaningNotesForm.handleSubmit(handleSaveRoomCleaningNotes)} className="space-y-4 py-2">
                        <FormField control={cleaningNotesForm.control} name="notes" render={({ field }) => (
                            <FormItem>
                                <RHFFormLabel>Note</RHFFormLabel>
                                <FormControl><Textarea placeholder="Add cleaning notes..." {...field} value={field.value ?? ''} rows={5} /></FormControl>
                                <FormMessage />
                            </FormItem>
                        )} />
                        <DialogFooter className="sm:justify-start">
                             <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin mr-2" size={16} /> : null} Save Note</Button>
                             <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>

      {/* Available Rooms Overview Modal */}
      <Dialog open={showAvailableRoomsOverview} onOpenChange={onCloseAvailableRoomsOverview}>
        <DialogContent className="sm:max-w-2xl md:max-w-3xl lg:max-w-4xl p-0 flex flex-col max-h-[90vh] overflow-hidden">
          <DialogHeader className="p-3 border-b">
            <ShadDialogTitle className="flex items-center">
                <Eye className="mr-2 h-5 w-5 text-primary" /> Available Rooms Overview
            </ShadDialogTitle>
          </DialogHeader>

          <div className="flex-grow overflow-y-auto p-4">
            {isLoading ? (
              <div className="flex justify-center items-center h-32">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="ml-2">Loading rooms...</p>
              </div>
            ) : rooms.filter(r => r.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && r.status === '1' && r.cleaning_status === ROOM_CLEANING_STATUS.CLEAN).length === 0 ? (
              <p className="text-center text-muted-foreground py-10">No rooms are currently available and clean.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {rooms
                  .filter(r => r.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && r.status === '1' && r.cleaning_status === ROOM_CLEANING_STATUS.CLEAN)
                  .sort((a, b) => (a.room_code || "").localeCompare(b.room_code || ""))
                  .map(room => (
                    <Card key={`avail-overview-${room.id}`} className="shadow-sm bg-card">
                       <CardHeader className={cn("p-3 rounded-t-lg", "bg-green-500 text-white")}>
                         <CardTitle className="text-md truncate">{room.room_name}</CardTitle>
                         <ShadCardDescription className="text-xs text-white/80">Room # : {room.room_code}</ShadCardDescription>
                      </CardHeader>
                      <CardContent className="p-3 text-sm">
                        <p>Floor: {room.floor ?? 'N/A'}</p>
                        <p>Type: {room.room_type || 'N/A'}</p>
                        <p>Bed: {room.bed_type || 'N/A'}</p>
                        <div className="flex items-center text-xs mt-1">
                            <Wrench size={12} className="inline mr-1 text-muted-foreground" />
                            <span className="text-muted-foreground">{ROOM_CLEANING_STATUS_TEXT[room.cleaning_status || ROOM_CLEANING_STATUS.CLEAN]}</span>
                        </div>
                         <Button
                          variant="outline"
                          size="sm"
                          className="w-full mt-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedRoomForRatesDisplay(room);
                            setIsRoomRatesDetailModalOpen(true);
                          }}
                        >
                          <Tags className="mr-2 h-4 w-4" /> View Associated Rates
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
              </div>
            )}
          </div>

          <DialogFooter className="bg-card py-3 border-t px-4 sm:justify-end">
            <Button variant="outline" onClick={onCloseAvailableRoomsOverview}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Room-Specific Rates Detail Modal */}
      <Dialog open={isRoomRatesDetailModalOpen} onOpenChange={(open) => {
        if (!open) {
            setSelectedRoomForRatesDisplay(null);
        }
        setIsRoomRatesDetailModalOpen(open);
      }}>
        <DialogContent className="sm:max-w-md p-3">
            <DialogHeader className="border-b pb-2 mb-2">
                 <ShadDialogTitle>Rates for Room: {selectedRoomForRatesDisplay?.room_name}</ShadDialogTitle>
                 <ShadDialogDescriptionAliased className="text-sm text-muted-foreground">Room #: {selectedRoomForRatesDisplay?.room_code}</ShadDialogDescriptionAliased>
            </DialogHeader>
            <div className="py-4 max-h-[60vh] overflow-y-auto">
                {selectedRoomForRatesDisplay && Array.isArray(selectedRoomForRatesDisplay.hotel_rate_id) && selectedRoomForRatesDisplay.hotel_rate_id.length > 0 ? (
                    (() => {
                        const applicableRates = allBranchActiveRates
                            .filter(rate => selectedRoomForRatesDisplay.hotel_rate_id!.includes(rate.id))
                            .sort((a, b) => a.name.localeCompare(b.name));

                        if (applicableRates.length > 0) {
                            return (
                                <div className="space-y-2">
                                    {applicableRates.map(rate => (
                                        <div key={rate.id} className="bg-muted/30 rounded p-2 border-b last:border-b-0 text-sm">
                                            <p className="font-medium">{rate.name}</p>
                                            <p className="text-xs text-muted-foreground">
                                                Price: ₱{Number(rate.price).toFixed(2)} | Hours: {rate.hours}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            );
                        }
                        return <p className="text-muted-foreground">No active rates currently assigned or found for this room.</p>;
                    })()
                ) : (
                    <p className="text-muted-foreground">No rates assigned to this room.</p>
                )}
            </div>
            <DialogFooter className="sm:justify-end">
                <Button variant="outline" onClick={() => { setIsRoomRatesDetailModalOpen(false); setSelectedRoomForRatesDisplay(null); }}>Close</Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

