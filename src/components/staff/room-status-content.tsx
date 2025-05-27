
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription as ShadCardDescription,
} from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription as ShadDialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription as ShadAlertDialogDescriptionConfirm, // Aliased
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle as ShadAlertDialogTitleConfirm // Aliased
} from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { BedDouble, Loader2, Info, User as UserIcon, LogOutIcon, LogIn, CalendarClock, Edit3, Ban, CheckCircle2, CalendarPlus, Tags, Eye, XCircle, Search, AlertTriangle, Wrench, RefreshCw } from "lucide-react";
import type { HotelRoom, Transaction, SimpleRate, GroupedRooms, RoomCleaningStatusUpdateData, CheckoutFormData, StaffBookingCreateData, TransactionUpdateNotesData, TransactionReservedUpdateData } from '@/lib/types';

// Updated imports for actions:
import { listRoomsForBranch } from '@/actions/admin/rooms/listRoomsForBranch';
import { getRatesForBranchSimple } from '@/actions/admin/rates/getRatesForBranchSimple';

import { createTransactionAndOccupyRoom } from '@/actions/staff/transactions/createTransactionAndOccupyRoom';
import { getActiveTransactionForRoom } from '@/actions/staff/transactions/getActiveTransactionForRoom';
import { checkOutGuestAndFreeRoom } from '@/actions/staff/transactions/checkOutGuestAndFreeRoom';
import { updateTransactionNotes } from '@/actions/staff/transactions/updateTransactionNotes';
import { createReservation } from '@/actions/staff/reservations/createReservation';
import { updateReservedTransactionDetails } from '@/actions/staff/reservations/updateReservedTransactionDetails';
import { cancelReservation } from '@/actions/staff/reservations/cancelReservation';
import { checkInReservedGuest } from '@/actions/staff/reservations/checkInReservedGuest';
import { updateRoomCleaningStatus } from '@/actions/staff/rooms/updateRoomCleaningStatus';


import {
  staffBookingCreateSchema,
  transactionUpdateNotesSchema,
  transactionReservedUpdateSchema,
  checkoutFormSchema,
  roomCleaningStatusAndNotesUpdateSchema,
} from '@/lib/schemas';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  ROOM_AVAILABILITY_STATUS,
  ROOM_AVAILABILITY_STATUS_TEXT,
  TRANSACTION_LIFECYCLE_STATUS,
  TRANSACTION_LIFECYCLE_STATUS_TEXT,
  ROOM_CLEANING_STATUS,
  ROOM_CLEANING_STATUS_TEXT,
  ROOM_CLEANING_STATUS_OPTIONS,
  TRANSACTION_PAYMENT_STATUS,
  TRANSACTION_PAYMENT_STATUS_TEXT,
  TRANSACTION_IS_ACCEPTED_STATUS,
  HOTEL_ENTITY_STATUS
} from '@/lib/constants';
import { format, parseISO, addHours, differenceInMilliseconds, setHours, setMinutes, setSeconds, setMilliseconds, addDays } from 'date-fns';
import CleaningStatusUpdateCard from './room-status/CleaningStatusUpdateCard';


const defaultBookingFormValues: StaffBookingCreateData = {
  client_name: '',
  selected_rate_id: undefined as unknown as number, // Will be set if applicableRates[0] exists
  client_payment_method: 'Cash',
  notes: '',
  is_advance_reservation: false,
  reserved_check_in_datetime: null,
  reserved_check_out_datetime: null,
  is_paid: TRANSACTION_PAYMENT_STATUS.UNPAID,
  tender_amount_at_checkin: null,
};

const defaultNotesEditFormValues: TransactionUpdateNotesData = {
  notes: '',
};

const defaultReservationEditFormValues: TransactionReservedUpdateData = {
  client_name: '',
  selected_rate_id: undefined as unknown as number,
  client_payment_method: undefined,
  notes: '',
  is_advance_reservation: false,
  reserved_check_in_datetime: null,
  reserved_check_out_datetime: null,
  is_paid: TRANSACTION_PAYMENT_STATUS.UNPAID,
  tender_amount_at_checkin: null,
};

