
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription as ShadCardDescription, // Aliased import
} from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle as ShadDialogTitle, // Aliased import
  DialogFooter,
  DialogClose,
  DialogDescription as ShadDialogDescription, // Aliased import
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription as ShadAlertDialogDescription, // Aliased import
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle as ShadAlertDialogTitle, // Aliased import
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel as RHFFormLabel, FormMessage } from '@/components/ui/form';
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BedDouble, Loader2, Info, User as UserIcon, LogOutIcon, LogIn, CalendarClock, Edit3, Ban, CheckCircle2, CalendarPlus, Tags, Eye, X, Wrench, Search, AlertTriangle, XCircle, RefreshCw } from "lucide-react";
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
} from '@/actions/staff';
import { transactionCreateSchema, TransactionCreateData, transactionUpdateNotesSchema, TransactionUpdateNotesData, transactionReservedUpdateSchema, checkoutFormSchema, roomCleaningStatusAndNotesUpdateSchema } from '@/lib/schemas';
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
  ROOM_CLEANING_STATUS_OPTIONS,
  TRANSACTION_IS_PAID_STATUS,
  TRANSACTION_IS_PAID_STATUS_TEXT
} from '@/lib/constants';
import { format, parseISO, addHours, differenceInMilliseconds } from 'date-fns';
import type { z } from 'zod';

const defaultBookingFormValues: TransactionCreateData = {
  client_name: '',
  selected_rate_id: undefined,
  client_payment_method: 'Cash',
  notes: '',
  is_paid: false,
  tender_amount_at_checkin: null,
};

const defaultNotesEditFormValues: TransactionUpdateNotesData = {
  notes: '',
};

const defaultReservationEditFormValues: z.infer<typeof transactionReservedUpdateSchema> = {
  client_name: '',
  selected_rate_id: undefined,
  client_payment_method: undefined,
  notes: '',
};

const defaultCheckoutFormValues: CheckoutFormData = {
    tender_amount: 0,
};

const defaultCleaningUpdateFormValues: RoomCleaningStatusUpdateData = {
    cleaning_status: ROOM_CLEANING_STATUS.CLEAN,
    cleaning_notes: '',
};


interface RoomStatusContentProps {
  tenantId: number | null;
  branchId: number | null;
  staffUserId: number | null;
  showAvailableRoomsOverview: boolean;
  onCloseAvailableRoomsOverview: () => void;
}

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
  const [isEditNotesMode, setIsEditNotesMode] = useState(false); // New state for notes editing mode
  
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
  const [displayHoursUsedForCheckoutModal, setDisplayHoursUsedForCheckoutModal] = useState<string>('N/A');

  const [isCleaningUpdateModalOpen, setIsCleaningUpdateModalOpen] = useState(false);
  const [selectedRoomForCleaningUpdate, setSelectedRoomForCleaningUpdate] = useState<HotelRoom | null>(null);
  const [targetCleaningStatusForModal, setTargetCleaningStatusForModal] = useState<string | null>(null);
  const [isSubmittingCleaningStatus, setIsSubmittingCleaningStatus] = useState(false);
  
  const [isNotesOnlyModalOpen, setIsNotesOnlyModalOpen] = useState(false);
  const [currentNotesForDisplay, setCurrentNotesForDisplay] = useState<string | null>(null);
  
  const [isRoomRatesDetailModalOpen, setIsRoomRatesDetailModalOpen] = useState(false);
  const [selectedRoomForRatesDisplay, setSelectedRoomForRatesDisplay] = useState<HotelRoom | null>(null);

  const [isLoadingRooms, setIsLoadingRooms] = useState(true);
  const [isLoadingRates, setIsLoadingRates] = useState(true);
  const [defaultOpenFloors, setDefaultOpenFloors] = useState<string[]>([]);
  const [activeCleaningTab, setActiveCleaningTab] = useState<string>(ROOM_CLEANING_STATUS.DIRTY);


  const { toast } = useToast();

  const bookingForm = useForm<TransactionCreateData>({
    resolver: zodResolver(transactionCreateSchema),
    defaultValues: defaultBookingFormValues,
  });
  const watchIsPaidInBookingForm = useWatch({ control: bookingForm.control, name: 'is_paid' });

  const notesForm = useForm<TransactionUpdateNotesData>({ // Renamed to notesForm
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

  const cleaningUpdateForm = useForm<RoomCleaningStatusUpdateData>({
    resolver: zodResolver(roomCleaningStatusAndNotesUpdateSchema),
    defaultValues: defaultCleaningUpdateFormValues,
  });
  const watchCleaningStatusInModal = useWatch({ control: cleaningUpdateForm.control, name: 'cleaning_status'});


  const updateRoomInLocalState = useCallback((updatedRoomPartial: Partial<HotelRoom> & { id: number }) => {
    console.log("[RoomStatusContent] Updating local state for room:", updatedRoomPartial.id, updatedRoomPartial);
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
      const finalSortedGroupedRooms: GroupedRooms = {};
      for (const floor of sortedFloors) finalSortedGroupedRooms[floor] = newGrouped[floor];
      setGroupedRooms(finalSortedGroupedRooms);
      return newRooms;
    });
  }, []);


  const fetchRoomsAndRatesData = useCallback(async () => {
    if (!tenantId || !branchId) {
      setIsLoading(false);
      setIsLoadingRooms(false);
      setIsLoadingRates(false);
      setRooms([]);
      setGroupedRooms({});
      setAllBranchActiveRates([]);
      return;
    }
    setIsLoading(true);
    setIsLoadingRooms(true);
    setIsLoadingRates(true);
    console.log("[RoomStatusContent] Fetching rooms and rates...");
    try {
      const [fetchedRooms, fetchedBranchRates] = await Promise.all([
        listRoomsForBranch(branchId, tenantId),
        getRatesForBranchSimple(tenantId, branchId) 
      ]);
      console.log("[RoomStatusContent] Fetched rooms:", fetchedRooms.length, "Fetched rates:", fetchedBranchRates.length);
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
      const finalSortedGroupedRooms: GroupedRooms = {};
      for (const floor of sortedFloors) finalSortedGroupedRooms[floor] = grouped[floor];
      setGroupedRooms(finalSortedGroupedRooms);
      setDefaultOpenFloors([]); 
    
    } catch (error) {
      console.error("Error fetching room/rate data:", error);
      toast({ title: "Error", description: `Could not fetch room statuses or rates. ${error instanceof Error ? error.message : ''}`, variant: "destructive" });
    } finally {
      setIsLoading(false);
      setIsLoadingRooms(false);
      setIsLoadingRates(false);
    }
  }, [tenantId, branchId, toast]);

  useEffect(() => {
    fetchRoomsAndRatesData();
  }, [fetchRoomsAndRatesData]);

  const handleOpenBookingDialog = (room: HotelRoom, mode: 'book' | 'reserve') => {
    console.log(`[RoomStatusContent] Opening booking dialog for room: ${room.room_name}, mode: ${mode}`);
    if (!tenantId || !branchId) {
      toast({ title: "Error", description: "Tenant or branch information missing.", variant: "destructive" });
      return;
    }
     if (room.is_available !== ROOM_AVAILABILITY_STATUS.AVAILABLE || room.cleaning_status !== ROOM_CLEANING_STATUS.CLEAN) {
        let reason = "";
        if(room.is_available !== ROOM_AVAILABILITY_STATUS.AVAILABLE) reason = `Room not available (Status: ${ROOM_AVAILABILITY_STATUS_TEXT[room.is_available]})`;
        else if (room.cleaning_status !== ROOM_CLEANING_STATUS.CLEAN) reason = `Room not clean (Status: ${ROOM_CLEANING_STATUS_TEXT[room.cleaning_status || 'N/A']})`;
        toast({ title: `Cannot ${mode}`, description: reason, variant: "default" });
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
    console.log("[RoomStatusContent] handleBookingSubmit called with data:", data, "Selected room:", selectedRoomForBooking, "Staff ID:", staffUserId, "Booking Mode:", bookingMode);
     if (!selectedRoomForBooking || !staffUserId || !tenantId || !branchId || !data.selected_rate_id || !bookingMode) {
        toast({ title: "Submission Error", description: `Booking details incomplete. Room: ${!!selectedRoomForBooking}, Staff: ${!!staffUserId}, Rate: ${!!data.selected_rate_id}, Mode: ${!!bookingMode}`, variant: "destructive" });
        return;
    }
    setIsSubmitting(true);
    try {
      let result;
      const apiData = { ...data, selected_rate_id: Number(data.selected_rate_id) }; 
      if (bookingMode === 'book') {
        result = await createTransactionAndOccupyRoom( apiData, tenantId, branchId, selectedRoomForBooking.id, apiData.selected_rate_id, staffUserId );
      } else if (bookingMode === 'reserve') {
         result = await createReservation( apiData, tenantId, branchId, selectedRoomForBooking.id, apiData.selected_rate_id, staffUserId );
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
      console.error(`Error during ${bookingMode}:`, error);
      toast({ title: "Error", description: `An unexpected error occurred during ${bookingMode}. ${error instanceof Error ? error.message : ''}`, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleViewDetails = useCallback(async (room: HotelRoom) => {
    if (!tenantId || !branchId) { toast({ title: "Error", description: "Tenant or branch ID missing.", variant: "destructive" }); return; }
    if (!room.transaction_id) { toast({ title: "Info", description: "No active transaction linked to this room.", variant: "default" }); return; }
    
    setIsSubmitting(true); 
    console.log(`[RoomStatusContent] Fetching transaction details for Transaction ID: ${room.transaction_id}`);
    try {
      const transaction = await getActiveTransactionForRoom(room.transaction_id, tenantId, branchId);
      if (transaction) {
        console.log("[RoomStatusContent] Fetched transaction for View Details:", transaction);
        setTransactionDetails(transaction);
        
        if (room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED && transaction.status === TRANSACTION_STATUS.UNPAID) {
          setEditingModeForDialog('notesOnly'); 
          notesForm.reset({ notes: transaction.notes || '' });
        } else if ( (room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED) && 
                    (transaction.status === TRANSACTION_STATUS.ADVANCE_PAID || transaction.status === TRANSACTION_STATUS.ADVANCE_RESERVATION) ) {
          setEditingModeForDialog('fullReservation');
          reservationEditForm.reset({
            client_name: transaction.client_name,
            selected_rate_id: transaction.hotel_rate_id || undefined,
            client_payment_method: transaction.client_payment_method || undefined,
            notes: transaction.notes || '',
          });
        } else { 
            setEditingModeForDialog(null); 
            notesForm.reset({ notes: transaction.notes || '' }); 
        }
        setIsEditNotesMode(false); // Always start in view mode for notes
        setIsTransactionDetailsDialogOpen(true);
      } else {
        toast({ title: "No Details", description: `No active or relevant transaction found for linked ID ${room.transaction_id}. It might be completed or cancelled.`, variant: "default" });
        setTransactionDetails(null); setEditingModeForDialog(null);
      }
    } catch (error) {
      console.error("Error fetching transaction details:", error);
      toast({ title: "Error", description: `Failed to fetch transaction details. ${error instanceof Error ? error.message : ''}`, variant: "destructive" });
      setTransactionDetails(null); setEditingModeForDialog(null);
    } finally { setIsSubmitting(false); }
  }, [tenantId, branchId, toast, notesForm, reservationEditForm]);


  const handleOpenCheckoutConfirmation = useCallback(async (room: HotelRoom) => {
    if (!tenantId || !branchId || !staffUserId) { toast({ title: "Error", description: "Tenant, branch, or staff information missing.", variant: "destructive" }); return; }
    if (room.is_available !== ROOM_AVAILABILITY_STATUS.OCCUPIED) { toast({ title: "Action Not Allowed", description: "Room is not currently occupied.", variant: "default" }); return; }
    if (!room.transaction_id) { toast({ title: "Action Not Allowed", description: "No transaction linked for checkout.", variant: "default" }); return; }
    
    console.log(`[RoomStatusContent] Opening checkout confirmation for room ID: ${room.id}, transaction ID: ${room.transaction_id}`);
    setIsSubmitting(true); 
    try {
        const transaction = await getActiveTransactionForRoom(room.transaction_id, tenantId, branchId);
        if (!transaction || (transaction.status !== TRANSACTION_STATUS.UNPAID && transaction.is_paid !== TRANSACTION_IS_PAID_STATUS.PAID && transaction.status !== TRANSACTION_STATUS.PAID)) { 
            toast({ title: "Action Not Allowed", description: `Transaction (ID: ${room.transaction_id}) is not in a valid state for checkout. Current status: ${transaction?.status ? TRANSACTION_STATUS_TEXT[transaction.status as keyof typeof TRANSACTION_STATUS_TEXT] : 'Unknown'}, Payment: ${transaction?.is_paid !== null && transaction?.is_paid !== undefined ? TRANSACTION_IS_PAID_STATUS_TEXT[transaction.is_paid as keyof typeof TRANSACTION_IS_PAID_STATUS_TEXT] : 'Unknown'}`, variant: "default"});
            setIsSubmitting(false); return;
        }
        setRoomForActionConfirmation(room);
        setActiveTransactionIdForCheckout(room.transaction_id);
        setTransactionDetailsForCheckout(transaction);

        const check_in_time_str = transaction.check_in_time;
        const check_in_time_dt = parseISO(check_in_time_str!.replace(' ', 'T')); 
        const current_time_dt = new Date();
        setCurrentTimeForCheckoutModal(format(current_time_dt, 'yyyy-MM-dd hh:mm:ss aa'));
        
        const diffMillisecondsVal = differenceInMilliseconds(current_time_dt, check_in_time_dt);
        let hours_used_calc = Math.ceil(diffMillisecondsVal / (1000 * 60 * 60));
        if (hours_used_calc <= 0) hours_used_calc = 1; 
        setDisplayHoursUsedForCheckoutModal(hours_used_calc > 0 ? `${hours_used_calc} hr(s)` : 'Less than 1 hr');

        let bill = parseFloat(transaction.rate_price?.toString() || '0');
        const rate_hours_val = parseInt(transaction.rate_hours?.toString() || '0', 10);
        const rate_excess_hour_price_val = transaction.rate_excess_hour_price ? parseFloat(transaction.rate_excess_hour_price.toString()) : null;
        let existingTotalAmount = transaction.total_amount ? parseFloat(transaction.total_amount.toString()) : 0;
        let isInitiallyPaid = transaction.is_paid === TRANSACTION_IS_PAID_STATUS.PAID;

        if (hours_used_calc > rate_hours_val && rate_excess_hour_price_val && rate_excess_hour_price_val > 0) {
            if (isInitiallyPaid) { 
                bill = existingTotalAmount + (hours_used_calc - rate_hours_val) * rate_excess_hour_price_val;
            } else { 
                bill = parseFloat(transaction.rate_price?.toString() || '0') + (hours_used_calc - rate_hours_val) * rate_excess_hour_price_val;
            }
        } else { 
            bill = parseFloat(transaction.rate_price?.toString() || '0'); 
        }
        
        if (hours_used_calc > 0 && bill < parseFloat(transaction.rate_price?.toString() || '0')) {
            bill = parseFloat(transaction.rate_price?.toString() || '0');
        }

        setCurrentBillForCheckout(bill);
        checkoutForm.reset({ tender_amount: bill }); 
        setIsCheckoutModalOpen(true);
    } catch (error) { 
        console.error("Checkout prep error:", error);
        toast({ title: "Error", description: `Failed to fetch details for checkout. ${error instanceof Error ? error.message : ''}`, variant: "destructive" });
    } finally { setIsSubmitting(false); }
  }, [tenantId, branchId, staffUserId, toast, checkoutForm]);

  const handleConfirmCheckout = async (formData: CheckoutFormData) => {
      console.log("[RoomStatusContent] Attempting to confirm checkout. Form Data:", formData);
      if (!activeTransactionIdForCheckout || !roomForActionConfirmation || !staffUserId || !tenantId || !branchId || currentBillForCheckout === null) {
          toast({ title: "Checkout Error", description: "Missing critical details for checkout.", variant: "destructive" }); return;
      }
      const tenderAmountValue = parseFloat(String(formData.tender_amount));
       if (isNaN(tenderAmountValue) || tenderAmountValue < currentBillForCheckout) {
          checkoutForm.setError("tender_amount", { type: "manual", message: "Tender amount must be a valid number and at least equal to the total bill."}); return;
      }
      setIsSubmitting(true);
      try {
          const result = await checkOutGuestAndFreeRoom( activeTransactionIdForCheckout, staffUserId, tenantId, branchId, roomForActionConfirmation.id, tenderAmountValue );
          if (result.success && result.updatedRoomData && result.transaction) {
              toast({ title: "Success", description: result.message || "Guest checked out successfully." });
              updateRoomInLocalState(result.updatedRoomData);
              setIsCheckoutModalOpen(false);
              setRoomForActionConfirmation(null);
              setActiveTransactionIdForCheckout(null);
              setTransactionDetailsForCheckout(null);
              setCurrentBillForCheckout(null);
              checkoutForm.reset(defaultCheckoutFormValues);
          } else { toast({ title: "Check-out Failed", description: result.message || "Could not complete check-out.", variant: "destructive" }); }
      } catch (error) { 
          console.error("Error during checkout confirmation:", error);
          toast({ title: "Error", description: `An unexpected error occurred during check-out. ${error instanceof Error ? error.message : ''}`, variant: "destructive" });
      } finally { setIsSubmitting(false); }
  };

  const handleOpenCheckInReservedConfirmation = useCallback(async (room: HotelRoom) => {
    if (!tenantId || !branchId || !staffUserId) { toast({ title: "Error", description: "Required details missing for check-in.", variant: "destructive" }); return; }
    if (room.is_available !== ROOM_AVAILABILITY_STATUS.RESERVED) { toast({ title: "Action Not Allowed", description: "Room is not currently reserved.", variant: "default" }); return; }
    if (!room.transaction_id) { toast({ title: "Action Not Allowed", description: "No transaction linked to this reserved room.", variant: "default" }); return; }
    if (room.cleaning_status !== ROOM_CLEANING_STATUS.CLEAN) { toast({ title: "Action Not Allowed", description: `Room must be clean to check-in. Current: ${ROOM_CLEANING_STATUS_TEXT[room.cleaning_status || ROOM_CLEANING_STATUS.CLEAN]}.`, variant: "default" }); return; }
    
    console.log(`[RoomStatusContent] Opening check-in reserved confirmation for room ID: ${room.id}, transaction ID: ${room.transaction_id}`);
    setIsSubmitting(true); 
    const transaction = await getActiveTransactionForRoom(room.transaction_id, tenantId, branchId);
    setIsSubmitting(false);
    if (!transaction || (transaction.status !== TRANSACTION_STATUS.ADVANCE_PAID && transaction.status !== TRANSACTION_STATUS.ADVANCE_RESERVATION)) { 
        toast({ title: "Action Not Allowed", description: `Reservation (ID: ${room.transaction_id}) is not in a check-in ready state. Current status: ${transaction?.status ? TRANSACTION_STATUS_TEXT[transaction.status as keyof typeof TRANSACTION_STATUS_TEXT] : 'Unknown'}`, variant: "default"}); return;
    }
    setRoomForActionConfirmation(room);
    setActiveTransactionIdForAction(room.transaction_id); 
    setIsCheckInReservedConfirmOpen(true);
  }, [tenantId, branchId, staffUserId, toast]);

  const handleConfirmCheckInReservedGuest = async () => {
    if (!activeTransactionIdForAction || !roomForActionConfirmation || !staffUserId || !tenantId || !branchId) {
        toast({ title: "Check-in Error", description: "Required information for reserved check-in is missing.", variant: "destructive" });
        setIsCheckInReservedConfirmOpen(false); return;
    }
    console.log(`[RoomStatusContent] Confirming check-in for reserved guest. Transaction ID: ${activeTransactionIdForAction}, Room ID: ${roomForActionConfirmation.id}`);
    setIsSubmitting(true);
    try {
        const result = await checkInReservedGuest( activeTransactionIdForAction, roomForActionConfirmation.id, tenantId, branchId, staffUserId );
        if (result.success && result.updatedRoomData) {
            toast({ title: "Success", description: result.message || "Reserved guest checked in." });
            updateRoomInLocalState(result.updatedRoomData);
             if (isTransactionDetailsDialogOpen && transactionDetails?.id === activeTransactionIdForAction) {
                setIsTransactionDetailsDialogOpen(false); setTransactionDetails(null);
            }
        } else { toast({ title: "Check-in Failed", description: result.message, variant: "destructive" }); }
    } catch (error) { 
        console.error("Error during reserved check-in confirmation:", error);
        toast({ title: "Error", description: `An unexpected error occurred during reserved check-in. ${error instanceof Error ? error.message : ''}`, variant: "destructive" });
    } finally { setIsSubmitting(false); setIsCheckInReservedConfirmOpen(false); setRoomForActionConfirmation(null); setActiveTransactionIdForAction(null); }
  };

  const handleOpenCancelReservationConfirmation = useCallback(async (room: HotelRoom) => {
    if (!tenantId || !branchId ) { toast({ title: "Error", description: "Required details missing.", variant: "destructive" }); return; }
    if (room.is_available !== ROOM_AVAILABILITY_STATUS.RESERVED) { toast({ title: "Action Not Allowed", description: "Room is not currently reserved for cancellation.", variant: "default" }); return; }
    if (!room.transaction_id) { toast({ title: "Action Not Allowed", description: "No transaction linked to cancel.", variant: "default" }); return; }
    
    console.log(`[RoomStatusContent] Opening cancel reservation confirmation for room ID: ${room.id}, transaction ID: ${room.transaction_id}`);
    setIsSubmitting(true);
    const transaction = await getActiveTransactionForRoom(room.transaction_id, tenantId, branchId);
    setIsSubmitting(false);
    if (!transaction || (transaction.status !== TRANSACTION_STATUS.ADVANCE_PAID && transaction.status !== TRANSACTION_STATUS.ADVANCE_RESERVATION)) { 
        toast({ title: "Action Not Allowed", description: `Reservation (ID: ${room.transaction_id}) is not in a cancellable state. Current status: ${transaction?.status ? TRANSACTION_STATUS_TEXT[transaction.status as keyof typeof TRANSACTION_STATUS_TEXT] : 'Unknown'}`, variant: "default"}); return;
    }
    setRoomForActionConfirmation(room);
    setActiveTransactionIdForAction(room.transaction_id);
    setIsCancelReservationConfirmOpen(true);
  }, [tenantId, branchId, toast]);


  const handleConfirmCancelReservation = async () => {
    if (!activeTransactionIdForAction || !roomForActionConfirmation || !tenantId || !branchId) {
        toast({ title: "Cancellation Error", description: "Missing required data for cancellation.", variant: "destructive" });
        setIsCancelReservationConfirmOpen(false); return;
    }
    console.log(`[RoomStatusContent] Confirming cancel reservation. Transaction ID: ${activeTransactionIdForAction}, Room ID: ${roomForActionConfirmation.id}`);
    setIsSubmitting(true);
    try {
        const result = await cancelReservation(activeTransactionIdForAction, tenantId, branchId, roomForActionConfirmation.id);
        if (result.success && result.updatedRoomData) {
            toast({ title: "Success", description: "Reservation cancelled successfully." });
            updateRoomInLocalState(result.updatedRoomData);
            if (isTransactionDetailsDialogOpen && transactionDetails?.id === activeTransactionIdForAction) {
                 setIsTransactionDetailsDialogOpen(false); setTransactionDetails(null);
            }
        } else { toast({ title: "Cancellation Failed", description: result.message || "Could not cancel reservation.", variant: "destructive" }); }
    } catch (error) { 
        console.error("Error during cancellation confirmation:", error);
        toast({ title: "Error", description: `An unexpected error occurred during cancellation. ${error instanceof Error ? error.message : ''}`, variant: "destructive" });
    } finally { setIsSubmitting(false); setIsCancelReservationConfirmOpen(false); setRoomForActionConfirmation(null); setActiveTransactionIdForAction(null); }
  };

  const handleUpdateTransactionDetails = async (data: TransactionUpdateNotesData | z.infer<typeof transactionReservedUpdateSchema>) => {
    if (!transactionDetails || !transactionDetails.id || !tenantId || !branchId) { toast({ title: "Error", description: "Missing details to update.", variant: "destructive" }); return; }
    console.log(`[RoomStatusContent] Updating transaction details for ID: ${transactionDetails.id}, mode: ${editingModeForDialog}`);
    setIsSubmitting(true);
    try {
        let result;
        if (editingModeForDialog === 'notesOnly' && 'notes' in data) {
             result = await updateTransactionNotes(transactionDetails.id, data.notes, tenantId, branchId);
        } else if (editingModeForDialog === 'fullReservation' && 'client_name' in data && 'selected_rate_id' in data) { // Ensure 'selected_rate_id' is part of data if schema requires it
             result = await updateReservedTransactionDetails(transactionDetails.id, data as z.infer<typeof transactionReservedUpdateSchema>, tenantId, branchId);
        } else {
            toast({ title: "Error", description: "Invalid editing mode or data for update.", variant: "destructive" });
            setIsSubmitting(false);
            return;
        }
       
        if (result.success && result.updatedTransaction) {
            toast({ title: "Success", description: "Transaction details updated." });
            setTransactionDetails(result.updatedTransaction); 
            const roomToUpdate = rooms.find(r => r.transaction_id === result.updatedTransaction!.id);

            if (roomToUpdate) { 
                updateRoomInLocalState({
                    id: roomToUpdate.id,
                    active_transaction_client_name: result.updatedTransaction.client_name,
                    active_transaction_rate_name: allBranchActiveRates.find(rate => rate.id === result.updatedTransaction!.hotel_rate_id)?.name || roomToUpdate.active_transaction_rate_name,
                });
            }
            if (editingModeForDialog === 'notesOnly') notesForm.reset({ notes: result.updatedTransaction!.notes || '' });
            if (editingModeForDialog === 'fullReservation') reservationEditForm.reset({
                 client_name: result.updatedTransaction.client_name,
                 selected_rate_id: result.updatedTransaction.hotel_rate_id || undefined,
                 client_payment_method: result.updatedTransaction.client_payment_method || undefined,
                 notes: result.updatedTransaction.notes || '',
            });
            setIsEditNotesMode(false); // Exit notes edit mode after saving
        } else { toast({ title: "Update Failed", description: result.message || "Could not update details.", variant: "destructive" }); }
    } catch (error) { 
        console.error("Error updating transaction details:", error);
        toast({ title: "Error", description: `Unexpected error updating details. ${error instanceof Error ? error.message : ''}`, variant: "destructive" });
    } finally { setIsSubmitting(false); }
  };
  
  const getDefaultNoteForStatus = (status: string, currentNotes?: string | null): string => {
    if (status === ROOM_CLEANING_STATUS.CLEAN) return "This is ready for use.";
    if (status === ROOM_CLEANING_STATUS.DIRTY) return "Please clean the room.";
    if (status === ROOM_CLEANING_STATUS.INSPECTION) return "Please do a room inspection.";
    if (status === ROOM_CLEANING_STATUS.OUT_OF_ORDER) {
      if (targetCleaningStatusForModal === ROOM_CLEANING_STATUS.OUT_OF_ORDER && selectedRoomForCleaningUpdate?.cleaning_status !== ROOM_CLEANING_STATUS.OUT_OF_ORDER) {
          return ""; 
      }
      return currentNotes || ""; 
    }
    return currentNotes || ""; 
  };
  
  const handleOpenCleaningUpdateModal = (room: HotelRoom, targetStatus: string) => {
    console.log(`Opening cleaning update modal for room ${room.room_name}, target status: ${targetStatus}`);
    if (!staffUserId) {
      toast({ title: "Action Failed", description: "User ID not found. Cannot update cleaning status.", variant: "destructive" });
      return;
    }
    setSelectedRoomForCleaningUpdate(room);
    setTargetCleaningStatusForModal(targetStatus);
    cleaningUpdateForm.reset({
      cleaning_status: targetStatus,
      cleaning_notes: getDefaultNoteForStatus(targetStatus, room.cleaning_notes),
    });
    setIsCleaningUpdateModalOpen(true);
  };

  const handleSaveCleaningUpdate = async (data: RoomCleaningStatusUpdateData) => {
    if (!selectedRoomForCleaningUpdate || !tenantId || !branchId || !staffUserId) {
      toast({ title: "Error", description: "Missing details to update cleaning status/notes.", variant: "destructive" });
      return;
    }
    setIsSubmittingCleaningStatus(true);
    try {
      const result = await updateRoomCleaningStatus(
        selectedRoomForCleaningUpdate.id, 
        tenantId, 
        branchId, 
        data.cleaning_status, 
        data.cleaning_notes, 
        staffUserId
      );
      if (result.success && result.updatedRoom) {
        toast({ title: "Success", description: "Room cleaning status and notes updated." });
        updateRoomInLocalState({ 
            id: selectedRoomForCleaningUpdate.id, 
            cleaning_status: result.updatedRoom.cleaning_status,
            cleaning_notes: result.updatedRoom.cleaning_notes,
        });
        setIsCleaningUpdateModalOpen(false);
      } else {
        toast({ title: "Update Failed", description: result.message || "Could not update status/notes.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "An unexpected error occurred saving status/notes.", variant: "destructive" });
    } finally {
      setIsSubmittingCleaningStatus(false);
    }
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
    console.log(`[CheckoutModal] Calculating change. TenderWatch: ${tenderAmountWatch}, CurrentBill: ${currentBillForCheckout}`);
    const tender = parseFloat(String(tenderAmountWatch));
    const bill = currentBillForCheckout;

    if (bill !== null && !isNaN(tender) && tender >= 0) {
      const change = tender - bill;
      console.log(`[CheckoutModal] Tender: ${tender}, Bill: ${bill}, Calculated Change: ${change}`);
      return change;
    }
    console.log(`[CheckoutModal] Tender or Bill invalid. Tender: ${tenderAmountWatch}, Bill: ${currentBillForCheckout}`);
    return null;
  }, [tenderAmountWatch, currentBillForCheckout]);

  const getRoomRateNameForCard = (room: HotelRoom): string => {
    if (room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED || room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED) {
        if (room.active_transaction_rate_name) {
            return room.active_transaction_rate_name;
        }
    }
    if (!Array.isArray(room.hotel_rate_id) || room.hotel_rate_id.length === 0) return 'N/A';
    const firstRateId = room.hotel_rate_id[0];
    const rate = allBranchActiveRates.find(r => r.id === firstRateId);
    return rate ? rate.name : `Rate ID: ${firstRateId}`;
  };

  const handleOpenNotesOnlyModal = async (room: HotelRoom) => {
      if (!room.transaction_id || !tenantId || !branchId) {
          toast({ title: "Info", description: "No active transaction to view notes for.", variant: "default" });
          return;
      }
      setIsSubmitting(true); // Generic loading for fetching notes
      try {
          const transaction = await getActiveTransactionForRoom(room.transaction_id, tenantId, branchId);
          if (transaction) {
              setCurrentNotesForDisplay(transaction.notes || "No notes yet.");
              setIsNotesOnlyModalOpen(true);
          } else {
              toast({ title: "Info", description: "Could not fetch transaction details for notes.", variant: "default" });
          }
      } catch (error) {
          toast({ title: "Error", description: "Failed to fetch notes.", variant: "destructive" });
      } finally {
          setIsSubmitting(false);
      }
  };


  if (isLoadingRooms && isLoadingRates && rooms.length === 0 && allBranchActiveRates.length === 0) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2 text-muted-foreground">Loading room statuses...</p></div>;
  }
  if (!branchId && !isLoadingRooms && !isLoadingRates) {
    return <Card><CardHeader><div className="flex items-center space-x-2"><BedDouble className="h-6 w-6 text-primary" /><ShadDialogTitle>Room Status</ShadDialogTitle></div><ShadDialogDescription>View current room availability.</ShadDialogDescription></CardHeader><CardContent><p className="text-muted-foreground">No branch assigned or selected. Please ensure your staff account is assigned to a branch.</p></CardContent></Card>;
  }
  
  return (
    <div className="space-y-6">
       <Card>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <Wrench className="h-5 w-5 text-primary" />
            <CardTitle>Housekeeping Monitoring</CardTitle>
          </div>
          <ShadCardDescription className="flex justify-between items-center">
            <span>Quickly update the cleaning status for rooms.</span>
            <Button variant="ghost" size="sm" onClick={fetchRoomsAndRatesData} className="ml-4" disabled={isLoading}>
              <RefreshCw className={`mr-2 h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} /> Refresh Room List
            </Button>
          </ShadCardDescription>
        </CardHeader>
        <CardContent>
           <div className="flex items-center space-x-4 mb-4 text-xs text-muted-foreground border p-2 rounded-md bg-muted/30">
            <p className="font-semibold">Legend (Click icon to update status & notes):</p>
            {cleaningStatusActionButtons.map(btn => (
              <span key={btn.status} className="flex items-center">
                {React.cloneElement(btn.icon, {size: 14, className: cn("mr-1", btn.className.replace(/hover:[^ ]+ /g, '').replace(/text-[^-]+-\d+/g, ''))})} {btn.label}
              </span>
            ))}
          </div>
          <Tabs value={activeCleaningTab} onValueChange={setActiveCleaningTab} className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              {ROOM_CLEANING_STATUS_OPTIONS.map(opt => (
                <TabsTrigger key={opt.value} value={opt.value}>
                  {opt.label} ({rooms.filter(r => r.status === '1' && (r.cleaning_status || ROOM_CLEANING_STATUS.CLEAN) === opt.value).length})
                </TabsTrigger>
              ))}
            </TabsList>
            {ROOM_CLEANING_STATUS_OPTIONS.map(opt => (
              <TabsContent key={opt.value} value={opt.value}>
                <Accordion type="multiple" defaultValue={defaultOpenFloors} className="w-full">
                  {Object.entries(groupedRooms).map(([floor, floorRooms]) => {
                    const filteredFloorRooms = floorRooms.filter(r => r.status === '1' && (r.cleaning_status || ROOM_CLEANING_STATUS.CLEAN) === opt.value);
                    if (filteredFloorRooms.length === 0) return null;
                    return (
                      <AccordionItem value={floor} key={`cleaning-floor-${floor}-${opt.value}`} className="border bg-card rounded-md shadow-sm mb-2">
                        <AccordionTrigger className="px-4 py-3 hover:no-underline text-lg">Floor: {floor.replace('Ground Floor / Other', 'Ground Floor / Unspecified')} ({filteredFloorRooms.length})</AccordionTrigger>
                        <AccordionContent className="px-4 pb-4 pt-0">
                          <div className="space-y-2">
                            {filteredFloorRooms.map(room => (
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
                                  {room.cleaning_notes && (
                                    <p className="text-xs text-muted-foreground italic truncate max-w-xs" title={room.cleaning_notes}>
                                        Note: {room.cleaning_notes.substring(0, 40)}{room.cleaning_notes.length > 40 ? '...' : ''}
                                    </p>
                                  )}
                                </div>
                                <div className="flex space-x-1 items-center">
                                  {cleaningStatusActionButtons.map(actionBtn => (
                                    <Button
                                      key={actionBtn.status}
                                      variant={actionBtn.variant}
                                      size="icon"
                                      className={cn("h-8 w-8", actionBtn.className)}
                                      onClick={() => handleOpenCleaningUpdateModal(room, actionBtn.status)}
                                      disabled={isSubmittingCleaningStatus || ( (room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED || room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED) && actionBtn.status !== ROOM_CLEANING_STATUS.OUT_OF_ORDER) }
                                      title={ ( (room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED || room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED) && actionBtn.status !== ROOM_CLEANING_STATUS.OUT_OF_ORDER) ? `Cannot change cleaning status: Room is ${ROOM_AVAILABILITY_STATUS_TEXT[room.is_available]}` : actionBtn.label}
                                    >
                                      {isSubmittingCleaningStatus && selectedRoomForCleaningUpdate?.id === room.id && targetCleaningStatusForModal === actionBtn.status ? <Loader2 className="h-4 w-4 animate-spin" /> : React.cloneElement(actionBtn.icon, { size: 16 }) }
                                    </Button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
                 {Object.values(groupedRooms).every(floorRooms => floorRooms.filter(r => r.status === '1' && (r.cleaning_status || ROOM_CLEANING_STATUS.CLEAN) === opt.value).length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-4">No rooms currently in '{ROOM_CLEANING_STATUS_TEXT[opt.value as keyof typeof ROOM_CLEANING_STATUS_TEXT ]}' status.</p>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      <Accordion type="multiple" defaultValue={defaultOpenFloors} className="w-full space-y-1">
        {Object.entries(groupedRooms).map(([floor, floorRooms]) => {
          console.log(`[RoomStatusContent] Rendering floor: ${floor}`);
          const availableCleanCount = floorRooms.filter(room => room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && room.status === '1' && room.cleaning_status === ROOM_CLEANING_STATUS.CLEAN).length;
          const occupiedCount = floorRooms.filter(room => room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED && room.status === '1').length;
          const reservedCount = floorRooms.filter(room => room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED && room.status === '1').length;
          const availableNotCleanCount = floorRooms.filter(room => room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && room.status === '1' && room.cleaning_status !== ROOM_CLEANING_STATUS.CLEAN && room.cleaning_status !== ROOM_CLEANING_STATUS.OUT_OF_ORDER).length;

          if (floorRooms.filter(r => r.status === '1').length === 0) return null;

          return (
            <AccordionItem value={floor} key={`status-floor-${floor}`} className="border bg-card rounded-md shadow-sm">
               <AccordionTrigger className={cn( "text-xl font-semibold px-4 py-3 hover:no-underline sticky top-0 z-10 shadow-sm bg-inherit" )}>
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
                    console.log(`Rendering Room Card: Name: ${room.room_name}, Available: ${room.is_available}, Active Tx ID: ${room.active_transaction_id}, Client Name: ${room.active_transaction_client_name}`);
                    
                    let headerBgClass = "bg-card"; 
                    let headerSpecificTextColor = "text-card-foreground"; 
                    let statusDotColor = "bg-gray-400";
                    let displayedStatusText = ROOM_AVAILABILITY_STATUS_TEXT[room.is_available];
                    
                     if (room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE) {
                        if (room.cleaning_status === ROOM_CLEANING_STATUS.CLEAN) {
                            headerBgClass = "bg-green-500 text-white";
                            headerSpecificTextColor = "text-white/90";
                            statusDotColor = "bg-green-500";
                            displayedStatusText = "Available";
                        } else {
                            headerBgClass = "bg-slate-400 text-white";
                            headerSpecificTextColor = "text-white/90";
                            statusDotColor = "bg-slate-500";
                            displayedStatusText = ROOM_CLEANING_STATUS_TEXT[room.cleaning_status || ROOM_CLEANING_STATUS.CLEAN] || "Needs Attention";
                        }
                    } else if (room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED) {
                        headerBgClass = "bg-orange-500 text-white";
                        headerSpecificTextColor = "text-white/90";
                        statusDotColor = "bg-orange-500";
                        displayedStatusText = "Occupied";
                    } else if (room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED) {
                        headerBgClass = "bg-yellow-500 text-white";
                        headerSpecificTextColor = "text-white/90";
                        statusDotColor = "bg-yellow-500"; 
                        displayedStatusText = "Reserved";
                    }

                    return (
                      <Card
                        key={room.id}
                        className={cn("shadow-md hover:shadow-lg transition-shadow duration-200 flex flex-col border")}
                      >
                        <CardHeader className={cn("p-3 rounded-t-lg relative", headerBgClass)}>
                           <div className="flex justify-between items-start">
                            <div>
                              <CardTitle className={cn("text-lg")}>{room.room_name}</CardTitle>
                              <ShadCardDescription className={cn("text-xs", headerSpecificTextColor)}>
                                Room # : {room.room_code}
                              </ShadCardDescription>
                            </div>
                            {room.is_available !== ROOM_AVAILABILITY_STATUS.AVAILABLE && room.transaction_id && (
                               <Button
                                  variant="ghost"
                                  size="icon"
                                  className={cn( "h-7 w-7 p-1 absolute top-2 right-2", headerBgClass.includes("text-white") ? "text-white hover:bg-white/20" : "text-muted-foreground hover:bg-accent" )}
                                  title="View Transaction Notes"
                                  onClick={(e) => { e.stopPropagation(); if (room.transaction_id) handleOpenNotesOnlyModal(room); }} >
                                  <Info className="h-4 w-4" />
                                </Button>
                             )}
                          </div>
                        </CardHeader>
                        <CardContent className="p-3 pt-2 flex-grow flex flex-col justify-between">
                          <div className="mb-3 space-y-1">
                            <div className="flex items-center space-x-2">
                                <span className={cn("h-3 w-3 rounded-full", statusDotColor, room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && room.cleaning_status === ROOM_CLEANING_STATUS.CLEAN && "animate-pulse")}></span>
                                <span className={cn("text-sm font-medium", 
                                    room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && room.cleaning_status === ROOM_CLEANING_STATUS.CLEAN ? "text-green-700 dark:text-green-300" :
                                    room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && room.cleaning_status !== ROOM_CLEANING_STATUS.CLEAN && room.cleaning_status !== ROOM_CLEANING_STATUS.OUT_OF_ORDER ? "text-slate-700 dark:text-slate-300" :
                                    room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && room.cleaning_status === ROOM_CLEANING_STATUS.OUT_OF_ORDER ? "text-red-700 dark:text-red-400" : 
                                    room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED ? "text-orange-700 dark:text-orange-300" :
                                    room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED ? "text-yellow-600 dark:text-yellow-400" : 
                                    "text-gray-600 dark:text-gray-400"
                                )}>{displayedStatusText}</span>
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
                                    Note: {room.cleaning_notes.substring(0, 25)}{room.cleaning_notes.length > 25 ? "..." : ""}
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
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            className="w-full"
                                            title="Check-out Guest"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleOpenCheckoutConfirmation(room);
                                            }}
                                        >
                                            <LogOutIcon className="mr-2 h-4 w-4" /> Check-out
                                        </Button>
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
                                                    <ShadAlertDialogDescription>
                                                        Are you sure you want to check-in the guest for room {roomForActionConfirmation?.room_name}? This will update the reservation to an active booking.
                                                    </ShadAlertDialogDescription>
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
                                                    <ShadAlertDialogDescription>
                                                        Are you sure you want to cancel the reservation for room {roomForActionConfirmation?.room_name || ' (unassigned)'}?
                                                    </ShadAlertDialogDescription>
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
                          disabled={applicableRatesForBookingDialog.length === 0} >
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
                 <FormField
                  control={bookingForm.control}
                  name="is_paid"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-3 shadow-sm w-[90%]">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={(checked) => {
                            field.onChange(checked);
                            if (!checked) { 
                              bookingForm.setValue('tender_amount_at_checkin', null);
                            }
                          }}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <RHFFormLabel>Paid at Check-in?</RHFFormLabel>
                      </div>
                    </FormItem>
                  )}
                />
                {watchIsPaidInBookingForm && (
                  <FormField
                    control={bookingForm.control}
                    name="tender_amount_at_checkin"
                    render={({ field }) => (
                      <FormItem>
                        <RHFFormLabel>Tender Amount *</RHFFormLabel>
                        <FormControl>
                           <Input
                            type="text"
                            placeholder="0.00"
                            {...field}
                            value={field.value === null ? "" : String(field.value)}
                            onChange={(e) => {
                                const val = e.target.value;
                                if (val === "" || /^[0-9]*\.?[0-9]{0,2}$/.test(val)) {
                                  field.onChange(val === "" ? null : val);
                                }
                            }}
                            className="w-[90%]"
                            />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
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

      {/* Transaction Details / Edit Dialog */}
      <Dialog open={isTransactionDetailsDialogOpen} onOpenChange={(open) => {
          if (!open) {
              setIsTransactionDetailsDialogOpen(false); setTransactionDetails(null); setEditingModeForDialog(null);
              notesForm.reset(defaultNotesEditFormValues); reservationEditForm.reset(defaultReservationEditFormValues);
          } else { setIsTransactionDetailsDialogOpen(open); }
      }}>
        <DialogContent className="sm:max-w-md p-3">
          <DialogHeader className="border-b pb-2 mb-2">
            <ShadDialogTitle>Transaction Details</ShadDialogTitle>
            {transactionDetails?.room_name && <ShadDialogDescription>Room: {transactionDetails.room_name} ({transactionDetails.rate_name || 'Rate N/A'})</ShadDialogDescription>}
          </DialogHeader>
          {transactionDetails ? (
            <div className="space-y-3 text-sm py-2">
              <p><strong>Client:</strong> {transactionDetails.client_name}</p>
              <p><strong>Status:</strong> {transactionDetails.status ? TRANSACTION_STATUS_TEXT[transactionDetails.status as keyof typeof TRANSACTION_STATUS_TEXT] || 'Unknown' : 'N/A'}</p>
              <p><strong>Payment Status:</strong> {transactionDetails.is_paid !== null && transactionDetails.is_paid !== undefined ? TRANSACTION_IS_PAID_STATUS_TEXT[transactionDetails.is_paid as keyof typeof TRANSACTION_IS_PAID_STATUS_TEXT] : 'N/A'}</p>
              {transactionDetails.check_in_time && (<p><strong>Checked-in/Reserved On:</strong> {format(parseISO(transactionDetails.check_in_time.replace(' ', 'T')), 'yyyy-MM-dd hh:mm:ss aa')}</p>)}
              {transactionDetails.reserved_check_in_datetime && (<p><strong>Expected Check-in:</strong> {format(parseISO(transactionDetails.reserved_check_in_datetime.replace(' ', 'T')), 'yyyy-MM-dd hh:mm:ss aa')}</p>)}
              {transactionDetails.check_out_time && (<p><strong>Check-out:</strong> {format(parseISO(transactionDetails.check_out_time.replace(' ', 'T')), 'yyyy-MM-dd hh:mm:ss aa')}</p>)}
              {transactionDetails.hours_used !== undefined && transactionDetails.hours_used !== null && (<p><strong>Hours Used:</strong> {transactionDetails.hours_used}</p>)}
              {transactionDetails.total_amount !== undefined && transactionDetails.total_amount !== null && (<p><strong>Total Amount:</strong> ₱{Number(transactionDetails.total_amount).toFixed(2)}</p>)}
              {transactionDetails.tender_amount !== undefined && transactionDetails.tender_amount !== null && (<p><strong>Tender Amount:</strong> ₱{Number(transactionDetails.tender_amount).toFixed(2)}</p>)}
              {transactionDetails.is_paid === TRANSACTION_IS_PAID_STATUS.PAID && typeof transactionDetails.tender_amount === 'number' && typeof transactionDetails.total_amount === 'number' && transactionDetails.tender_amount >= transactionDetails.total_amount && (
                <p><strong>Change Given:</strong> ₱{(transactionDetails.tender_amount - transactionDetails.total_amount).toFixed(2)}</p>
              )}

              {editingModeForDialog === 'fullReservation' ? (
                <Form {...reservationEditForm}>
                  <form onSubmit={reservationEditForm.handleSubmit(data => handleUpdateTransactionDetails(data as z.infer<typeof transactionReservedUpdateSchema>))} className="space-y-3 pt-3 border-t mt-3">
                    <FormField control={reservationEditForm.control} name="client_name" render={({ field }) => (
                      <FormItem><RHFFormLabel>Client Name *</RHFFormLabel><FormControl><Input {...field} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
                    )} />
                     <FormField control={reservationEditForm.control} name="selected_rate_id" render={({ field }) => (
                        <FormItem>
                            <RHFFormLabel>Select Rate *</RHFFormLabel>
                            <Select
                                onValueChange={(value) => field.onChange(value ? parseInt(value, 10) : undefined)}
                                value={field.value?.toString()}
                                disabled={allBranchActiveRates.length === 0} >
                                <FormControl>
                                    <SelectTrigger className="w-[90%]">
                                        <SelectValue placeholder={allBranchActiveRates.length === 0 ? "No rates available" : "Select a rate"} />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    {allBranchActiveRates.map(rate => (
                                        <SelectItem key={rate.id} value={rate.id.toString()}>
                                            {rate.name} (₱{Number(rate.price).toFixed(2)} for {rate.hours}hr/s)
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                     )}/>
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
                    <FormField control={notesForm.control} name="notes" render={({ field }) => ( 
                      <FormItem><RHFFormLabel>Notes</RHFFormLabel><FormControl><Textarea {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
                    )} />
                     <div className="flex justify-end space-x-2 pt-2">
                        <Button type="submit" size="sm" disabled={isSubmitting || !reservationEditForm.formState.isValid}>
                            {isSubmitting ? <Loader2 className="animate-spin h-3 w-3" /> : "Save Reservation Changes"}
                        </Button>
                         <Button type="button" variant="outline" size="sm" onClick={() => { setEditingModeForDialog(null); reservationEditForm.reset(defaultReservationEditFormValues); if(transactionDetails) notesForm.reset({ notes: transactionDetails.notes || ''}); }}>Cancel Edit</Button>
                    </div>
                  </form>
                </Form>
              ) : ( 
                 <div className="pt-3 border-t mt-3 space-y-1">
                    <div className="flex justify-between items-center">
                        {isEditNotesMode ? null : <Label>Notes:</Label>}
                        {!isEditNotesMode && (transactionDetails.status === TRANSACTION_STATUS.UNPAID || transactionDetails.status === TRANSACTION_STATUS.ADVANCE_PAID || transactionDetails.status === TRANSACTION_STATUS.ADVANCE_RESERVATION ) && (
                            <Button variant="ghost" size="sm" onClick={() => setIsEditNotesMode(true)}><Edit3 className="h-3 w-3 mr-1" /> Edit Notes</Button>
                        )}
                    </div>
                    {isEditNotesMode ? (
                         <Form {...notesForm}>
                            <form onSubmit={notesForm.handleSubmit(data => handleUpdateTransactionDetails(data as TransactionUpdateNotesData))} className="space-y-3">
                                <FormField control={notesForm.control} name="notes" render={({ field }) => (
                                <FormItem><RHFFormLabel className="sr-only">Notes</RHFFormLabel><FormControl><Textarea {...field} value={field.value ?? ''} className="w-full" rows={3} /></FormControl><FormMessage /></FormItem>
                                )} />
                                <div className="flex justify-end space-x-2">
                                    <Button type="submit" size="sm" disabled={isSubmitting || !notesForm.formState.isValid}>
                                        {isSubmitting ? <Loader2 className="animate-spin h-3 w-3" /> : "Save Notes"}
                                    </Button>
                                    <Button type="button" variant="outline" size="sm" onClick={() => { setIsEditNotesMode(false); if(transactionDetails) notesForm.reset({ notes: transactionDetails.notes || ''}); }}>Cancel</Button>
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
          <DialogFooter className="pt-4 flex flex-row justify-between items-center">
             {transactionDetails && (transactionDetails.status === TRANSACTION_STATUS.ADVANCE_PAID || transactionDetails.status === TRANSACTION_STATUS.ADVANCE_RESERVATION) && editingModeForDialog !== 'fullReservation' && !isEditNotesMode && (
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
                                } else { toast({title: "Error", description: "Could not find transaction or room for cancellation.", variant: "destructive"}); }
                            }}
                            disabled={isSubmitting}
                        >
                            <Ban className="mr-2 h-4 w-4" /> Cancel Reservation
                        </Button>
                    </AlertDialogTrigger>
                     <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                        <AlertDialogHeader>
                            <ShadAlertDialogTitle>Confirm Cancellation</ShadAlertDialogTitle>
                            <ShadAlertDialogDescription>
                                Are you sure you want to cancel this reservation for room {roomForActionConfirmation?.room_name || ' (unassigned)'}?
                            </ShadAlertDialogDescription>
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
            <div className="flex-grow"></div> 
            <DialogClose asChild><Button variant="outline" onClick={() => {
              setIsTransactionDetailsDialogOpen(false); setTransactionDetails(null); setEditingModeForDialog(null);
              notesForm.reset(defaultNotesEditFormValues); reservationEditForm.reset(defaultReservationEditFormValues);
            }}>Close</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Checkout Modal */}
      <Dialog
        open={isCheckoutModalOpen}
        onOpenChange={(openValue) => {
          if (!openValue) {
            setIsCheckoutModalOpen(false);
            setRoomForActionConfirmation(null);
            setActiveTransactionIdForCheckout(null);
            setTransactionDetailsForCheckout(null);
            setCurrentBillForCheckout(null);
            checkoutForm.reset(defaultCheckoutFormValues);
          }
        }}
      >
        <DialogContent className="sm:max-w-md p-4">
            <DialogHeader className="border-b pb-3 mb-3">
                <ShadDialogTitle className="text-xl">Confirm Check-out: {roomForActionConfirmation?.room_name}</ShadDialogTitle>
                <ShadDialogDescription>Room #: {roomForActionConfirmation?.room_code}</ShadDialogDescription>
            </DialogHeader>
            {transactionDetailsForCheckout && currentBillForCheckout !== null && (
                <div className="space-y-3 text-sm py-2">
                     <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        <span className="text-muted-foreground font-medium text-right">Client:</span> <span className="font-semibold">{transactionDetailsForCheckout.client_name}</span>
                        <span className="text-muted-foreground font-medium text-right">Checked-in:</span> <span className="font-semibold">{transactionDetailsForCheckout.check_in_time ? format(parseISO(transactionDetailsForCheckout.check_in_time.replace(' ', 'T')), 'yyyy-MM-dd hh:mm:ss aa') : 'N/A'}</span>
                        <span className="text-muted-foreground font-medium text-right">Current Time:</span> <span className="font-semibold">{currentTimeForCheckoutModal}</span>
                        <span className="text-muted-foreground font-medium text-right">Rate:</span> <span className="font-semibold">{transactionDetailsForCheckout.rate_name || 'N/A'}</span>
                        <span className="text-muted-foreground font-medium text-right">Hours Stayed (Est.):</span> <span className="font-semibold">{displayHoursUsedForCheckoutModal}</span>
                    </div>
                    <hr className="my-2 border-border"/>
                    <div className="flex justify-between items-center text-lg"><span className="font-semibold text-muted-foreground">Total Bill:</span> <span className="font-bold text-primary">₱{currentBillForCheckout.toFixed(2)}</span></div>
                    
                    <Form {...checkoutForm}>
                        <form className="space-y-4 pt-3">
                             <FormField
                                control={checkoutForm.control}
                                name="tender_amount"
                                render={({ field }) => (
                                    <FormItem>
                                        <RHFFormLabel className="text-base">Tender Amount *</RHFFormLabel>
                                        <FormControl>
                                            <Input
                                                type="text"
                                                placeholder="0.00"
                                                {...field}
                                                value={
                                                  transactionDetailsForCheckout.tender_amount ? transactionDetailsForCheckout.tender_amount :
                                                  (field.value === null || field.value === undefined ? "" : String(field.value))
                                                }
                                                onChange={(e) => {
                                                    const val = e.target.value;
                                                    // Regex to allow numbers, one optional decimal point, and up to two decimal places
                                                    if (/^\d*\.?\d{0,2}$/.test(val) || val === "") {
                                                      field.onChange(val); // Store the raw string value
                                                    }
                                                }}
                                                className="w-full text-lg p-2 text-right"
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                             
                            {calculatedChange !== null && (
                                 <div className="flex justify-between items-center text-md pt-1">
                                    <span className="font-semibold text-muted-foreground">Change:</span>
                                    <span className={cn("font-bold", calculatedChange < 0 ? "text-destructive" : "text-foreground")}>
                                      {
                                        transactionDetailsForCheckout.tender_amount ? (transactionDetailsForCheckout.tender_amount - currentBillForCheckout ) :  ("₱" + calculatedChange.toFixed(2))
                                      }
                                    </span>
                                </div>
                            )}
                            <DialogFooter className="sm:justify-between pt-4">
                                <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => {
                                    setIsCheckoutModalOpen(false); setRoomForActionConfirmation(null); setActiveTransactionIdForCheckout(null);
                                    setTransactionDetailsForCheckout(null); setCurrentBillForCheckout(null); checkoutForm.reset(defaultCheckoutFormValues);
                                }}>Cancel</Button>
                                <Button 
                                    type="button" 
                                    onClick={checkoutForm.handleSubmit(handleConfirmCheckout)}
                                    className="w-full sm:w-auto"
                                    disabled={isSubmitting || currentBillForCheckout === null || isNaN(parseFloat(String(tenderAmountWatch))) || parseFloat(String(tenderAmountWatch)) < currentBillForCheckout}
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

      {/* Cleaning Status and Notes Update Modal */}
       <Dialog open={isCleaningUpdateModalOpen} onOpenChange={(isOpen) => {
            if (!isOpen) {
                setSelectedRoomForCleaningUpdate(null);
                setTargetCleaningStatusForModal(null);
                cleaningUpdateForm.reset(defaultCleaningUpdateFormValues);
            }
             setIsCleaningUpdateModalOpen(isOpen);
        }}>
            <DialogContent className="sm:max-w-md p-4">
                <DialogHeader className="border-b pb-3 mb-3">
                    <ShadDialogTitle className="text-xl">
                        Update Cleaning: {selectedRoomForCleaningUpdate?.room_name} ({selectedRoomForCleaningUpdate?.room_code})
                    </ShadDialogTitle>
                </DialogHeader>

                <Form {...cleaningUpdateForm}>
                    <form onSubmit={cleaningUpdateForm.handleSubmit(handleSaveCleaningUpdate)} className="space-y-4 py-2">
                        <FormField
                            control={cleaningUpdateForm.control}
                            name="cleaning_status"
                            render={({ field }) => (
                                <FormItem>
                                    <RHFFormLabel>New Cleaning Status *</RHFFormLabel>
                                    <Select
                                        onValueChange={(value) => {
                                            field.onChange(value);
                                            cleaningUpdateForm.setValue('cleaning_notes', getDefaultNoteForStatus(value, selectedRoomForCleaningUpdate?.cleaning_notes), {shouldValidate: value === ROOM_CLEANING_STATUS.OUT_OF_ORDER});
                                        }}
                                        value={field.value}
                                    >
                                        <FormControl><SelectTrigger><SelectValue placeholder="Select new status" /></SelectTrigger></FormControl>
                                        <SelectContent>
                                            {ROOM_CLEANING_STATUS_OPTIONS.map(opt => (
                                                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={cleaningUpdateForm.control}
                            name="cleaning_notes"
                            render={({ field }) => (
                                <FormItem>
                                    <RHFFormLabel>
                                        Notes
                                        {watchCleaningStatusInModal === ROOM_CLEANING_STATUS.OUT_OF_ORDER && ' * (Required)'}
                                    </RHFFormLabel>
                                    <FormControl><Textarea placeholder="Enter notes..." {...field} value={field.value ?? ''} rows={4} className="w-full" /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <DialogFooter className="sm:justify-start pt-3">
                             <Button type="submit" disabled={isSubmittingCleaningStatus}>{isSubmittingCleaningStatus ? <Loader2 className="animate-spin mr-2" size={16} /> : null} Save Changes</Button>
                             <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>

      {/* Notes Only Modal (triggered by info icon in card header) */}
      <Dialog open={isNotesOnlyModalOpen} onOpenChange={setIsNotesOnlyModalOpen}>
        <DialogContent className="sm:max-w-md p-3">
          <DialogHeader className="border-b pb-2 mb-2">
            <ShadDialogTitle>Transaction Notes</ShadDialogTitle>
             {selectedRoomForBooking?.room_name && <ShadDialogDescription>Room: {selectedRoomForBooking.room_name} ({selectedRoomForBooking.room_code})</ShadDialogDescription>}
          </DialogHeader>
          <div className="py-4">
            <Label>Notes:</Label>
            <pre className="whitespace-pre-wrap text-sm bg-muted p-2 rounded-md mt-1 min-h-[60px]">
              {currentNotesForDisplay || "No notes recorded for this transaction."}
            </pre>
          </div>
          <DialogFooter className="sm:justify-end">
            <DialogClose asChild><Button variant="outline">Close</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Available Rooms Overview Modal */}
      <Dialog open={showAvailableRoomsOverview} onOpenChange={(open) => {
          if(!open) onCloseAvailableRoomsOverview();
      }}>
        <DialogContent className="sm:max-w-2xl md:max-w-3xl lg:max-w-4xl p-0 flex flex-col max-h-[90vh] overflow-hidden">
          <DialogHeader className="p-3 border-b">
            <ShadDialogTitle className="flex items-center">
                <Eye className="mr-2 h-5 w-5 text-primary" /> Available Rooms Overview
            </ShadDialogTitle>
          </DialogHeader>

          <div className="flex-grow overflow-y-auto p-4">
            {isLoadingRooms ? (
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
                 <ShadDialogDescription className="text-sm text-muted-foreground">Room #: {selectedRoomForRatesDisplay?.room_code}</ShadDialogDescription>
            </DialogHeader>
            <div className="py-4 max-h-[60vh] overflow-y-auto">
                {selectedRoomForRatesDisplay && Array.isArray(selectedRoomForRatesDisplay.hotel_rate_id) && selectedRoomForRatesDisplay.hotel_rate_id.length > 0 ? (
                    (() => {
                        const applicableRates = allBranchActiveRates
                            .filter(rate => selectedRoomForRatesDisplay!.hotel_rate_id!.includes(rate.id))
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
                 <DialogClose asChild>
                    <Button variant="outline" onClick={() => { setIsRoomRatesDetailModalOpen(false); setSelectedRoomForRatesDisplay(null); }}>Close</Button>
                </DialogClose>
            </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