const defaultCheckoutFormValues: CheckoutFormData = {
    tender_amount: 0,
    payment_method: 'Cash',
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


  const [roomForActionConfirmation, setRoomForActionConfirmation] = useState<HotelRoom | null>(null);
  const [activeTransactionIdForAction, setActiveTransactionIdForAction] = useState<number | null>(null);


  const [transactionDetailsForCheckout, setTransactionDetailsForCheckout] = useState<Transaction | null>(null);
  const [currentBillForCheckout, setCurrentBillForCheckout] = useState<number | null>(null);
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);

  const [isCancelReservationConfirmOpen, setIsCancelReservationConfirmOpen] = useState(false);
  const [isCheckInReservedConfirmOpen, setIsCheckInReservedConfirmOpen] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentTimeForCheckoutModal, setCurrentTimeForCheckoutModal] = useState<string>('');
  const [displayHoursUsedForCheckoutModal, setDisplayHoursUsedForCheckoutModal] = useState<string>('N/A');

  const [isEditNotesMode, setIsEditNotesMode] = useState(false); // For notes editing in details modal

  const [isRoomRatesDetailModalOpen, setIsRoomRatesDetailModalOpen] = useState(false);
  const [selectedRoomForRatesDisplay, setSelectedRoomForRatesDisplay] = useState<HotelRoom | null>(null);

  const [isLoadingRooms, setIsLoadingRooms] = useState(true);
  const [isLoadingRates, setIsLoadingRates] = useState(true);
  const [defaultOpenFloors, setDefaultOpenFloors] = useState<string[]>([]);
  const [roomSearchTerm, setRoomSearchTerm] = useState('');


  const [isNotesOnlyModalOpen, setIsNotesOnlyModalOpen] = useState(false);
  const [currentNotesForDisplay, setCurrentNotesForDisplay] = useState<string | null | undefined>(null);

  const { toast } = useToast();

  const bookingForm = useForm<StaffBookingCreateData>({
    resolver: zodResolver(staffBookingCreateSchema),
    defaultValues: defaultBookingFormValues,
  });
  const watchIsPaidInBookingForm = useWatch({ control: bookingForm.control, name: 'is_paid' });
  const watchIsAdvanceReservationInBookingForm = useWatch({ control: bookingForm.control, name: 'is_advance_reservation' });

  const notesEditForm = useForm<TransactionUpdateNotesData>({
    resolver: zodResolver(transactionUpdateNotesSchema),
    defaultValues: defaultNotesEditFormValues,
  });

  const reservationEditForm = useForm<TransactionReservedUpdateData>({
    resolver: zodResolver(transactionReservedUpdateSchema),
    defaultValues: defaultReservationEditFormValues,
  });
  const watchIsAdvanceReservationForEdit = useWatch({ control: reservationEditForm.control, name: 'is_advance_reservation'});
  const watchIsPaidForEditReservation = useWatch({ control: reservationEditForm.control, name: 'is_paid'});

  const checkoutForm = useForm<CheckoutFormData>({
    resolver: zodResolver(checkoutFormSchema),
    defaultValues: defaultCheckoutFormValues,
  });
  const tenderAmountWatch = useWatch({ control: checkoutForm.control, name: 'tender_amount'});


  const updateRoomInLocalState = useCallback((updatedRoomPartial: Partial<HotelRoom> & { id: number }) => {
    setRooms(prevRooms => {
      const newRooms = prevRooms.map(r =>
        r.id === updatedRoomPartial.id ? { ...r, ...updatedRoomPartial } : r
      );

      const activeHotelRooms = newRooms.filter(room => String(room.status) === HOTEL_ENTITY_STATUS.ACTIVE);
      const filteredForGrouping = roomSearchTerm
        ? activeHotelRooms.filter(room =>
            (room.room_name?.toLowerCase().includes(roomSearchTerm.toLowerCase()) ||
             room.room_code?.toLowerCase().includes(roomSearchTerm.toLowerCase()))
          )
        : activeHotelRooms;

      const newGrouped = filteredForGrouping.reduce((acc, currentRoom) => {
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
      return newRooms; // Return the full updated list
    });
  }, [roomSearchTerm]);


  const fetchRoomsAndRatesData = useCallback(async () => {
    if (!tenantId || !branchId) {
      setIsLoading(false); setIsLoadingRooms(false); setIsLoadingRates(false);
      setRooms([]); setGroupedRooms({}); setAllBranchActiveRates([]);
      return;
    }
    setIsLoading(true); setIsLoadingRooms(true); setIsLoadingRates(true);
    try {
      const [fetchedRooms, fetchedBranchRates] = await Promise.all([
        listRoomsForBranch(branchId, tenantId),
        getRatesForBranchSimple(tenantId, branchId)
      ]);
      setRooms(fetchedRooms);
      setAllBranchActiveRates(fetchedBranchRates.filter(rate => String(rate.status) === HOTEL_ENTITY_STATUS.ACTIVE));

      const activeHotelRooms = fetchedRooms.filter(room => String(room.status) === HOTEL_ENTITY_STATUS.ACTIVE);
      const filteredForGrouping = roomSearchTerm
        ? activeHotelRooms.filter(room =>
            (room.room_name?.toLowerCase().includes(roomSearchTerm.toLowerCase()) ||
             room.room_code?.toLowerCase().includes(roomSearchTerm.toLowerCase()))
          )
        : activeHotelRooms;

      const grouped = filteredForGrouping.reduce((acc, room) => {
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
      setDefaultOpenFloors([]); // Ensure accordions are closed by default on new fetch

    } catch (error) {
      toast({ title: "Error", description: `Could not fetch room statuses or rates. ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
    } finally {
      setIsLoading(false); setIsLoadingRooms(false); setIsLoadingRates(false);
    }
  }, [tenantId, branchId, toast, roomSearchTerm]);

  useEffect(() => {
    fetchRoomsAndRatesData();
  }, [fetchRoomsAndRatesData]);

  useEffect(() => {
      if (isLoadingRooms) return; // Prevent re-grouping while rooms are still loading

      const activeHotelRooms = rooms.filter(room => String(room.status) === HOTEL_ENTITY_STATUS.ACTIVE);
      const filteredForGrouping = roomSearchTerm
        ? activeHotelRooms.filter(room =>
            (room.room_name?.toLowerCase().includes(roomSearchTerm.toLowerCase()) ||
             room.room_code?.toLowerCase().includes(roomSearchTerm.toLowerCase()))
          )
        : activeHotelRooms;

      const grouped = filteredForGrouping.reduce((acc, room) => {
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
  }, [roomSearchTerm, rooms, isLoadingRooms]); // Depend on rooms and isLoadingRooms

  const formatDateTimeForInput = (dateString?: string | null): string => {
    if (!dateString) return "";
    try {
      const parsableDateString = dateString.includes('T') ? dateString : dateString.replace(' ', 'T');
      return format(parseISO(parsableDateString), "yyyy-MM-dd'T'HH:mm");
    } catch (e) {
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
              const parsableDateString = checkInDateString.includes('T') ? checkInDateString : checkInDateString.replace(' ', 'T');
              const parsedCheckIn = parseISO(parsableDateString);
              if (!isNaN(parsedCheckIn.getTime())) {
                  baseDate = parsedCheckIn;
              }
          } catch (e) { /* ignore */ }
      } else {
          baseDate = setMilliseconds(setSeconds(setMinutes(setHours(baseDate, 14), 0), 0), 0);
      }
      const checkOut = setMilliseconds(setSeconds(setMinutes(setHours(addDays(baseDate, 1), 12),0),0),0);
      return format(checkOut, "yyyy-MM-dd'T'HH:mm");
  };

  useEffect(() => {
    if (isBookingDialogOpen && watchIsAdvanceReservationInBookingForm) {
        if (!bookingForm.getValues('reserved_check_in_datetime')) {
            bookingForm.setValue('reserved_check_in_datetime', getDefaultCheckInDateTimeString(), { shouldValidate: true, shouldDirty: true });
        }
        const currentCheckIn = bookingForm.getValues('reserved_check_in_datetime');
        if (!bookingForm.getValues('reserved_check_out_datetime')) {
             bookingForm.setValue('reserved_check_out_datetime', getDefaultCheckOutDateTimeString(currentCheckIn), { shouldValidate: true, shouldDirty: true });
        }
    } else if (isBookingDialogOpen) { // When not advance reservation OR dialog just opened
        bookingForm.setValue('reserved_check_in_datetime', null, { shouldValidate: true });
        bookingForm.setValue('reserved_check_out_datetime', null, { shouldValidate: true });
    }
  }, [watchIsAdvanceReservationInBookingForm, bookingForm, isBookingDialogOpen]);

  useEffect(() => {
      if (isTransactionDetailsDialogOpen && editingModeForDialog === 'fullReservation' && watchIsAdvanceReservationForEdit) {
          if (!reservationEditForm.getValues('reserved_check_in_datetime')) {
               reservationEditForm.setValue('reserved_check_in_datetime', getDefaultCheckInDateTimeString(), { shouldValidate: true, shouldDirty: true });
          }
          const currentCheckIn = reservationEditForm.getValues('reserved_check_in_datetime');
          if (!reservationEditForm.getValues('reserved_check_out_datetime')) {
               reservationEditForm.setValue('reserved_check_out_datetime', getDefaultCheckOutDateTimeString(currentCheckIn), { shouldValidate: true, shouldDirty: true });
          }
      } else if (isTransactionDetailsDialogOpen && editingModeForDialog === 'fullReservation') { // When not advance reservation
          reservationEditForm.setValue('reserved_check_in_datetime', null);
          reservationEditForm.setValue('reserved_check_out_datetime', null);
      }
  }, [watchIsAdvanceReservationForEdit, reservationEditForm, isTransactionDetailsDialogOpen, editingModeForDialog]);


  const handleOpenBookingDialog = (room: HotelRoom, mode: 'book' | 'reserve') => {
    if (!tenantId || !branchId) {
      toast({ title: "Error", description: "Tenant or branch information missing.", variant: "destructive" });
      return;
    }
     if (room.is_available !== ROOM_AVAILABILITY_STATUS.AVAILABLE || Number(room.cleaning_status) !== ROOM_CLEANING_STATUS.CLEAN) {
        let reason = "";
        if(room.is_available !== ROOM_AVAILABILITY_STATUS.AVAILABLE) reason = `Room not available (Status: ${ROOM_AVAILABILITY_STATUS_TEXT[Number(room.is_available)]})`;
        else if (Number(room.cleaning_status) !== ROOM_CLEANING_STATUS.CLEAN) reason = `Room not clean (Status: ${ROOM_CLEANING_STATUS_TEXT[Number(room.cleaning_status)]})`;
        toast({ title: `Cannot ${mode}`, description: reason, variant: "default" });
        return;
    }

    setSelectedRoomForBooking(room);
    setBookingMode(mode);

    const roomRateIds = Array.isArray(room.hotel_rate_id) ? room.hotel_rate_id.map(id => Number(id)) : [];
    const applicable = allBranchActiveRates.filter(branchRate => roomRateIds.includes(branchRate.id));
    setApplicableRatesForBookingDialog(applicable);

    bookingForm.reset({
      ...defaultBookingFormValues,
      client_payment_method: 'Cash',
      selected_rate_id: applicable.length > 0 ? applicable[0].id : undefined,
      is_advance_reservation: mode === 'reserve', // Set based on mode
    });

    // Explicitly trigger useEffect for date defaults if reserving
    if (mode === 'reserve') {
        bookingForm.setValue('is_advance_reservation', true, { shouldDirty: true, shouldValidate: true });
    } else { // For 'book' mode, ensure advance reservation is false and dates are null
        bookingForm.setValue('is_advance_reservation', false, { shouldDirty: true, shouldValidate: true });
        bookingForm.setValue('reserved_check_in_datetime', null);
        bookingForm.setValue('reserved_check_out_datetime', null);
    }
    setIsBookingDialogOpen(true);
  };

 const handleBookingSubmit = async (data: StaffBookingCreateData) => {
     if (!selectedRoomForBooking || !staffUserId || !tenantId || !branchId || !data.selected_rate_id || !bookingMode) {
        toast({ title: "Submission Error", description: `Booking details incomplete. Ensure a room and rate are selected and staff details are available.`, variant: "destructive" });
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
        updateRoomInLocalState(result.updatedRoomData); // Optimistic update
        // fetchRoomsAndRatesData(); // Optionally re-fetch all for consistency, or rely on local update
      } else {
        toast({ title: `${bookingMode === 'book' ? "Booking" : "Reservation"} Failed`, description: result.message || "An unknown error occurred.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: `An unexpected error occurred during ${bookingMode}. ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenTransactionInfoDialog = useCallback(async (transactionId: number | null) => {
    if (!transactionId || !tenantId || !branchId) {
        toast({ title: "Info", description: "No active transaction ID found for this room.", variant: "default" });
        setTransactionDetails(null);
        setIsTransactionDetailsDialogOpen(false);
        return;
    }
    setIsSubmitting(true); // Use for loading indicator in dialog
    try {
        const transaction = await getActiveTransactionForRoom(transactionId, tenantId, branchId);
        const roomAssociated = rooms.find(r => r.transaction_id === transactionId);

        if (transaction && roomAssociated) {
            setTransactionDetails(transaction);
            const isAdvance = !!transaction.reserved_check_in_datetime;

            if (Number(transaction.status) === TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN) {
                setEditingModeForDialog('notesOnly');
                notesEditForm.reset({ notes: transaction.notes || '' });
            } else if (Number(transaction.status) === TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM || Number(transaction.status) === TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM ) { // Added NO_ROOM
                setEditingModeForDialog('fullReservation');
                const roomRateIds = Array.isArray(roomAssociated.hotel_rate_id) ? roomAssociated.hotel_rate_id.map(id => Number(id)) : [];
                setApplicableRatesForBookingDialog(allBranchActiveRates.filter(branchRate => roomRateIds.includes(branchRate.id)));

                reservationEditForm.reset({
                    client_name: transaction.client_name,
                    selected_rate_id: transaction.hotel_rate_id || undefined,
                    client_payment_method: transaction.client_payment_method || undefined,
                    notes: transaction.notes || '',
                    is_advance_reservation: isAdvance,
                    reserved_check_in_datetime: formatDateTimeForInput(transaction.reserved_check_in_datetime),
                    reserved_check_out_datetime: formatDateTimeForInput(transaction.reserved_check_out_datetime),
                    is_paid: transaction.is_paid ?? TRANSACTION_PAYMENT_STATUS.UNPAID,
                    tender_amount_at_checkin: transaction.tender_amount ?? null,
                });
            } else {
                setEditingModeForDialog(null); // View only for other statuses
                notesEditForm.reset({ notes: transaction.notes || '' }); // Still allow notes view
            }
            setIsEditNotesMode(false); // Reset notes edit mode toggle
            setIsTransactionDetailsDialogOpen(true);
        } else {
            toast({ title: "No Details", description: `Transaction (ID: ${transactionId}) not found or not in an active/reserved state.`, variant: "default" });
            setTransactionDetails(null); setEditingModeForDialog(null);
        }
    } catch (error) {
        toast({ title: "Error", description: `Failed to fetch transaction details. ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
        setTransactionDetails(null); setEditingModeForDialog(null);
    } finally {
        setIsSubmitting(false);
    }
  }, [tenantId, branchId, toast, notesEditForm, reservationEditForm, rooms, allBranchActiveRates]);


  const handleUpdateTransactionDetails = async (data: TransactionUpdateNotesData | TransactionReservedUpdateData) => {
    if (!transactionDetails || !transactionDetails.id || !tenantId || !branchId || !staffUserId) { toast({ title: "Error", description: "Missing details to update.", variant: "destructive" }); return; }
    setIsSubmitting(true);
    try {
        let result;
        if (editingModeForDialog === 'notesOnly' && 'notes' in data) {
             result = await updateTransactionNotes(transactionDetails.id, data.notes, tenantId, branchId);
        } else if (editingModeForDialog === 'fullReservation' && 'client_name' in data && Number(transactionDetails.status) === TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM) {
             result = await updateReservedTransactionDetails(transactionDetails.id, data as TransactionReservedUpdateData, tenantId, branchId, staffUserId);
        } else {
            toast({ title: "Error", description: "Invalid editing mode or data for update.", variant: "destructive" });
            setIsSubmitting(false); return;
        }

        if (result.success && result.updatedTransaction) {
            toast({ title: "Success", description: "Transaction details updated." });
            const updatedTx = result.updatedTransaction;
            setTransactionDetails(prev => prev ? {...prev, ...updatedTx} : updatedTx as Transaction);

            const roomToUpdate = rooms.find(r => r.transaction_id === updatedTx.id);
            if (roomToUpdate) {
                 updateRoomInLocalState({
                    id: roomToUpdate.id,
                    active_transaction_client_name: updatedTx.client_name,
                    active_transaction_rate_name: updatedTx.rate_name,
                    // ... other fields on room that might change due to tx update
                });
            }

            if (editingModeForDialog === 'notesOnly') {
                notesEditForm.reset({ notes: updatedTx.notes || '' });
                setIsEditNotesMode(false); // Close edit notes mode
            } else if (editingModeForDialog === 'fullReservation') {
                reservationEditForm.reset({
                 client_name: updatedTx.client_name,
                 selected_rate_id: updatedTx.hotel_rate_id || undefined,
                 client_payment_method: updatedTx.client_payment_method || undefined,
                 notes: updatedTx.notes || '',
                 is_advance_reservation: !!updatedTx.reserved_check_in_datetime,
                 reserved_check_in_datetime: formatDateTimeForInput(updatedTx.reserved_check_in_datetime),
                 reserved_check_out_datetime: formatDateTimeForInput(updatedTx.reserved_check_out_datetime),
                 is_paid: updatedTx.is_paid ?? TRANSACTION_PAYMENT_STATUS.UNPAID,
                 tender_amount_at_checkin: updatedTx.tender_amount ?? null,
                });
            }
        } else { toast({ title: "Update Failed", description: result.message || "Could not update details.", variant: "destructive" }); }
    } catch (error) {
        toast({ title: "Error", description: `Unexpected error updating details. ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
    } finally { setIsSubmitting(false); }
  };


  const handleOpenCheckoutConfirmation = useCallback(async (room: HotelRoom) => {
    if (!tenantId || !branchId || !staffUserId) { toast({ title: "Error", description: "Tenant, branch, or staff information missing.", variant: "destructive" }); return; }
    if (room.is_available !== ROOM_AVAILABILITY_STATUS.OCCUPIED) { toast({ title: "Action Not Allowed", description: "Room is not currently occupied.", variant: "default" }); return; }

    const transactionIdToCheckout = room.transaction_id;
    if (!transactionIdToCheckout) { toast({ title: "Action Not Allowed", description: "No transaction linked for checkout.", variant: "default" }); return; }

    setIsSubmitting(true);
    try {
        const transaction = await getActiveTransactionForRoom(transactionIdToCheckout, tenantId, branchId);
        if (!transaction || Number(transaction.status) !== TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN) {
            toast({ title: "Action Not Allowed", description: `Transaction (ID: ${transactionIdToCheckout}) is not in a valid state for checkout. Current status: ${transaction?.status ? TRANSACTION_LIFECYCLE_STATUS_TEXT[Number(transaction.status)] : 'Unknown'}`, variant: "default"});
            setIsSubmitting(false); return;
        }
        setRoomForActionConfirmation(room);
        setActiveTransactionIdForAction(transactionIdToCheckout); // Renamed state variable
        setTransactionDetailsForCheckout(transaction);

        const check_in_time_str = transaction.check_in_time;
        if (!check_in_time_str) {
            toast({ title: "Error", description: "Transaction check-in time is missing.", variant: "destructive"});
            setIsSubmitting(false); return;
        }
        const check_in_time_dt = parseISO(check_in_time_str.replace(' ', 'T'));
        const current_time_dt = new Date();
        setCurrentTimeForCheckoutModal(format(current_time_dt, 'yyyy-MM-dd hh:mm:ss aa'));

        const diffMillisecondsVal = differenceInMilliseconds(current_time_dt, check_in_time_dt);
        let hours_used_calc = Math.ceil(diffMillisecondsVal / (1000 * 60 * 60));
        if (hours_used_calc <= 0) hours_used_calc = 1; // Minimum 1 hour charge
        setDisplayHoursUsedForCheckoutModal(hours_used_calc > 0 ? `${hours_used_calc} hr(s)` : 'Less than 1 hr');

        let bill = parseFloat(transaction.rate_price?.toString() || '0');
        const rate_hours_val = transaction.rate_hours ?? 0;
        const rate_excess_hour_price_val = transaction.rate_excess_hour_price ? parseFloat(transaction.rate_excess_hour_price.toString()) : null;

        if (rate_hours_val > 0 && hours_used_calc > rate_hours_val && rate_excess_hour_price_val && rate_excess_hour_price_val > 0) {
            bill = parseFloat(transaction.rate_price?.toString() || '0') + (hours_used_calc - rate_hours_val) * rate_excess_hour_price_val;
        } else if (rate_hours_val > 0 && hours_used_calc <= rate_hours_val) {
            // Use base rate if within standard hours
            bill = parseFloat(transaction.rate_price?.toString() || '0');
        } else if (rate_hours_val === 0 && rate_excess_hour_price_val && rate_excess_hour_price_val > 0) { // Purely hourly rate (rate_hours might be 0)
            bill = hours_used_calc * rate_excess_hour_price_val;
        }
        // Ensure minimum charge is base rate if rateHours are defined (and not 0)
        if (rate_hours_val > 0 && bill < parseFloat(transaction.rate_price?.toString() || '0')) {
            bill = parseFloat(transaction.rate_price?.toString() || '0');
        }


        setCurrentBillForCheckout(bill);
        // Set default tender amount: if transaction was paid upfront, use its tender amount; else use current bill or 0
        const initialTender = transaction.is_paid === TRANSACTION_PAYMENT_STATUS.PAID
            ? (transaction.tender_amount ?? bill ?? 0)
            : (bill ?? 0);

        checkoutForm.reset({
            tender_amount: initialTender,
            payment_method: transaction.client_payment_method || 'Cash'
        });
        setIsCheckoutModalOpen(true);
    } catch (error) {
        toast({ title: "Error", description: `Failed to fetch details for checkout. ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
    } finally { setIsSubmitting(false); }
  }, [tenantId, branchId, staffUserId, toast, checkoutForm, rooms, allBranchActiveRates]);


  const handleConfirmCheckout = async (formData: CheckoutFormData) => {
      if (!activeTransactionIdForAction || !roomForActionConfirmation || !staffUserId || !tenantId || !branchId || currentBillForCheckout === null) {
          toast({ title: "Checkout Error", description: "Missing critical details for checkout.", variant: "destructive" }); return;
      }
      const tenderAmountValue = parseFloat(String(formData.tender_amount));
       if (isNaN(tenderAmountValue) || tenderAmountValue < currentBillForCheckout) {
          checkoutForm.setError("tender_amount", { type: "manual", message: "Tender amount must be a valid number and at least equal to the total bill."}); return;
      }
      setIsSubmitting(true);
      try {
          const result = await checkOutGuestAndFreeRoom( activeTransactionIdForAction, staffUserId, tenantId, branchId, roomForActionConfirmation.id, tenderAmountValue, formData.payment_method );
          if (result.success && result.updatedRoomData && result.transaction) {
              toast({ title: "Success", description: result.message || "Guest checked out successfully." });
              updateRoomInLocalState(result.updatedRoomData);
              setIsCheckoutModalOpen(false);
              // Optionally fetchRoomsAndRatesData(); to ensure full consistency if other changes happened
          } else { toast({ title: "Check-out Failed", description: result.message || "Could not complete check-out.", variant: "destructive" }); }
      } catch (error) {
          toast({ title: "Error", description: `An unexpected error occurred during check-out. ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
      } finally { setIsSubmitting(false); }
  };


  const handleOpenCheckInReservedConfirmation = useCallback(async (room: HotelRoom) => {
    if (!tenantId || !branchId || !staffUserId) { toast({ title: "Error", description: "Required details missing for check-in.", variant: "destructive" }); return; }
    if (room.is_available !== ROOM_AVAILABILITY_STATUS.RESERVED) { toast({ title: "Action Not Allowed", description: "Room is not currently reserved.", variant: "default" }); return; }

    const transactionIdToProcess = room.transaction_id;
    if (!transactionIdToProcess) { toast({ title: "Action Not Allowed", description: "No transaction linked to this reserved room.", variant: "default" }); return; }
    if (Number(room.cleaning_status) !== ROOM_CLEANING_STATUS.CLEAN) { toast({ title: "Action Not Allowed", description: `Room must be clean to check-in. Current: ${ROOM_CLEANING_STATUS_TEXT[Number(room.cleaning_status)]}.`, variant: "default" }); return; }

    setIsSubmitting(true);
    const transaction = await getActiveTransactionForRoom(transactionIdToProcess, tenantId, branchId);
    setIsSubmitting(false);

    if (!transaction || Number(transaction.status) !== TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM) { // Expects RESERVATION_WITH_ROOM (2) for check-in
        toast({ title: "Action Not Allowed", description: `Reservation (ID: ${transactionIdToProcess}) is not in a check-in ready state. Current status: ${transaction?.status ? TRANSACTION_LIFECYCLE_STATUS_TEXT[Number(transaction.status)] : 'Unknown'}`, variant: "default"}); return;
    }

    setRoomForActionConfirmation(room);
    setActiveTransactionIdForAction(transactionIdToProcess);
    setIsCheckInReservedConfirmOpen(true);
  }, [tenantId, branchId, staffUserId, toast]);

  const handleConfirmCheckInReservedGuest = async () => {
    if (!activeTransactionIdForAction || !roomForActionConfirmation || !staffUserId || !tenantId || !branchId) {
        toast({ title: "Check-in Error", description: "Required information for reserved check-in is missing.", variant: "destructive" });
        setIsCheckInReservedConfirmOpen(false); return;
    }
    setIsSubmitting(true);
    try {
        const result = await checkInReservedGuest( activeTransactionIdForAction, roomForActionConfirmation.id, tenantId, branchId, staffUserId );
        if (result.success && result.updatedRoomData) {
            toast({ title: "Success", description: result.message || "Reserved guest checked in." });
            updateRoomInLocalState(result.updatedRoomData);
             if (isTransactionDetailsDialogOpen && transactionDetails?.id === activeTransactionIdForAction) {
                setIsTransactionDetailsDialogOpen(false); setTransactionDetails(null);
            }
            // fetchRoomsAndRatesData(); // Optionally re-fetch
        } else { toast({ title: "Check-in Failed", description: result.message || "An error occurred.", variant: "destructive" }); }
    } catch (error) {
        toast({ title: "Error", description: `An unexpected error occurred during reserved check-in. ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
    } finally { setIsSubmitting(false); setIsCheckInReservedConfirmOpen(false); }
  };

  const handleOpenCancelReservationConfirmation = useCallback(async (room: HotelRoom) => {
    if (!tenantId || !branchId ) { toast({ title: "Error", description: "Required details missing.", variant: "destructive" }); return; }
    if (room.is_available !== ROOM_AVAILABILITY_STATUS.RESERVED) { toast({ title: "Action Not Allowed", description: "Room is not currently reserved for cancellation.", variant: "default" }); return; }

    const transactionIdToCancel = room.transaction_id;
    if (!transactionIdToCancel) { toast({ title: "Action Not Allowed", description: "No transaction linked to cancel.", variant: "default" }); return; }

    setIsSubmitting(true);
    const transaction = await getActiveTransactionForRoom(transactionIdToCancel, tenantId, branchId);
    setIsSubmitting(false);
    if (!transaction || Number(transaction.status) !== TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM) { // Can only cancel if it's a 'Reservation with Room'
        toast({ title: "Action Not Allowed", description: `Reservation (ID: ${transactionIdToCancel}) is not in a cancellable state. Current status: ${transaction?.status ? TRANSACTION_LIFECYCLE_STATUS_TEXT[Number(transaction.status)] : 'Unknown'}`, variant: "default"}); return;
    }
    setRoomForActionConfirmation(room);
    setActiveTransactionIdForAction(transactionIdToCancel);
    setIsCancelReservationConfirmOpen(true);
  }, [tenantId, branchId, toast]);

  const handleConfirmCancelReservation = async () => {
    if (!activeTransactionIdForAction || !roomForActionConfirmation || !tenantId || !branchId) {
        toast({ title: "Cancellation Error", description: "Missing required data for cancellation.", variant: "destructive" });
        setIsCancelReservationConfirmOpen(false); return;
    }
    setIsSubmitting(true);
    try {
        const result = await cancelReservation(activeTransactionIdForAction, tenantId, branchId, roomForActionConfirmation.id);
        if (result.success && result.updatedRoomData) {
            toast({ title: "Success", description: "Reservation cancelled successfully." });
            updateRoomInLocalState(result.updatedRoomData);
            if (isTransactionDetailsDialogOpen && transactionDetails?.id === activeTransactionIdForAction) {
                 setIsTransactionDetailsDialogOpen(false); setTransactionDetails(null);
            }
            // fetchRoomsAndRatesData(); // Optionally re-fetch
        } else { toast({ title: "Cancellation Failed", description: result.message || "Could not cancel reservation.", variant: "destructive" }); }
    } catch (error) {
        toast({ title: "Error", description: `An unexpected error occurred during cancellation. ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
    } finally { setIsSubmitting(false); setIsCancelReservationConfirmOpen(false); }
  };


  const handleOpenNotesOnlyModal = async (room: HotelRoom) => {
      if (!room.transaction_id || !tenantId || !branchId) {
          toast({ title: "Info", description: "No active transaction to view notes for.", variant: "default" });
          return;
      }
      setIsSubmitting(true);
      try {
          const transaction = await getActiveTransactionForRoom(room.transaction_id, tenantId, branchId);
          if (transaction) {
              notesEditForm.reset({ notes: transaction.notes || '' });
              setSelectedRoomForBooking(room); // Re-using this state for context, might need a dedicated one
              setCurrentNotesForDisplay(transaction.notes); // Also set notes for display
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

  const calculatedChange = useMemo(() => {
    const tenderStr = String(tenderAmountWatch);
    const tenderFloat = parseFloat(tenderStr); // Coerce to number
    const billFloat = currentBillForCheckout;

    if (billFloat !== null && !isNaN(tenderFloat) && tenderFloat >= 0) {
        const change = tenderFloat - billFloat;
        return change;
    }
    return null;
  }, [tenderAmountWatch, currentBillForCheckout]);


  const getRoomRateNameForCard = (room: HotelRoom): string => {
    if (room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED || room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED) {
        if (room.active_transaction_rate_name) {
            return room.active_transaction_rate_name;
        }
    }
    // For available rooms, try to find the name of the first associated rate
    if (Array.isArray(room.hotel_rate_id) && room.hotel_rate_id.length > 0) {
        const firstRateId = Number(room.hotel_rate_id[0]);
        const rate = allBranchActiveRates.find(r => r.id === firstRateId);
        return rate ? rate.name : `Rate ID: ${firstRateId}`;
    }
    return 'N/A';
  };

  const activeRoomsForMainDisplay = rooms.filter(room => String(room.status) === HOTEL_ENTITY_STATUS.ACTIVE);

  if (isLoadingRooms && isLoadingRates && activeRoomsForMainDisplay.length === 0 && allBranchActiveRates.length === 0) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2 text-muted-foreground">Loading room statuses and rates...</p></div>;
  }
  if (!branchId && !isLoadingRooms && !isLoadingRates) {
    return <Card><CardHeader><div className="flex items-center space-x-2"><BedDouble className="h-6 w-6 text-primary" /><DialogTitle>Room Status</DialogTitle></div><ShadCardDescription>View current room availability.</ShadCardDescription></CardHeader><CardContent><p className="text-muted-foreground">No branch assigned or selected. Please ensure your staff account is assigned to a branch.</p></CardContent></Card>;
  }

  return (
    <div className="space-y-6">
      <CleaningStatusUpdateCard
        allRoomsForBranch={rooms} // Pass all rooms fetched for the branch
        staffUserId={staffUserId}
        tenantId={tenantId}
        branchId={branchId}
        onStatusUpdateSuccess={(updatedRoom) => {
          // When quick status is updated, reflect it in the main `rooms` state
          updateRoomInLocalState({
            id: updatedRoom.id,
            cleaning_status: updatedRoom.cleaning_status,
            cleaning_notes: updatedRoom.cleaning_notes,
          });
        }}
        onRefreshDataNeeded={fetchRoomsAndRatesData}
        isLoadingParent={isLoadingRooms}
      />

      <div className="my-4">
        <Label htmlFor="roomSearchInput" className="sr-only">Search Rooms</Label>
        <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
                id="roomSearchInput"
                type="search"
                placeholder="Search by Room Name or Code..."
                value={roomSearchTerm}
                onChange={(e) => setRoomSearchTerm(e.target.value)}
                className="pl-8 w-full sm:w-1/3"
            />
        </div>
      </div>


      <Accordion type="multiple" defaultValue={[]} className="w-full space-y-1">
        {Object.entries(groupedRooms).map(([floor, floorRooms]) => {
          const activeFloorRooms = floorRooms.filter(r => String(r.status) === HOTEL_ENTITY_STATUS.ACTIVE);
          if (activeFloorRooms.length === 0) return null;

          const availableCleanCount = activeFloorRooms.filter(room => room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && Number(room.cleaning_status) === ROOM_CLEANING_STATUS.CLEAN).length;
          const occupiedCount = activeFloorRooms.filter(room => room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED).length;
          const reservedCount = activeFloorRooms.filter(room => room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED).length;
          const availableNotCleanCount = activeFloorRooms.filter(room => room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && Number(room.cleaning_status) !== ROOM_CLEANING_STATUS.CLEAN && Number(room.cleaning_status) !== ROOM_CLEANING_STATUS.OUT_OF_ORDER).length;
          const outOfOrderCount = activeFloorRooms.filter(room => Number(room.cleaning_status) === ROOM_CLEANING_STATUS.OUT_OF_ORDER).length;


          return (
            <AccordionItem value={floor} key={`status-floor-${floor}`} className="border bg-card rounded-md shadow-sm">
               <AccordionTrigger className={cn( "text-xl font-semibold px-4 py-3 hover:no-underline sticky top-0 z-10 shadow-sm bg-inherit" )}>
                <div className="flex justify-between items-center w-full">
                  <span>Floor: {floor.replace('Ground Floor / Other', 'Ground Floor / Unspecified')}</span>
                    <span className="text-xs font-normal ml-4 flex items-center space-x-3">
                        <span className="flex items-center text-green-600" title="Available & Clean"><CheckCircle2 className="h-4 w-4 mr-1" />{availableCleanCount}</span>
                        <span className="flex items-center text-orange-600" title="Occupied"><UserIcon className="h-4 w-4 mr-1" />{occupiedCount}</span>
                        <span className="flex items-center text-yellow-600" title="Reserved"><CalendarClock className="h-4 w-4 mr-1" />{reservedCount}</span>
                        <span className="flex items-center text-slate-500" title="Available (Needs Cleaning/Inspection)"><Wrench className="h-4 w-4 mr-1" />{availableNotCleanCount}</span>
                        <span className="flex items-center text-red-500" title="Out of Order"><AlertTriangle className="h-4 w-4 mr-1" />{outOfOrderCount}</span>
                    </span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4 pt-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {activeFloorRooms.map(room => {
                    let cardHeaderBgClass = "bg-card";
                    let cardHeaderTextClass = "text-card-foreground";
                    let cardHeaderDescClass = "text-muted-foreground";
                    let statusDotColor = "bg-gray-400";
                    let displayedAvailabilityText = ROOM_AVAILABILITY_STATUS_TEXT[Number(room.is_available)];


                    if (room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE) {
                        if (Number(room.cleaning_status) === ROOM_CLEANING_STATUS.CLEAN) {
                            cardHeaderBgClass = "bg-green-500"; cardHeaderTextClass = "text-white"; cardHeaderDescClass = "text-green-100"; statusDotColor = "bg-green-500"; displayedAvailabilityText = "Available";
                        } else {
                            cardHeaderBgClass = "bg-slate-400"; cardHeaderTextClass = "text-white"; cardHeaderDescClass = "text-slate-100"; statusDotColor = "bg-slate-500"; displayedAvailabilityText = ROOM_CLEANING_STATUS_TEXT[Number(room.cleaning_status)];
                        }
                    } else if (room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED) {
                        cardHeaderBgClass = "bg-orange-500"; cardHeaderTextClass = "text-white"; cardHeaderDescClass = "text-orange-100"; statusDotColor = "bg-orange-500"; displayedAvailabilityText = "Occupied";
                    } else if (room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED) {
                        cardHeaderBgClass = "bg-yellow-500"; cardHeaderTextClass = "text-white"; cardHeaderDescClass = "text-yellow-100"; statusDotColor = "bg-yellow-500"; displayedAvailabilityText = "Reserved";
                    }


                    return (
                      <Card
                        key={room.id}
                        className={cn("shadow-md hover:shadow-lg transition-shadow duration-200 flex flex-col border")}
                      >
                        <CardHeader className={cn("p-3 rounded-t-lg relative", cardHeaderBgClass)}>
                           <div className="flex justify-between items-start">
                            <div>
                              <CardTitle className={cn("text-lg", cardHeaderTextClass)}>{room.room_name}</CardTitle>
                              <ShadCardDescription className={cn("text-xs", cardHeaderDescClass)}>
                                Room # : {room.room_code}
                              </ShadCardDescription>
                            </div>
                            {room.is_available !== ROOM_AVAILABILITY_STATUS.AVAILABLE && room.transaction_id && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className={cn( "h-7 w-7 p-1 absolute top-2 right-2", cardHeaderTextClass.includes("text-white") ? "text-white hover:bg-white/20" : "text-muted-foreground hover:bg-accent" )}
                                  title="View Transaction Notes"
                                  onClick={(e) => { e.stopPropagation(); handleOpenNotesOnlyModal(room); }}
                                >
                                  <Info className="h-4 w-4" />
                                </Button>
                             )}
                          </div>
                        </CardHeader>
                        <CardContent className="p-3 pt-2 flex-grow flex flex-col justify-between">
                          <div className="mb-3 space-y-1">
                            <div className="flex items-center space-x-2">
                                <span className={cn("h-3 w-3 rounded-full", statusDotColor, room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && Number(room.cleaning_status) === ROOM_CLEANING_STATUS.CLEAN && "animate-pulse")}></span>
                                <span className={cn("text-sm font-medium",
                                    room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && Number(room.cleaning_status) === ROOM_CLEANING_STATUS.CLEAN ? "text-green-700 dark:text-green-300" :
                                    room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && Number(room.cleaning_status) !== ROOM_CLEANING_STATUS.CLEAN && Number(room.cleaning_status) !== ROOM_CLEANING_STATUS.OUT_OF_ORDER ? "text-slate-700 dark:text-slate-300" :
                                    room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && Number(room.cleaning_status) === ROOM_CLEANING_STATUS.OUT_OF_ORDER ? "text-red-700 dark:text-red-400" :
                                    room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED ? "text-orange-700 dark:text-orange-300" :
                                    room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED ? "text-yellow-600 dark:text-yellow-400" :
                                    "text-gray-600 dark:text-gray-400"
                                )}>{displayedAvailabilityText}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">Rate: {getRoomRateNameForCard(room)}</p>
                             {(room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED || room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED) && room.active_transaction_client_name && (
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
                            {room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED && room.transaction_id && room.active_transaction_check_in_time && (
                                <p className="text-xs text-muted-foreground">
                                For: {format(parseISO(room.active_transaction_check_in_time.replace(' ', 'T')), 'yyyy-MM-dd hh:mm:ss aa')}
                                </p>
                            )}
                             <div className="flex items-center text-xs mt-1">
                                <Wrench size={12} className="inline mr-1 text-muted-foreground" />
                                <span className="text-muted-foreground">{ROOM_CLEANING_STATUS_TEXT[Number(room.cleaning_status)]}</span>
                            </div>
                             {room.cleaning_notes && (room.is_available !== ROOM_AVAILABILITY_STATUS.AVAILABLE || Number(room.cleaning_status) === ROOM_CLEANING_STATUS.OUT_OF_ORDER) && (
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
                                            variant="default" size="sm" className="w-full"
                                            onClick={(e) => { e.stopPropagation(); handleOpenBookingDialog(room, 'book'); }}
                                            disabled={Number(room.cleaning_status) !== ROOM_CLEANING_STATUS.CLEAN || !Array.isArray(room.hotel_rate_id) || room.hotel_rate_id.length === 0 || isSubmitting}
                                            title={Number(room.cleaning_status) !== ROOM_CLEANING_STATUS.CLEAN ? `Room not clean: ${ROOM_CLEANING_STATUS_TEXT[Number(room.cleaning_status)]}` : (!Array.isArray(room.hotel_rate_id) || room.hotel_rate_id.length === 0) ? "No rates assigned" : "Book this room"}
                                        >
                                           {(Number(room.cleaning_status) !== ROOM_CLEANING_STATUS.CLEAN || !Array.isArray(room.hotel_rate_id) || room.hotel_rate_id.length === 0) && <Ban className="mr-2 h-4 w-4" />}
                                            <LogIn className="mr-2 h-4 w-4" /> Book Room
                                        </Button>
                                        <Button
                                            variant="outline" size="sm" className="w-full"
                                            onClick={(e) => { e.stopPropagation(); handleOpenBookingDialog(room, 'reserve'); }}
                                            disabled={Number(room.cleaning_status) !== ROOM_CLEANING_STATUS.CLEAN || !Array.isArray(room.hotel_rate_id) || room.hotel_rate_id.length === 0 || isSubmitting}
                                            title={ Number(room.cleaning_status) !== ROOM_CLEANING_STATUS.CLEAN ? `Room not clean: ${ROOM_CLEANING_STATUS_TEXT[Number(room.cleaning_status)]}` : (!Array.isArray(room.hotel_rate_id) || room.hotel_rate_id.length === 0) ? "No rates assigned" : "Reserve this room" }
                                        >
                                            {(Number(room.cleaning_status) !== ROOM_CLEANING_STATUS.CLEAN || !Array.isArray(room.hotel_rate_id) || room.hotel_rate_id.length === 0) && <Ban className="mr-2 h-4 w-4" />}
                                            <CalendarPlus className="mr-2 h-4 w-4" /> Reserve Room
                                        </Button>
                                    </>
                                )}
                                {room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED && (
                                     <div className="flex flex-col space-y-2 w-full">
                                        <Button variant="outline" size="sm" className="w-full" title="View Transaction Details"
                                            onClick={(e) => { e.stopPropagation(); if (room.transaction_id) handleOpenTransactionInfoDialog(room.transaction_id); else toast({ title: "Info", description: "No transaction ID linked.", variant: "default" }); }}>
                                            <Info className="mr-2 h-4 w-4" /> View Details
                                        </Button>
                                        <Button
                                          variant="destructive"
                                          size="sm"
                                          className="w-full"
                                          title="Check-out Guest"
                                          onClick={(e) => { e.stopPropagation(); handleOpenCheckoutConfirmation(room); }}
                                          disabled={!room.transaction_id || isSubmitting}
                                        >
                                            <LogOutIcon className="mr-2 h-4 w-4" /> Check-out
                                        </Button>
                                    </div>
                                )}
                                {room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED && (
                                    <div className="flex flex-col space-y-2 w-full">
                                        <Button variant="outline" size="sm" className="w-full" title="View Reservation Details"
                                            onClick={(e) => { e.stopPropagation(); if (room.transaction_id) handleOpenTransactionInfoDialog(room.transaction_id); else toast({title: "Info", description:"No linked transaction.", variant:"default"}); }}>
                                            <Info className="mr-2 h-4 w-4" /> View Details
                                        </Button>
                                         <Button variant="default" size="sm" className="w-full" title="Check-in Reserved Guest"
                                            disabled={Number(room.cleaning_status) !== ROOM_CLEANING_STATUS.CLEAN || !room.transaction_id || isSubmitting}
                                            onClick={(e) => { e.stopPropagation(); if (room.transaction_id) handleOpenCheckInReservedConfirmation(room); }}>
                                            {(Number(room.cleaning_status) !== ROOM_CLEANING_STATUS.CLEAN) && <Ban className="mr-2 h-4 w-4" />}
                                            <LogIn className="mr-2 h-4 w-4" /> Check-in Reserved
                                        </Button>
                                         <Button variant="destructive" size="sm" className="w-full" title="Cancel this Reservation"
                                            onClick={(e) => { e.stopPropagation(); if (room.transaction_id) handleOpenCancelReservationConfirmation(room); }}
                                            disabled={!room.transaction_id || isSubmitting}>
                                            <Ban className="mr-2 h-4 w-4" /> Cancel Reservation
                                        </Button>
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

      <Dialog open={isBookingDialogOpen} onOpenChange={(isOpen) => {
          if (!isOpen) {
            setSelectedRoomForBooking(null); setBookingMode(null); bookingForm.reset(defaultBookingFormValues); setApplicableRatesForBookingDialog([]);
          } setIsBookingDialogOpen(isOpen);
      }}>
        <DialogContent className="sm:max-w-md p-1 flex flex-col max-h-[85vh]">
          <DialogHeader className="p-2 border-b">
            <DialogTitle>
                {bookingMode === 'book' ? `Book Room: ${selectedRoomForBooking?.room_name} (${selectedRoomForBooking?.room_code})` :
                 bookingMode === 'reserve' ? `Reserve Room: ${selectedRoomForBooking?.room_name} (${selectedRoomForBooking?.room_code})` :
                 'Room Action'}
            </DialogTitle>
          </DialogHeader>
          <Form {...bookingForm}>
            <form onSubmit={bookingForm.handleSubmit(handleBookingSubmit)} className="flex flex-col flex-grow overflow-hidden bg-card rounded-md">
              <div className="flex-grow space-y-3 p-1 overflow-y-auto"> {/* Changed py-2 px-3 to p-1 */}
                <FormField control={bookingForm.control} name="client_name" render={({ field }) => (
                  <FormItem><FormLabel>Client Name *</FormLabel><FormControl><Input placeholder="John Doe" {...field} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={bookingForm.control} name="selected_rate_id" render={({ field }) => (
                  <FormItem>
                      <FormLabel>Select Rate *</FormLabel>
                      <Select onValueChange={(value) => field.onChange(value ? parseInt(value, 10) : undefined)} value={field.value?.toString()} disabled={applicableRatesForBookingDialog.length === 0} >
                          <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder={ applicableRatesForBookingDialog.length === 0 ? "No rates for this room" : "Select a rate"} /></SelectTrigger></FormControl>
                          <SelectContent>{applicableRatesForBookingDialog.map(rate => (<SelectItem key={rate.id} value={rate.id.toString()}>{rate.name} (₱{Number(rate.price).toFixed(2)} for {rate.hours}hr/s)</SelectItem>))}</SelectContent>
                      </Select><FormMessage />
                  </FormItem>
                )} />
                <FormField control={bookingForm.control} name="client_payment_method" render={({ field }) => (
                  <FormItem><FormLabel>Payment Method *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? undefined} defaultValue="Cash">
                      <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder="Select payment method" /></SelectTrigger></FormControl>
                      <SelectContent>
                          <SelectItem value="Cash">Cash</SelectItem><SelectItem value="Card">Card</SelectItem><SelectItem value="Online Payment">Online Payment</SelectItem><SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select><FormMessage />
                  </FormItem>
                )} />
                 <FormField control={bookingForm.control} name="is_paid"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-3 shadow-sm w-[90%]">
                      <FormControl><Checkbox checked={field.value === TRANSACTION_PAYMENT_STATUS.PAID} onCheckedChange={(checked) => {
                        field.onChange(checked ? TRANSACTION_PAYMENT_STATUS.PAID : TRANSACTION_PAYMENT_STATUS.UNPAID);
                        if (!checked) { bookingForm.setValue('tender_amount_at_checkin', null); } }} /></FormControl>
                      <div className="space-y-1 leading-none"><FormLabel>Paid at Check-in/Reservation?</FormLabel></div>
                    </FormItem>
                  )}
                />
                {watchIsPaidInBookingForm === TRANSACTION_PAYMENT_STATUS.PAID && (
                  <FormField control={bookingForm.control} name="tender_amount_at_checkin"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tender Amount *</FormLabel>
                        <FormControl><Input type="text" placeholder="0.00" {...field} value={field.value === null || field.value === undefined ? "" : String(field.value)}
                            onChange={(e) => { const val = e.target.value; if (val === "" || /^[0-9]*\.?[0-9]{0,2}$/.test(val)) { field.onChange(val === "" ? null : parseFloat(val)); } }}
                            className="w-[90%]" /></FormControl><FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                {bookingMode === 'reserve' && (
                    <FormField control={bookingForm.control} name="is_advance_reservation"
                        render={({ field }) => (
                            <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-3 shadow-sm w-[90%]">
                                <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange}/></FormControl>
                                <div className="space-y-1 leading-none"><FormLabel>This is an Advance Future Reservation?</FormLabel></div>
                            </FormItem>
                        )}
                    />
                )}
                {bookingMode === 'reserve' && watchIsAdvanceReservationInBookingForm && (
                    <>
                        <FormField control={bookingForm.control} name="reserved_check_in_datetime" render={({ field }) => (
                            <FormItem><FormLabel>Reserved Check-in Date & Time *</FormLabel><FormControl><Input type="datetime-local" {...field} value={field.value || ""} className="w-[90%]" min={format(new Date(), "yyyy-MM-dd'T'HH:mm")} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={bookingForm.control} name="reserved_check_out_datetime" render={({ field }) => (
                            <FormItem><FormLabel>Reserved Check-out Date & Time *</FormLabel><FormControl><Input type="datetime-local" {...field} value={field.value || ""} className="w-[90%]" min={bookingForm.getValues('reserved_check_in_datetime') || format(new Date(), "yyyy-MM-dd'T'HH:mm")} /></FormControl><FormMessage /></FormItem>
                        )} />
                    </>
                )}
                <FormField control={bookingForm.control} name="notes" render={({ field }) => (
                  <FormItem><FormLabel>Notes (Optional)</FormLabel><FormControl><Textarea placeholder="Any special requests or notes..." {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
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

      {/* Transaction Details Modal - for Occupied and Reserved rooms */}
      <Dialog open={isTransactionDetailsDialogOpen} onOpenChange={(open) => {
          if (!open) {
              setIsTransactionDetailsDialogOpen(false); setTransactionDetails(null); setEditingModeForDialog(null);
              notesEditForm.reset(defaultNotesEditFormValues); reservationEditForm.reset(defaultReservationEditFormValues);
          } else { setIsTransactionDetailsDialogOpen(open); }
      }}>
        <DialogContent className="sm:max-w-md p-1 flex flex-col max-h-[85vh]">
          <DialogHeader className="p-2 border-b">
            <DialogTitle>Transaction Details</DialogTitle>
            {transactionDetails?.room_name && <ShadCardDescription className="text-xs">Room: {transactionDetails.room_name} ({transactionDetails.rate_name || 'Rate N/A'})</ShadCardDescription>}
          </DialogHeader>
          {transactionDetails ? (
            <div className="flex-grow flex flex-col overflow-hidden">
                 <div className="flex-grow space-y-3 p-1 overflow-y-auto"> {/* Changed py-2 px-3 to p-1 */}
                    <p><strong>Client:</strong> {transactionDetails.client_name}</p>
                    <p><strong>Status:</strong> {transactionDetails.status !== null ? TRANSACTION_LIFECYCLE_STATUS_TEXT[transactionDetails.status] || 'Unknown' : 'N/A'}</p>
                    <p><strong>Payment Status:</strong> {transactionDetails.is_paid !== null && transactionDetails.is_paid !== undefined ? TRANSACTION_PAYMENT_STATUS_TEXT[transactionDetails.is_paid] : 'N/A'}</p>
                    {transactionDetails.check_in_time && (<p><strong>Checked-in On:</strong> {format(parseISO(transactionDetails.check_in_time.replace(' ', 'T')), 'yyyy-MM-dd hh:mm:ss aa')}</p>)}
                    {transactionDetails.reserved_check_in_datetime && (<p><strong>Reserved Check-in:</strong> {format(parseISO(transactionDetails.reserved_check_in_datetime.replace(' ', 'T')), 'yyyy-MM-dd hh:mm:ss aa')}</p>)}
                    {transactionDetails.check_out_time && (<p><strong>Checked-out On:</strong> {format(parseISO(transactionDetails.check_out_time.replace(' ', 'T')), 'yyyy-MM-dd hh:mm:ss aa')}</p>)}
                    {transactionDetails.hours_used !== undefined && transactionDetails.hours_used !== null && (<p><strong>Hours Used:</strong> {transactionDetails.hours_used}</p>)}
                    {transactionDetails.total_amount !== undefined && transactionDetails.total_amount !== null && (<p><strong>Total Amount:</strong> ₱{Number(transactionDetails.total_amount).toFixed(2)}</p>)}
                    {transactionDetails.tender_amount !== undefined && transactionDetails.tender_amount !== null && (<p><strong>Tender Amount:</strong> ₱{Number(transactionDetails.tender_amount).toFixed(2)}</p>)}
                    {transactionDetails.is_paid === TRANSACTION_PAYMENT_STATUS.PAID && typeof transactionDetails.tender_amount === 'number' && typeof transactionDetails.total_amount === 'number' && transactionDetails.tender_amount >= transactionDetails.total_amount && (
                        <p><strong>Change Given:</strong> ₱{(transactionDetails.tender_amount - transactionDetails.total_amount).toFixed(2)}</p>
                    )}


                    {editingModeForDialog === 'fullReservation' && Number(transactionDetails.status) === TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM ? (
                        <Form {...reservationEditForm}>
                        <form onSubmit={reservationEditForm.handleSubmit(data => handleUpdateTransactionDetails(data as TransactionReservedUpdateData))} className="space-y-3 pt-3 border-t mt-3">
                            <FormField control={reservationEditForm.control} name="client_name" render={({ field }) => (
                            <FormItem><FormLabel>Client Name *</FormLabel><FormControl><Input {...field} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={reservationEditForm.control} name="selected_rate_id" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Select Rate *</FormLabel>
                                    <Select onValueChange={(value) => field.onChange(value ? parseInt(value, 10) : undefined)} value={field.value?.toString()} disabled={applicableRatesForBookingDialog.length === 0} >
                                        <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder={applicableRatesForBookingDialog.length === 0 ? "No rates available" : "Select a rate"} /></SelectTrigger></FormControl>
                                        <SelectContent>{applicableRatesForBookingDialog.map(rate => (<SelectItem key={rate.id} value={rate.id.toString()}>{rate.name} (₱{Number(rate.price).toFixed(2)} for {rate.hours}hr/s)</SelectItem>))}</SelectContent>
                                    </Select><FormMessage />
                                </FormItem>
                            )}/>
                            <FormField control={reservationEditForm.control} name="client_payment_method" render={({ field }) => (
                            <FormItem><FormLabel>Payment Method</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value ?? undefined} >
                                <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder="Select payment method" /></SelectTrigger></FormControl>
                                <SelectContent><SelectItem value="Cash">Cash</SelectItem><SelectItem value="Card">Card</SelectItem><SelectItem value="Online Payment">Online Payment</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent>
                                </Select><FormMessage />
                            </FormItem>
                            )} />
                             <FormField control={reservationEditForm.control} name="is_paid"
                                render={({ field }) => (
                                    <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-3 shadow-sm w-[90%]">
                                    <FormControl><Checkbox checked={Number(field.value) === TRANSACTION_PAYMENT_STATUS.PAID || Number(field.value) === TRANSACTION_PAYMENT_STATUS.ADVANCE_PAID}
                                        onCheckedChange={(checked) => {
                                            const currentIsAdvance = reservationEditForm.getValues("is_advance_reservation");
                                            field.onChange(checked ? (currentIsAdvance ? TRANSACTION_PAYMENT_STATUS.ADVANCE_PAID : TRANSACTION_PAYMENT_STATUS.PAID) : TRANSACTION_PAYMENT_STATUS.UNPAID);
                                            if (!checked) { reservationEditForm.setValue('tender_amount_at_checkin', null); } }} /></FormControl>
                                    <div className="space-y-1 leading-none"><FormLabel>Paid in Advance?</FormLabel></div>
                                    </FormItem>
                                )} />
                            {(Number(watchIsPaidForEditReservation) === TRANSACTION_PAYMENT_STATUS.PAID || Number(watchIsPaidForEditReservation) === TRANSACTION_PAYMENT_STATUS.ADVANCE_PAID) && (
                                <FormField control={reservationEditForm.control} name="tender_amount_at_checkin"
                                    render={({ field }) => (
                                    <FormItem><FormLabel>Tender Amount *</FormLabel><FormControl><Input type="text" placeholder="0.00" {...field} value={field.value === null || field.value === undefined ? "" : String(field.value)}
                                            onChange={(e) => { const val = e.target.value; if (val === "" || /^[0-9]*\.?[0-9]{0,2}$/.test(val)) { field.onChange(val === "" ? null : parseFloat(val)); } }}
                                            className="w-[90%]" /></FormControl><FormMessage />
                                    </FormItem>
                                    )} />
                            )}
                            <FormField control={reservationEditForm.control} name="is_advance_reservation"
                                render={({ field }) => (
                                    <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-3 shadow-sm w-[90%]">
                                        <FormControl><Checkbox checked={field.value}
                                                onCheckedChange={(checkedBool) => {
                                                    field.onChange(checkedBool);
                                                    const currentIsPaid = reservationEditForm.getValues("is_paid");
                                                    if (Number(currentIsPaid) !== TRANSACTION_PAYMENT_STATUS.UNPAID) {
                                                        reservationEditForm.setValue("is_paid", checkedBool ? TRANSACTION_PAYMENT_STATUS.ADVANCE_PAID : TRANSACTION_PAYMENT_STATUS.PAID, { shouldValidate: true });
                                                    } }} /></FormControl>
                                        <div className="space-y-1 leading-none"><FormLabel>This is an Advance Future Reservation?</FormLabel></div>
                                    </FormItem>
                                )} />
                            {watchIsAdvanceReservationForEdit && (
                                <>
                                    <FormField control={reservationEditForm.control} name="reserved_check_in_datetime" render={({ field }) => (
                                            <FormItem><FormLabel>Reserved Check-in Date & Time *</FormLabel><FormControl><Input type="datetime-local" {...field} value={field.value || ""} className="w-[90%]" min={format(new Date(), "yyyy-MM-dd'T'HH:mm")} /></FormControl><FormMessage /></FormItem>
                                    )} />
                                    <FormField control={reservationEditForm.control} name="reserved_check_out_datetime" render={({ field }) => (
                                            <FormItem><FormLabel>Reserved Check-out Date & Time *</FormLabel><FormControl><Input type="datetime-local" {...field} value={field.value || ""} className="w-[90%]" min={reservationEditForm.getValues('reserved_check_in_datetime') || format(new Date(), "yyyy-MM-dd'T'HH:mm")} /></FormControl><FormMessage /></FormItem>
                                    )} />
                                </>
                            )}
                            <FormField control={reservationEditForm.control} name="notes" render={({ field }) => (
                            <FormItem><FormLabel>Notes</FormLabel><FormControl><Textarea {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
                            )} />
                            <div className="flex justify-end space-x-2 pt-2">
                                <Button type="submit" size="sm" disabled={isSubmitting || !reservationEditForm.formState.isValid}>{isSubmitting ? <Loader2 className="animate-spin h-3 w-3" /> : "Save Reservation Changes"}</Button>
                                <Button type="button" variant="outline" size="sm" onClick={() => { setEditingModeForDialog(null); reservationEditForm.reset(defaultReservationEditFormValues); if(transactionDetails) notesEditForm.reset({ notes: transactionDetails.notes || ''}); }}>Cancel Edit</Button>
                            </div>
                        </form>
                        </Form>
                    ) : (
                        <div className="pt-3 border-t mt-3 space-y-1">
                            <div className="flex justify-between items-center">
                                {isEditNotesMode ? null : <Label>Notes:</Label>}
                                {!isEditNotesMode && (Number(transactionDetails.status) === TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN || Number(transactionDetails.status) === TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM) && (
                                    <Button variant="ghost" size="sm" onClick={() => setIsEditNotesMode(true)}><Edit3 className="h-3 w-3 mr-1" /> Edit Notes</Button>
                                )}
                            </div>
                            {isEditNotesMode ? (
                                <Form {...notesEditForm}>
                                    <form onSubmit={notesEditForm.handleSubmit(data => handleUpdateTransactionDetails(data as TransactionUpdateNotesData))} className="space-y-3">
                                        <FormField control={notesEditForm.control} name="notes" render={({ field }) => (
                                        <FormItem><FormLabel className="sr-only">Notes</FormLabel><FormControl><Textarea {...field} value={field.value ?? ''} className="w-full" rows={3} placeholder="No notes yet."/></FormControl><FormMessage /></FormItem>
                                        )} />
                                        <div className="flex justify-end space-x-2">
                                            <Button type="submit" size="sm" disabled={isSubmitting || !notesEditForm.formState.isDirty}>{isSubmitting ? <Loader2 className="animate-spin h-3 w-3" /> : "Save Notes"}</Button>
                                            <Button type="button" variant="outline" size="sm" onClick={() => { setIsEditNotesMode(false); if(transactionDetails) notesEditForm.reset({ notes: transactionDetails.notes || ''}); }}>Cancel</Button>
                                        </div>
                                    </form>
                                </Form>
                            ) : (
                                <p className="text-muted-foreground whitespace-pre-wrap min-h-[40px] p-2 border rounded-md bg-accent/10">{transactionDetails.notes || "No notes yet."}</p>
                            )}
                        </div>
                    )}
                </div>
            </div>
          ) : <div className="p-2"><p className="py-4 text-muted-foreground">Loading details or no active transaction...</p></div>}
          <DialogFooter className="bg-card py-2 border-t px-3 sticky bottom-0 z-10 flex flex-row justify-between items-center">
             <div>
                {transactionDetails && (Number(transactionDetails.status) === TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM) && editingModeForDialog !== 'fullReservation' && (
                    <Button variant="destructive" size="sm"
                        onClick={(e) => { e.stopPropagation(); const originalRoom = rooms.find(r => r.transaction_id === transactionDetails.id);
                            if (transactionDetails.id && originalRoom) { handleOpenCancelReservationConfirmation(originalRoom); } else { toast({title: "Error", description: "Could not find transaction or room for cancellation.", variant: "destructive"}); }
                        }} disabled={isSubmitting}>
                        <Ban className="mr-2 h-4 w-4" /> Cancel Reservation
                    </Button>
                )}
             </div>
            <DialogClose asChild><Button variant="outline" onClick={() => { setIsTransactionDetailsDialogOpen(false); }}>Close</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Checkout Confirmation Dialog (uses AlertDialog) */}
      <Dialog open={isCheckoutModalOpen}
        onOpenChange={(openValue) => {
          if (!openValue) {
             setIsCheckoutModalOpen(false); setTransactionDetailsForCheckout(null); setCurrentBillForCheckout(null);
             setRoomForActionConfirmation(null); setActiveTransactionIdForAction(null); checkoutForm.reset(defaultCheckoutFormValues);
          } else { setIsCheckoutModalOpen(openValue); }
        }} >
        <DialogContent className="sm:max-w-md p-4">
            <DialogHeader className="border-b pb-3 mb-3">
                <DialogTitle className="text-xl">Confirm Check-out: {roomForActionConfirmation?.room_name}</DialogTitle>
                <ShadDialogDescription className="text-sm">Room #: {roomForActionConfirmation?.room_code}</ShadDialogDescription>
            </DialogHeader>
            {transactionDetailsForCheckout && currentBillForCheckout !== null && (
                 <div className="space-y-3 text-sm py-2">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-2 border rounded-md bg-muted/30">
                        <div><Label className="text-muted-foreground font-medium text-right block">Client:</Label></div> <div><span className="font-semibold">{transactionDetailsForCheckout.client_name}</span></div>
                        <div><Label className="text-muted-foreground font-medium text-right block">Checked-in:</Label></div> <div><span className="font-semibold">{transactionDetailsForCheckout.check_in_time ? format(parseISO(transactionDetailsForCheckout.check_in_time.replace(' ', 'T')), 'yyyy-MM-dd hh:mm:ss aa') : 'N/A'}</span></div>
                        <div><Label className="text-muted-foreground font-medium text-right block">Current Time:</Label></div> <div><span className="font-semibold">{currentTimeForCheckoutModal}</span></div>
                        <div><Label className="text-muted-foreground font-medium text-right block">Hours Stayed:</Label></div> <div><span className="font-semibold">{displayHoursUsedForCheckoutModal}</span></div>
                        <div><Label className="text-muted-foreground font-medium text-right block">Rate:</Label></div> <div><span className="font-semibold">{transactionDetailsForCheckout.rate_name || 'N/A'}</span></div>
                    </div>
                    <hr className="my-2 border-border"/>
                    <div className="flex justify-between items-center text-lg"><span className="font-semibold text-muted-foreground">Total Bill:</span> <span className="font-bold text-primary">₱{currentBillForCheckout.toFixed(2)}</span></div>

                    <Form {...checkoutForm}>
                        <form className="space-y-4 pt-3">
                             <FormField control={checkoutForm.control} name="payment_method" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Payment Method *</FormLabel>
                                    <Select onValueChange={field.onChange} defaultValue={field.value || "Cash"}>
                                    <FormControl><SelectTrigger><SelectValue placeholder="Select payment method" /></SelectTrigger></FormControl>
                                    <SelectContent><SelectItem value="Cash">Cash</SelectItem><SelectItem value="Card">Card</SelectItem><SelectItem value="Online Payment">Online Payment</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent>
                                    </Select><FormMessage />
                                </FormItem> )} />
                             <FormField control={checkoutForm.control} name="tender_amount" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-base">Tender Amount *</FormLabel>
                                        <FormControl><Input type="text" placeholder="0.00" {...field}
                                                onChange={(e) => {
                                                    const val = e.target.value;
                                                    // Allow empty string, numbers, and numbers with up to two decimal places
                                                    if (val === "" || /^[0-9]*\.?[0-9]{0,2}$/.test(val)) {
                                                        field.onChange(val); // Pass the string directly
                                                    }
                                                }}
                                                value={field.value === null || field.value === undefined ? "" : String(field.value)}
                                                className="w-full text-lg p-2 text-right" /></FormControl><FormMessage />
                                    </FormItem> )} />
                            {calculatedChange !== null && (
                                 <div className="flex justify-between items-center text-md pt-1">
                                    <span className="font-semibold text-muted-foreground">Change:</span>
                                    <span className={cn("font-bold", calculatedChange < 0 ? "text-destructive" : "text-foreground")}>{"₱" + calculatedChange.toFixed(2)}</span>
                                </div> )}
                            <DialogFooter className="sm:justify-between pt-4">
                                <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => {
                                    setIsCheckoutModalOpen(false);
                                    setTransactionDetailsForCheckout(null);
                                    setCurrentBillForCheckout(null);
                                    setRoomForActionConfirmation(null);
                                    setActiveTransactionIdForAction(null);
                                    checkoutForm.reset(defaultCheckoutFormValues);
                                }}>Cancel</Button>
                                <Button type="button" onClick={checkoutForm.handleSubmit(handleConfirmCheckout)} className="w-full sm:w-auto"
                                    disabled={isSubmitting || currentBillForCheckout === null || parseFloat(String(tenderAmountWatch ?? '0')) < currentBillForCheckout || isNaN(parseFloat(String(tenderAmountWatch ?? '0')))} >
                                    {isSubmitting ? <Loader2 className="animate-spin h-4 w-4" /> : "Confirm Check-out & Pay"}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </div> )}
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog for Cancelling a Reservation */}
      <AlertDialog open={isCancelReservationConfirmOpen} onOpenChange={(open) => { if(!open) { setRoomForActionConfirmation(null); setActiveTransactionIdForAction(null); } setIsCancelReservationConfirmOpen(open); }}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <ShadAlertDialogTitleConfirm>Confirm Cancellation</ShadAlertDialogTitleConfirm>
            <ShadAlertDialogDescriptionConfirm>
              Are you sure you want to cancel this reservation for room {roomForActionConfirmation?.room_name || transactionDetails?.room_name || ' (unassigned)'}? This action cannot be undone.
            </ShadAlertDialogDescriptionConfirm>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={(e) => { e.stopPropagation(); setIsCancelReservationConfirmOpen(false); setRoomForActionConfirmation(null); setActiveTransactionIdForAction(null); }}>No</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.stopPropagation(); handleConfirmCancelReservation(); }} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="animate-spin" /> : "Yes, Cancel"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmation Dialog for Checking In a Reserved Guest */}
      <AlertDialog open={isCheckInReservedConfirmOpen} onOpenChange={(open) => { if(!open) { setRoomForActionConfirmation(null); setActiveTransactionIdForAction(null); } setIsCheckInReservedConfirmOpen(open); }}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <ShadAlertDialogTitleConfirm>Confirm Reserved Check-in</ShadAlertDialogTitleConfirm>
            <ShadAlertDialogDescriptionConfirm>Are you sure you want to check-in the guest for room {roomForActionConfirmation?.room_name}? This will mark the room as occupied.</ShadAlertDialogDescriptionConfirm>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={(e) => { e.stopPropagation(); setIsCheckInReservedConfirmOpen(false); setRoomForActionConfirmation(null); setActiveTransactionIdForAction(null); }}>No</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.stopPropagation(); handleConfirmCheckInReservedGuest(); }} disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : "Yes, Check-in"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Notes Only Modal (triggered by info icon in card header) */}
      <Dialog open={isNotesOnlyModalOpen} onOpenChange={(isOpen) => {
          if (!isOpen) {
              setSelectedRoomForBooking(null); // Or a dedicated state for notes modal room
              setCurrentNotesForDisplay(null);
              notesEditForm.reset({notes: ''});
          }
          setIsNotesOnlyModalOpen(isOpen);
      }}>
        <DialogContent className="sm:max-w-md p-3">
          <DialogHeader className="border-b pb-2 mb-2">
            <DialogTitle>Transaction Notes for Room: {selectedRoomForBooking?.room_name}</DialogTitle>
            <ShadDialogDescription>Room Code: {selectedRoomForBooking?.room_code}</ShadDialogDescription>
          </DialogHeader>
          <div className="py-4 max-h-[60vh] overflow-y-auto">
            <pre className="whitespace-pre-wrap text-sm bg-muted p-3 rounded-md min-h-[100px]">
                {currentNotesForDisplay || "No notes recorded for this transaction."}
            </pre>
          </div>
          <DialogFooter className="sm:justify-end">
             <DialogClose asChild><Button variant="outline" onClick={() => setIsNotesOnlyModalOpen(false)}>Close</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Available Rooms Overview Modal */}
      <Dialog open={showAvailableRoomsOverview} onOpenChange={(open) => {
          if(!open) onCloseAvailableRoomsOverview();
      }}>
        <DialogContent className="sm:max-w-2xl md:max-w-3xl lg:max-w-4xl p-0 flex flex-col max-h-[90vh] overflow-hidden">
          <DialogHeader className="p-3 border-b">
            <DialogTitle className="flex items-center">
                <Eye className="mr-2 h-5 w-5 text-primary" /> Available Rooms Overview
            </DialogTitle>
          </DialogHeader>
          <div className="flex-grow overflow-y-auto p-4">
            {isLoadingRooms ? (
              <div className="flex justify-center items-center h-32"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2">Loading rooms...</p></div>
            ) : rooms.filter(r => r.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && String(r.status) === HOTEL_ENTITY_STATUS.ACTIVE && Number(r.cleaning_status) === ROOM_CLEANING_STATUS.CLEAN).length === 0 ? (
              <p className="text-center text-muted-foreground py-10">No rooms are currently available and clean.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {rooms
                  .filter(r => r.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && String(r.status) === HOTEL_ENTITY_STATUS.ACTIVE && Number(r.cleaning_status) === ROOM_CLEANING_STATUS.CLEAN)
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
                            <span className="text-muted-foreground">{ROOM_CLEANING_STATUS_TEXT[Number(room.cleaning_status)]}</span>
                        </div>
                         <Button variant="outline" size="sm" className="w-full mt-2"
                          onClick={(e) => { e.stopPropagation(); setSelectedRoomForRatesDisplay(room); setIsRoomRatesDetailModalOpen(true); }}>
                          <Tags className="mr-2 h-4 w-4" /> View Associated Rates
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
              </div>
            )}
          </div>
          <DialogFooter className="bg-card py-3 border-t px-4 sm:justify-end">
            <Button variant="outline" onClick={onCloseAvailableRoomsOverview}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Room-Specific Rates Detail Modal */}
      <Dialog open={isRoomRatesDetailModalOpen} onOpenChange={(open) => {
        if (!open) { setSelectedRoomForRatesDisplay(null); } setIsRoomRatesDetailModalOpen(open);
      }}>
        <DialogContent className="sm:max-w-md p-3">
            <DialogHeader className="border-b pb-2 mb-2">
                 <DialogTitle>Rates for Room: {selectedRoomForRatesDisplay?.room_name}</DialogTitle>
                 <ShadDialogDescription className="text-sm text-muted-foreground">Room #: {selectedRoomForRatesDisplay?.room_code}</ShadDialogDescription>
            </DialogHeader>
            <div className="py-4 max-h-[60vh] overflow-y-auto">
                {selectedRoomForRatesDisplay && Array.isArray(selectedRoomForRatesDisplay.hotel_rate_id) && selectedRoomForRatesDisplay.hotel_rate_id.length > 0 ? (
                    (() => {
                        const applicableRates = allBranchActiveRates
                            .filter(rate => selectedRoomForRatesDisplay!.hotel_rate_id!.includes(rate.id))
                            .sort((a, b) => a.name.localeCompare(b.name)); // Sort rates by name
                        if (applicableRates.length > 0) {
                            return (
                                <div className="space-y-2">
                                    {applicableRates.map(rate => (
                                        <div key={rate.id} className="bg-muted/30 rounded p-2 border-b last:border-b-0 text-sm">
                                            <p className="font-medium">{rate.name}</p>
                                            <p className="text-xs text-muted-foreground">Price: ₱{Number(rate.price).toFixed(2)} | Hours: {rate.hours}</p>
                                        </div> ))}
                                </div> );
                        }
                        return <p className="text-muted-foreground">No active rates currently assigned or found for this room.</p>;
                    })()
                ) : ( <p className="text-muted-foreground">No rates assigned to this room.</p> )}
            </div>
            <DialogFooter className="sm:justify-end">
                 <DialogClose asChild><Button variant="outline" onClick={() => { setIsRoomRatesDetailModalOpen(false); setSelectedRoomForRatesDisplay(null); }}>Close</Button></DialogClose>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

