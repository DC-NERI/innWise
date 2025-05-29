
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card, CardContent, CardHeader, CardTitle,
  CardDescription as ShadCardDescription,
} from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription as ShadDialogDescriptionAliased, // Aliased for clarity
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription as ShadAlertDialogDescriptionConfirm, // Aliased for clarity
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle as ShadAlertDialogTitleConfirm,
} from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BedDouble, Loader2, Info, User as UserIcon, LogOutIcon, LogIn, CalendarClock, Edit3, Ban, CheckCircle2, CalendarPlus, Tags, Eye, XCircle, RefreshCw, Search, AlertTriangle, Wrench } from "lucide-react";
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
import { format, parseISO, addHours, differenceInMilliseconds, isValid } from 'date-fns';
import CleaningStatusUpdateCard from './room-status/CleaningStatusUpdateCard';
import CleaningNotesModal from './room-status/CleaningNotesModal';


const defaultBookingFormValues: StaffBookingCreateData = {
  client_name: '',
  selected_rate_id: undefined,
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
  selected_rate_id: undefined,
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

  const [isRoomRatesDetailModalOpen, setIsRoomRatesDetailModalOpen] = useState(false);
  const [selectedRoomForRatesDisplay, setSelectedRoomForRatesDisplay] = useState<HotelRoom | null>(null);

  const [isNotesOnlyModalOpen, setIsNotesOnlyModalOpen] = useState(false);
  const [currentNotesForDisplay, setCurrentNotesForDisplay] = useState<string | null | undefined>(null);

  const [isLoadingRooms, setIsLoadingRooms] = useState(true);
  const [isLoadingRates, setIsLoadingRates] = useState(true);
  const [defaultOpenFloors, setDefaultOpenFloors] = useState<string[]>([]);
  const [roomSearchTerm, setRoomSearchTerm] = useState('');

  // State for Cleaning Status Update Card and Modal
  const [isCleaningNotesModalOpen, setIsCleaningNotesModalOpen] = useState(false);
  const [selectedRoomForCleaningUpdate, setSelectedRoomForCleaningUpdate] = useState<HotelRoom | null>(null);
  const [targetCleaningStatusForModal, setTargetCleaningStatusForModal] = useState<number | null>(null); // Store as number
  const [isSubmittingCleaningAction, setIsSubmittingCleaningAction] = useState(false);


  const { toast } = useToast();

  const bookingForm = useForm<StaffBookingCreateData>({
    resolver: zodResolver(staffBookingCreateSchema),
    defaultValues: defaultBookingFormValues,
  });
  const watchIsPaidInBookingForm = useWatch({ control: bookingForm.control, name: 'is_paid' });
  const watchIsAdvanceReservationInBookingForm = useWatch({ control: bookingForm.control, name: 'is_advance_reservation' });

  const notesForm = useForm<TransactionUpdateNotesData>({
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

  const cleaningUpdateForm = useForm<RoomCleaningStatusUpdateData>({
    resolver: zodResolver(roomCleaningStatusAndNotesUpdateSchema),
    defaultValues: {
      cleaning_status: ROOM_CLEANING_STATUS.CLEAN,
      cleaning_notes: '',
    },
  });


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
        // Sort rooms within each floor by room_code
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
  }, [roomSearchTerm]); // Added roomSearchTerm as a dependency


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
      setDefaultOpenFloors([]); // Keep floors closed by default after fetch

    } catch (error) {
      toast({ title: "Error", description: `Could not fetch room statuses or rates. ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
    } finally {
      setIsLoading(false); setIsLoadingRooms(false); setIsLoadingRates(false);
    }
  }, [tenantId, branchId, toast, roomSearchTerm]); // Added roomSearchTerm

  useEffect(() => {
    if (tenantId && branchId) {
      fetchRoomsAndRatesData();
    }
  }, [fetchRoomsAndRatesData, tenantId, branchId]);

  // Re-filter and re-group if search term changes, but don't re-fetch
  useEffect(() => {
      if (isLoadingRooms) return; // Don't re-group if initial load is happening

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
  }, [roomSearchTerm, rooms, isLoadingRooms]);

  const formatDateTimeForInput = (dateString?: string | null): string => {
    if (!dateString) return "";
    try {
      const parsableDateString = dateString.includes('T') ? dateString : dateString.replace(' ', 'T');
      if (!isValid(parseISO(parsableDateString))) return "";
      return format(parseISO(parsableDateString), "yyyy-MM-dd'T'HH:mm");
    } catch (e) {
      return "";
    }
  };

  const getDefaultCheckInDateTimeString = (): string => {
    const now = new Date();
    // Default to 2 PM today
    const checkIn = setMilliseconds(setSeconds(setMinutes(setHours(now, 14), 0), 0), 0);
    return format(checkIn, "yyyy-MM-dd'T'HH:mm");
  };

  const getDefaultCheckOutDateTimeString = (checkInDateString?: string | null): string => {
      let baseDate = new Date();
      if (checkInDateString) {
          try {
              const parsableDateString = checkInDateString.includes('T') ? checkInDateString : checkInDateString.replace(' ', 'T');
              const parsedCheckIn = parseISO(parsableDateString);
              if (isValid(parsedCheckIn)) { // Check if date is valid
                  baseDate = parsedCheckIn;
              }
          } catch (e) {
            // If parsing fails, baseDate remains new Date()
          }
      } else {
        // Default to 2 PM today if no check-in provided
        baseDate = setMilliseconds(setSeconds(setMinutes(setHours(baseDate, 14), 0), 0), 0);
      }
      // Default to 12 PM next day
      const checkOut = setMilliseconds(setSeconds(setMinutes(setHours(addDays(baseDate, 1), 12),0),0),0);
      return format(checkOut, "yyyy-MM-dd'T'HH:mm");
  };

  // Effect for booking form date defaults
  useEffect(() => {
    if (isBookingDialogOpen && watchIsAdvanceReservationInBookingForm) {
        if (!bookingForm.getValues('reserved_check_in_datetime')) {
            bookingForm.setValue('reserved_check_in_datetime', getDefaultCheckInDateTimeString(), { shouldValidate: true, shouldDirty: true });
        }
        const currentCheckIn = bookingForm.getValues('reserved_check_in_datetime');
        if (!bookingForm.getValues('reserved_check_out_datetime')) {
             bookingForm.setValue('reserved_check_out_datetime', getDefaultCheckOutDateTimeString(currentCheckIn), { shouldValidate: true, shouldDirty: true });
        }
    } else if (isBookingDialogOpen && !watchIsAdvanceReservationInBookingForm) { // If not advance, clear the date fields
        bookingForm.setValue('reserved_check_in_datetime', null, { shouldValidate: true });
        bookingForm.setValue('reserved_check_out_datetime', null, { shouldValidate: true });
    }
  }, [watchIsAdvanceReservationInBookingForm, bookingForm, isBookingDialogOpen]);

  // Effect for reservation edit form date defaults
  useEffect(() => {
      if (isTransactionDetailsDialogOpen && editingModeForDialog === 'fullReservation' && watchIsAdvanceReservationForEdit) {
          if (!reservationEditForm.getValues('reserved_check_in_datetime')) {
               reservationEditForm.setValue('reserved_check_in_datetime', getDefaultCheckInDateTimeString(), { shouldValidate: true, shouldDirty: true });
          }
          const currentCheckIn = reservationEditForm.getValues('reserved_check_in_datetime');
          if (!reservationEditForm.getValues('reserved_check_out_datetime')) {
               reservationEditForm.setValue('reserved_check_out_datetime', getDefaultCheckOutDateTimeString(currentCheckIn), { shouldValidate: true, shouldDirty: true });
          }
      } else if (isTransactionDetailsDialogOpen && editingModeForDialog === 'fullReservation' && !watchIsAdvanceReservationForEdit) {
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
    const defaultRateId = applicable.length > 0 ? applicable[0].id : undefined;

    bookingForm.reset({
      ...defaultBookingFormValues,
      client_payment_method: 'Cash', // Sensible default
      selected_rate_id: defaultRateId,
      is_advance_reservation: mode === 'reserve',
    });

    // Trigger useEffect for date defaults if reserving
    if (mode === 'reserve') {
        bookingForm.setValue('is_advance_reservation', true, { shouldDirty: true, shouldValidate: true });
        if (!bookingForm.getValues('reserved_check_in_datetime')) { // Set default if not already set
            bookingForm.setValue('reserved_check_in_datetime', getDefaultCheckInDateTimeString());
        }
        if (!bookingForm.getValues('reserved_check_out_datetime')) {
            bookingForm.setValue('reserved_check_out_datetime', getDefaultCheckOutDateTimeString(bookingForm.getValues('reserved_check_in_datetime')));
        }
    } else {
        bookingForm.setValue('is_advance_reservation', false, { shouldDirty: true, shouldValidate: true });
        bookingForm.setValue('reserved_check_in_datetime', null); // Clear for non-advance
        bookingForm.setValue('reserved_check_out_datetime', null);
    }
    setIsBookingDialogOpen(true);
  };

 const handleBookingSubmit = async (data: StaffBookingCreateData) => {
     if (!selectedRoomForBooking || !staffUserId || !tenantId || !branchId || !data.selected_rate_id || !bookingMode) {
        toast({ title: "Submission Error", description: `Booking details incomplete. Ensure a room and rate are selected and staff details are available. Room: ${selectedRoomForBooking?.room_name}, Rate: ${data.selected_rate_id}, Staff: ${staffUserId}, Mode: ${bookingMode}`, variant: "destructive" });
        return;
    }
    setIsSubmitting(true);
    try {
      let result;
      const apiData = { ...data, selected_rate_id: Number(data.selected_rate_id) }; // Ensure rate ID is number
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
        toast({ title: `${bookingMode === 'book' ? "Booking" : "Reservation"} Failed`, description: result.message || "An unknown error occurred.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: `An unexpected error occurred during ${bookingMode}. ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleViewDetails = useCallback(async (room: HotelRoom) => {
    if (!tenantId || !branchId || !staffUserId) {
      toast({ title: "Error", description: "User or branch information is missing.", variant: "destructive" });
      return;
    }
    if (!room.transaction_id) {
      toast({ title: "Info", description: "No active transaction ID found for this room to view details.", variant: "default" });
      setTransactionDetails(null);
      setIsTransactionDetailsDialogOpen(false);
      return;
    }

    setIsSubmitting(true); // Use for loading indicator
    try {
      const transaction = await getActiveTransactionForRoom(room.transaction_id, tenantId, branchId);
      if (transaction) {
        setTransactionDetails(transaction);
        const roomForTx = rooms.find(r => r.transaction_id === transaction.id);

        if (Number(transaction.status) === TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN) {
          setEditingModeForDialog('notesOnly');
          notesForm.reset({ notes: transaction.notes || '' });
        } else if (Number(transaction.status) === TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM) {
          setEditingModeForDialog('fullReservation');
          const roomRateIds = Array.isArray(roomForTx?.hotel_rate_id) ? roomForTx.hotel_rate_id.map(id => Number(id)) : [];
          setApplicableRatesForBookingDialog(allBranchActiveRates.filter(branchRate => roomRateIds.includes(branchRate.id)));

          reservationEditForm.reset({
            client_name: transaction.client_name,
            selected_rate_id: transaction.hotel_rate_id || undefined,
            client_payment_method: transaction.client_payment_method || undefined,
            notes: transaction.notes || '',
            is_advance_reservation: !!transaction.reserved_check_in_datetime, // Set based on if date exists
            reserved_check_in_datetime: formatDateTimeForInput(transaction.reserved_check_in_datetime),
            reserved_check_out_datetime: formatDateTimeForInput(transaction.reserved_check_out_datetime),
            is_paid: transaction.is_paid !== null ? transaction.is_paid : TRANSACTION_PAYMENT_STATUS.UNPAID,
            tender_amount_at_checkin: transaction.tender_amount ?? null,
          });
        } else {
          setEditingModeForDialog(null); // View only for other states
          notesForm.reset({ notes: transaction.notes || '' });
        }
        setIsTransactionDetailsDialogOpen(true);
      } else {
        toast({ title: "No Details", description: `Transaction (ID: ${room.transaction_id}) not found or not in an expected active/reserved state.`, variant: "default" });
        setTransactionDetails(null); setEditingModeForDialog(null);
      }
    } catch (error) {
      toast({ title: "Error", description: `Failed to fetch transaction details. ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
      setTransactionDetails(null); setEditingModeForDialog(null);
    } finally {
      setIsSubmitting(false);
    }
  }, [tenantId, branchId, staffUserId, toast, notesForm, reservationEditForm, allBranchActiveRates, rooms]);


  const handleUpdateNotes = async (data: TransactionUpdateNotesData) => {
    if (!transactionDetails || !transactionDetails.id || !tenantId || !branchId || !staffUserId) { toast({ title: "Error", description: "Missing details to update notes.", variant: "destructive" }); return; }
    setIsSubmitting(true);
    try {
        const result = await updateTransactionNotes(transactionDetails.id, data.notes, tenantId, branchId);
        if (result.success && result.updatedTransaction) {
            toast({ title: "Success", description: "Transaction notes updated." });
            setTransactionDetails(prev => prev ? {...prev, notes: result.updatedTransaction!.notes, updated_at: result.updatedTransaction!.updated_at} : null);
            notesForm.reset({ notes: result.updatedTransaction.notes || '' });
            // No direct room card visual update needed for notes only
        } else { toast({ title: "Update Failed", description: result.message || "Could not update notes.", variant: "destructive" }); }
    } catch (error) {
        toast({ title: "Error", description: `Unexpected error updating notes. ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
    } finally { setIsSubmitting(false); }
  };

  const handleReservationEditSubmit = async (data: TransactionReservedUpdateData) => {
    if (!transactionDetails || !transactionDetails.id || !tenantId || !branchId || !staffUserId) { toast({ title: "Error", description: "Missing details for reservation update.", variant: "destructive" }); return; }
    setIsSubmitting(true);
    try {
        const result = await updateReservedTransactionDetails(transactionDetails.id, data, tenantId, branchId, staffUserId);
        if (result.success && result.updatedTransaction) {
            toast({ title: "Success", description: "Reservation details updated." });
            setTransactionDetails(result.updatedTransaction);
            const roomToUpdate = rooms.find(r => r.transaction_id === result.updatedTransaction!.id);
            if (roomToUpdate) {
                 updateRoomInLocalState({
                    id: roomToUpdate.id,
                    active_transaction_client_name: result.updatedTransaction.client_name,
                    active_transaction_rate_name: result.updatedTransaction.rate_name,
                    active_transaction_check_in_time: result.updatedTransaction.reserved_check_in_datetime || result.updatedTransaction.check_in_time, // Prioritize reserved time
                    active_transaction_rate_hours: result.updatedTransaction.rate_hours,
                 });
            }
            setIsTransactionDetailsDialogOpen(false);
        } else { toast({ title: "Update Failed", description: result.message || "Could not update reservation.", variant: "destructive" }); }
    } catch (error) {
        toast({ title: "Error", description: `Unexpected error updating reservation. ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
    } finally { setIsSubmitting(false); }
  };


  const handleOpenCheckoutConfirmation = useCallback(async (roomToCheckout: HotelRoom) => {
    if (!tenantId || !branchId || !staffUserId) { toast({ title: "Error", description: "Tenant, branch, or staff information missing.", variant: "destructive" }); return; }
    if (roomToCheckout.is_available !== ROOM_AVAILABILITY_STATUS.OCCUPIED) { toast({ title: "Action Not Allowed", description: "Room is not currently occupied.", variant: "default" }); return; }

    const transactionIdToCheckout = roomToCheckout.transaction_id;
    if (!transactionIdToCheckout) { toast({ title: "Action Not Allowed", description: "No transaction linked for checkout.", variant: "default" }); return; }

    setIsSubmitting(true);
    try {
        const transaction = await getActiveTransactionForRoom(transactionIdToCheckout, tenantId, branchId);
        if (!transaction || Number(transaction.status) !== TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN) {
            const currentStatusText = transaction?.status !== null && transaction?.status !== undefined ? TRANSACTION_LIFECYCLE_STATUS_TEXT[Number(transaction.status)] : 'Unknown';
            toast({ title: "Action Not Allowed", description: `Transaction (ID: ${transactionIdToCheckout}) is not in a valid state for checkout. Current status: ${currentStatusText}`, variant: "default"});
            setIsSubmitting(false); return;
        }
        setRoomForActionConfirmation(roomToCheckout);
        setActiveTransactionIdForAction(transactionIdToCheckout);
        setTransactionDetailsForCheckout(transaction);

        const check_in_time_str = transaction.check_in_time;
        if (!check_in_time_str) {
            toast({ title: "Error", description: "Transaction check-in time is missing.", variant: "destructive"});
            setIsSubmitting(false); return;
        }
        const check_in_time_dt = parseISO(check_in_time_str.replace(' ', 'T')); // Ensure 'T' separator
        const current_time_dt = new Date();
        setCurrentTimeForCheckoutModal(format(current_time_dt, 'yyyy-MM-dd hh:mm:ss aa'));

        const diffMillisecondsVal = differenceInMilliseconds(current_time_dt, check_in_time_dt);
        let hours_used_calc = Math.ceil(diffMillisecondsVal / (1000 * 60 * 60));
        if (hours_used_calc <= 0) hours_used_calc = 1;
        setDisplayHoursUsedForCheckoutModal(hours_used_calc > 0 ? `${hours_used_calc} hr(s)` : 'Less than 1 hr');

        let bill = parseFloat(transaction.rate_price?.toString() || '0');
        const rate_hours_val = transaction.rate_hours ?? 0;
        const rate_excess_hour_price_val = transaction.rate_excess_hour_price ? parseFloat(transaction.rate_excess_hour_price.toString()) : null;

        if (rate_hours_val > 0 && hours_used_calc > rate_hours_val && rate_excess_hour_price_val && rate_excess_hour_price_val > 0) {
            bill = (transaction.rate_price || 0) + (hours_used_calc - rate_hours_val) * rate_excess_hour_price_val;
        } else if (rate_hours_val > 0 && hours_used_calc <= rate_hours_val) {
            bill = transaction.rate_price || 0;
        } else if (rate_hours_val === 0 && rate_excess_hour_price_val && rate_excess_hour_price_val > 0) { // Purely hourly rate
            bill = hours_used_calc * rate_excess_hour_price_val;
        }
        // Ensure minimum charge is base rate if rateHours are defined
        if (rate_hours_val > 0 && bill < (transaction.rate_price || 0)) {
            bill = transaction.rate_price || 0;
        }

        setCurrentBillForCheckout(bill);

        // Set default tender amount: existing tender if any, else the current bill, else 0
        const defaultTender = transaction.tender_amount ?? bill ?? 0;

        checkoutForm.reset({
            tender_amount: defaultTender,
            payment_method: transaction.client_payment_method || 'Cash'
        });
        setIsCheckoutModalOpen(true);
    } catch (error) {
        toast({ title: "Error", description: `Failed to fetch details for checkout. ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
    } finally { setIsSubmitting(false); }
  }, [tenantId, branchId, staffUserId, toast, checkoutForm, rooms]);


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
          } else { toast({ title: "Check-out Failed", description: result.message || "Could not complete check-out.", variant: "destructive" }); }
      } catch (error) {
          toast({ title: "Error", description: `An unexpected error occurred during check-out. ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
      } finally { setIsSubmitting(false); }
  };


  const handleOpenCheckInReservedConfirmation = useCallback(async (roomToCheckIn: HotelRoom) => {
    if (!tenantId || !branchId || !staffUserId) { toast({ title: "Error", description: "Required details missing for check-in.", variant: "destructive" }); return; }
    if (roomToCheckIn.is_available !== ROOM_AVAILABILITY_STATUS.RESERVED) { toast({ title: "Action Not Allowed", description: "Room is not currently reserved.", variant: "default" }); return; }

    const transactionIdToProcess = roomToCheckIn.transaction_id;
    if (!transactionIdToProcess) { toast({ title: "Action Not Allowed", description: "No transaction linked to this reserved room.", variant: "default" }); return; }
    if (Number(roomToCheckIn.cleaning_status) !== ROOM_CLEANING_STATUS.CLEAN) { toast({ title: "Action Not Allowed", description: `Room must be clean to check-in. Current: ${ROOM_CLEANING_STATUS_TEXT[Number(roomToCheckIn.cleaning_status)]}.`, variant: "default" }); return; }

    setIsSubmitting(true);
    const transaction = await getActiveTransactionForRoom(transactionIdToProcess, tenantId, branchId);
    setIsSubmitting(false);

    if (!transaction || Number(transaction.status) !== TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM) { // Expects status '2'
        const currentStatusText = transaction?.status !== null && transaction?.status !== undefined ? TRANSACTION_LIFECYCLE_STATUS_TEXT[Number(transaction.status)] : 'Unknown or not matching expected reserved status';
        toast({ title: "Action Not Allowed", description: `Reservation (ID: ${transactionIdToProcess}) is not in a check-in ready state. Current status: ${currentStatusText}`, variant: "default"}); return;
    }

    setRoomForActionConfirmation(roomToCheckIn);
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
        } else { toast({ title: "Check-in Failed", description: result.message || "An error occurred.", variant: "destructive" }); }
    } catch (error) {
        toast({ title: "Error", description: `An unexpected error occurred during reserved check-in. ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
    } finally { setIsSubmitting(false); setIsCheckInReservedConfirmOpen(false); }
  };

  const handleOpenCancelReservationConfirmation = useCallback(async (roomToCancel: HotelRoom) => {
    if (!tenantId || !branchId || !staffUserId) { toast({ title: "Error", description: "Required details missing.", variant: "destructive" }); return; }
    if (roomToCancel.is_available !== ROOM_AVAILABILITY_STATUS.RESERVED) { toast({ title: "Action Not Allowed", description: "Room is not currently reserved for cancellation.", variant: "default" }); return; }

    const transactionIdToCancel = roomToCancel.transaction_id;
    if (!transactionIdToCancel) { toast({ title: "Action Not Allowed", description: "No transaction linked to cancel.", variant: "default" }); return; }

    setIsSubmitting(true);
    const transaction = await getActiveTransactionForRoom(transactionIdToCancel, tenantId, branchId);
    setIsSubmitting(false);
    if (!transaction || Number(transaction.status) !== TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM) {
        const currentStatusText = transaction?.status !== null && transaction?.status !== undefined ? TRANSACTION_LIFECYCLE_STATUS_TEXT[Number(transaction.status)] : 'Unknown or not matching expected reserved status';
        toast({ title: "Action Not Allowed", description: `Reservation (ID: ${transactionIdToCancel}) is not in a cancellable state. Current status: ${currentStatusText}`, variant: "default"}); return;
    }
    setRoomForActionConfirmation(roomToCancel);
    setActiveTransactionIdForAction(transactionIdToCancel);
    setIsCancelReservationConfirmOpen(true);
  }, [tenantId, branchId, staffUserId, toast]);

  const handleConfirmCancelReservation = async () => {
    if (!activeTransactionIdForAction || !roomForActionConfirmation || !tenantId || !branchId || !staffUserId) {
        toast({ title: "Cancellation Error", description: "Missing required data for cancellation.", variant: "destructive" });
        setIsCancelReservationConfirmOpen(false); return;
    }
    setIsSubmitting(true);
    try {
        const result = await cancelReservation(activeTransactionIdForAction, tenantId, branchId, roomForActionConfirmation.id, staffUserId);
        if (result.success && result.updatedRoomData) {
            toast({ title: "Success", description: "Reservation cancelled successfully." });
            updateRoomInLocalState(result.updatedRoomData);
            if (isTransactionDetailsDialogOpen && transactionDetails?.id === activeTransactionIdForAction) {
                 setIsTransactionDetailsDialogOpen(false); setTransactionDetails(null);
            }
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
              notesForm.reset({ notes: transaction.notes || '' });
              setSelectedRoomForBooking(room);
              setCurrentNotesForDisplay(transaction.notes);
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

  const handleSaveCleaningUpdateAndNotes = async (data: RoomCleaningStatusUpdateData) => {
    if (!selectedRoomForCleaningUpdate || !tenantId || !branchId || !staffUserId || data.cleaning_status === null || data.cleaning_status === undefined) {
      toast({ title: "Error", description: "Missing details to update cleaning status/notes.", variant: "destructive" });
      return;
    }
    setIsSubmittingCleaningAction(true);
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
        setIsCleaningNotesModalOpen(false);
      } else {
        toast({ title: "Update Failed", description: result.message || "Could not update status/notes.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: `An unexpected error occurred. ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
    } finally {
      setIsSubmittingCleaningAction(false);
    }
  };

  const calculatedChange = useMemo(() => {
    const tenderStr = String(tenderAmountWatch);
    const tenderNum = parseFloat(tenderStr);
    const billNum = currentBillForCheckout;

    if (billNum !== null && !isNaN(tenderNum) && tenderNum >= billNum) {
        const change = tenderNum - billNum;
        return change;
    }
    return null;
  }, [tenderAmountWatch, currentBillForCheckout]);


  const getRoomRateNameForCard = (room: HotelRoom): string => {
    if (room.is_available !== ROOM_AVAILABILITY_STATUS.AVAILABLE || !room.hotel_rate_id || room.hotel_rate_id.length === 0) {
      return 'N/A';
    }
    // For available rooms, display the name of the first associated active rate
    const firstRateId = room.hotel_rate_id[0];
    const rate = allBranchActiveRates.find(r => r.id === firstRateId);
    return rate ? rate.name : 'Rate N/A';
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
        allRoomsForBranch={rooms}
        staffUserId={staffUserId}
        tenantId={tenantId}
        branchId={branchId}
        onStatusUpdateSuccess={(updatedRoom) => {
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
          const availableNotReadyCount = activeFloorRooms.filter(room => room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && Number(room.cleaning_status) !== ROOM_CLEANING_STATUS.CLEAN && Number(room.cleaning_status) !== ROOM_CLEANING_STATUS.OUT_OF_ORDER).length;
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
                        <span className="flex items-center text-slate-500" title="Available (Needs Cleaning/Inspection)"><Wrench className="h-4 w-4 mr-1" />{availableNotReadyCount}</span>
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
                    let currentRateName = room.active_transaction_rate_name; // For occupied/reserved

                     if (room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE) {
                        if (Number(room.cleaning_status) === ROOM_CLEANING_STATUS.CLEAN) {
                            cardHeaderBgClass = "bg-green-500"; cardHeaderTextClass = "text-white"; cardHeaderDescClass = "text-green-100"; statusDotColor = "bg-green-500"; displayedAvailabilityText = "Available";
                            currentRateName = getRoomRateNameForCard(room); // Get first rate for available rooms
                        } else {
                            cardHeaderBgClass = "bg-slate-400"; cardHeaderTextClass = "text-white"; cardHeaderDescClass = "text-slate-100"; statusDotColor = "bg-slate-500"; displayedAvailabilityText = ROOM_CLEANING_STATUS_TEXT[Number(room.cleaning_status)];
                            currentRateName = 'N/A (Not Clean)';
                        }
                    } else if (room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED) {
                        cardHeaderBgClass = "bg-orange-500"; cardHeaderTextClass = "text-white"; cardHeaderDescClass = "text-orange-100"; statusDotColor = "bg-orange-500"; displayedAvailabilityText = "Occupied";
                    } else if (room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED) {
                        cardHeaderBgClass = "bg-yellow-500"; cardHeaderTextClass = "text-white"; cardHeaderDescClass = "text-yellow-100"; statusDotColor = "bg-yellow-500"; displayedAvailabilityText = "Reserved";
                    }
                     if (Number(room.cleaning_status) === ROOM_CLEANING_STATUS.OUT_OF_ORDER) { // Out of order overrides availability color
                        cardHeaderBgClass = "bg-red-600"; cardHeaderTextClass = "text-white"; cardHeaderDescClass = "text-red-100"; statusDotColor = "bg-red-600"; displayedAvailabilityText = "Out of Order";
                        currentRateName = 'N/A (Out of Order)';
                    }


                    const isBookable = room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && Number(room.cleaning_status) === ROOM_CLEANING_STATUS.CLEAN && Array.isArray(room.hotel_rate_id) && room.hotel_rate_id.length > 0;
                    let bookingDisabledTitle = "";
                    if (room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE) {
                        if (Number(room.cleaning_status) !== ROOM_CLEANING_STATUS.CLEAN) bookingDisabledTitle = `Room not clean: ${ROOM_CLEANING_STATUS_TEXT[Number(room.cleaning_status)]}.`;
                        else if (!Array.isArray(room.hotel_rate_id) || room.hotel_rate_id.length === 0) bookingDisabledTitle = "No rates assigned to this room.";
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
                            {room.transaction_id && room.is_available !== ROOM_AVAILABILITY_STATUS.AVAILABLE && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className={cn( "h-7 w-7 p-1 absolute top-2 right-2", cardHeaderTextClass.includes("text-white") || cardHeaderTextClass.includes("text-primary") ? "text-white hover:bg-white/20" : "text-muted-foreground hover:bg-accent" )}
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
                                    Number(room.cleaning_status) === ROOM_CLEANING_STATUS.OUT_OF_ORDER ? "text-red-700 dark:text-red-400" :
                                    room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED ? "text-orange-700 dark:text-orange-300" :
                                    room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED ? "text-yellow-600 dark:text-yellow-400" :
                                    "text-gray-600 dark:text-gray-400"
                                )}>{displayedAvailabilityText}</span>
                            </div>
                            {room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && Number(room.cleaning_status) !== ROOM_CLEANING_STATUS.CLEAN && Number(room.cleaning_status) !== ROOM_CLEANING_STATUS.OUT_OF_ORDER && (
                                <div className="flex items-center text-xs mt-1">
                                    <Wrench size={12} className="inline mr-1 text-muted-foreground" />
                                    <span className="text-muted-foreground">{ROOM_CLEANING_STATUS_TEXT[Number(room.cleaning_status)]}</span>
                                </div>
                            )}
                            {Number(room.cleaning_status) === ROOM_CLEANING_STATUS.OUT_OF_ORDER && (
                                <p className="text-xs text-muted-foreground truncate" title={room.cleaning_notes || undefined}>Note: {room.cleaning_notes?.substring(0,25) || 'N/A'}{room.cleaning_notes && room.cleaning_notes.length > 25 ? "..." : ""}</p>
                            )}

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
                                In: {isValid(parseISO(room.active_transaction_check_in_time.replace(' ', 'T'))) ? format(parseISO(room.active_transaction_check_in_time.replace(' ', 'T')), 'yyyy-MM-dd hh:mm aa') : 'N/A'}
                                </p>
                            )}
                            {room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED && room.transaction_id && room.active_transaction_check_in_time && (
                                <p className="text-xs text-muted-foreground">
                                For: {isValid(parseISO(room.active_transaction_check_in_time.replace(' ', 'T'))) ? format(parseISO(room.active_transaction_check_in_time.replace(' ', 'T')), 'yyyy-MM-dd hh:mm aa') : 'N/A'}
                                </p>
                            )}
                          </div>

                          <div className="mt-auto pt-3 border-t">
                             <div className="flex flex-col space-y-2 w-full">
                                {room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && Number(room.cleaning_status) === ROOM_CLEANING_STATUS.CLEAN && (
                                    <>
                                        <Button
                                            variant="default" size="sm" className="w-full"
                                            onClick={(e) => { e.stopPropagation(); handleOpenBookingDialog(room, 'book'); }}
                                            disabled={!isBookable || isSubmitting}
                                            title={!isBookable ? bookingDisabledTitle : "Book this room"}
                                        >
                                           {(!isBookable) && <Ban className="mr-2 h-4 w-4" />}
                                            <LogIn className="mr-2 h-4 w-4" /> Book Room
                                        </Button>
                                        <Button
                                            variant="outline" size="sm" className="w-full"
                                            onClick={(e) => { e.stopPropagation(); handleOpenBookingDialog(room, 'reserve'); }}
                                            disabled={!isBookable || isSubmitting}
                                            title={!isBookable ? bookingDisabledTitle : "Reserve this room"}
                                        >
                                            {(!isBookable) && <Ban className="mr-2 h-4 w-4" />}
                                            <CalendarPlus className="mr-2 h-4 w-4" /> Reserve Room
                                        </Button>
                                    </>
                                )}
                                {room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED && (
                                     <div className="flex flex-col space-y-2 w-full">
                                        {/* View Details Button for Occupied Rooms */}
                                        <Button variant="outline" size="sm" className="w-full" title="View Transaction Details"
                                            onClick={(e) => { e.stopPropagation(); if (room.transaction_id) handleViewDetails(room); else toast({ title: "Info", description: "No transaction ID linked.", variant: "default" }); }}>
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
                                         {/* View Details Button for Reserved Rooms */}
                                        <Button variant="outline" size="sm" className="w-full" title="View Reservation Details"
                                            onClick={(e) => { e.stopPropagation(); if (room.transaction_id) handleViewDetails(room); else toast({title: "Info", description:"No linked transaction.", variant:"default"}); }}>
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
                                 {Number(room.cleaning_status) === ROOM_CLEANING_STATUS.OUT_OF_ORDER && (
                                     <p className="text-xs text-center text-red-600 dark:text-red-400 font-medium p-2 bg-red-100 dark:bg-red-900/30 rounded-md">
                                         This room is Out of Order.
                                     </p>
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
            bookingForm.setValue('selected_rate_id', undefined);
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
              <div className="flex-grow space-y-3 p-1 overflow-y-auto">
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
                      <FormControl><Checkbox checked={Number(field.value) === TRANSACTION_PAYMENT_STATUS.PAID} onCheckedChange={(checked) => {
                        field.onChange(checked ? TRANSACTION_PAYMENT_STATUS.PAID : TRANSACTION_PAYMENT_STATUS.UNPAID);
                        if (!checked) { bookingForm.setValue('tender_amount_at_checkin', null); } }} /></FormControl>
                      <div className="space-y-1 leading-none"><FormLabel>Paid at Check-in/Reservation?</FormLabel></div>
                    </FormItem>
                  )}
                />
                {Number(watchIsPaidInBookingForm) === TRANSACTION_PAYMENT_STATUS.PAID && (
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
                {(bookingMode === 'reserve') && (
                    <FormField control={bookingForm.control} name="is_advance_reservation"
                        render={({ field }) => (
                            <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-3 shadow-sm w-[90%]">
                                <FormControl><Checkbox checked={!!field.value}
                                    onCheckedChange={(checkedBool) => {
                                        field.onChange(!!checkedBool);
                                        const currentIsPaid = bookingForm.getValues("is_paid");
                                        if (Number(currentIsPaid) !== TRANSACTION_PAYMENT_STATUS.UNPAID) {
                                            bookingForm.setValue("is_paid", !!checkedBool ? TRANSACTION_PAYMENT_STATUS.ADVANCE_PAID : TRANSACTION_PAYMENT_STATUS.PAID, { shouldValidate: true });
                                        }
                                    }} /></FormControl>
                                <div className="space-y-1 leading-none"><FormLabel>Advance Future Reservation?</FormLabel></div>
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

      <Dialog open={isTransactionDetailsDialogOpen} onOpenChange={(open) => {
          if (!open) {
              setIsTransactionDetailsDialogOpen(false); setTransactionDetails(null); setEditingModeForDialog(null);
              notesForm.reset(defaultNotesEditFormValues); reservationEditForm.reset(defaultReservationEditFormValues);
          } else { setIsTransactionDetailsDialogOpen(open); }
      }}>
        <DialogContent className="sm:max-w-md p-1 flex flex-col max-h-[85vh]">
          <DialogHeader className="p-2 border-b">
            <DialogTitle>Transaction Details</DialogTitle>
            {transactionDetails?.room_name && <ShadDialogDescriptionAliased className="text-xs">Room: {transactionDetails.room_name} ({transactionDetails.rate_name || 'Rate N/A'})</ShadDialogDescriptionAliased>}
          </DialogHeader>
          {transactionDetails ? (
            <div className="flex-grow flex flex-col overflow-hidden">
                 <div className="flex-grow space-y-3 p-3 overflow-y-auto">
                    <p><strong>Client:</strong> {transactionDetails.client_name}</p>
                    <p><strong>Status:</strong> {transactionDetails.status !== null ? TRANSACTION_LIFECYCLE_STATUS_TEXT[transactionDetails.status] || 'Unknown' : 'N/A'}</p>
                    <p><strong>Payment Status:</strong> {transactionDetails.is_paid !== null && transactionDetails.is_paid !== undefined ? TRANSACTION_PAYMENT_STATUS_TEXT[transactionDetails.is_paid] : 'N/A'}</p>
                     {transactionDetails.tender_amount !== undefined && transactionDetails.tender_amount !== null && (<p><strong>Tender Amount:</strong> ₱{Number(transactionDetails.tender_amount).toFixed(2)}</p>)}
                     {transactionDetails.is_paid === TRANSACTION_PAYMENT_STATUS.PAID && typeof transactionDetails.tender_amount === 'number' && typeof transactionDetails.total_amount === 'number' && transactionDetails.tender_amount >= transactionDetails.total_amount && (
                        <p><strong>Change Given:</strong> ₱{(transactionDetails.tender_amount - transactionDetails.total_amount).toFixed(2)}</p>
                    )}
                    {transactionDetails.check_in_time && (<p><strong>Checked-in On:</strong> {isValid(parseISO(transactionDetails.check_in_time.replace(' ', 'T'))) ? format(parseISO(transactionDetails.check_in_time.replace(' ', 'T')), 'yyyy-MM-dd hh:mm:ss aa') : 'Invalid Date'}</p>)}
                    {transactionDetails.reserved_check_in_datetime && (<p><strong>Reserved Check-in:</strong> {isValid(parseISO(transactionDetails.reserved_check_in_datetime.replace(' ', 'T'))) ? format(parseISO(transactionDetails.reserved_check_in_datetime.replace(' ', 'T')), 'yyyy-MM-dd hh:mm:ss aa') : 'Invalid Date'}</p>)}
                    {transactionDetails.check_out_time && (<p><strong>Checked-out On:</strong> {isValid(parseISO(transactionDetails.check_out_time.replace(' ', 'T'))) ? format(parseISO(transactionDetails.check_out_time.replace(' ', 'T')), 'yyyy-MM-dd hh:mm:ss aa') : 'Invalid Date'}</p>)}
                    {transactionDetails.hours_used !== undefined && transactionDetails.hours_used !== null && (<p><strong>Hours Used:</strong> {transactionDetails.hours_used}</p>)}
                    {transactionDetails.total_amount !== undefined && transactionDetails.total_amount !== null && (<p><strong>Total Amount:</strong> ₱{Number(transactionDetails.total_amount).toFixed(2)}</p>)}


                    {editingModeForDialog === 'fullReservation' && Number(transactionDetails.status) === TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM ? (
                        <Form {...reservationEditForm}>
                        <form onSubmit={reservationEditForm.handleSubmit(data => handleReservationEditSubmit(data as TransactionReservedUpdateData))} className="space-y-3 pt-3 border-t mt-3">
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
                                        <FormControl><Checkbox checked={!!field.value}
                                                onCheckedChange={(checkedBool) => {
                                                    field.onChange(!!checkedBool);
                                                    const currentIsPaid = reservationEditForm.getValues("is_paid");
                                                    if (Number(currentIsPaid) !== TRANSACTION_PAYMENT_STATUS.UNPAID) {
                                                        reservationEditForm.setValue("is_paid", !!checkedBool ? TRANSACTION_PAYMENT_STATUS.ADVANCE_PAID : TRANSACTION_PAYMENT_STATUS.PAID, { shouldValidate: true });
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
                                <Button type="button" variant="outline" size="sm" onClick={() => { setEditingModeForDialog(null); reservationEditForm.reset(defaultReservationEditFormValues); if(transactionDetails) notesForm.reset({ notes: transactionDetails.notes || ''}); }}>Cancel Edit</Button>
                            </div>
                        </form>
                        </Form>
                    ) : (
                        <div className="pt-3 border-t mt-3 space-y-1">
                            <div className="flex justify-between items-center">
                                 <Label>Notes:</Label>
                                {(Number(transactionDetails.status) === TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN || Number(transactionDetails.status) === TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM) && (
                                    <Button variant="ghost" size="sm" onClick={() => { setEditingModeForDialog('notesOnly'); notesForm.reset({notes: transactionDetails.notes || ''});}}><Edit3 className="h-3 w-3 mr-1" /> Edit Notes</Button>
                                )}
                            </div>
                            {editingModeForDialog === 'notesOnly' ? (
                                <Form {...notesForm}>
                                    <form onSubmit={notesForm.handleSubmit(data => handleUpdateNotes(data as TransactionUpdateNotesData))} className="space-y-3">
                                        <FormField control={notesForm.control} name="notes" render={({ field }) => (
                                        <FormItem><FormLabel className="sr-only">Notes</FormLabel><FormControl><Textarea {...field} value={field.value ?? ''} className="w-full" rows={3} placeholder="No notes yet."/></FormControl><FormMessage /></FormItem>
                                        )} />
                                        <div className="flex justify-end space-x-2">
                                            <Button type="submit" size="sm" disabled={isSubmitting || !notesForm.formState.isDirty}>{isSubmitting ? <Loader2 className="animate-spin h-3 w-3" /> : "Save Notes"}</Button>
                                            <Button type="button" variant="outline" size="sm" onClick={() => { setEditingModeForDialog(null); if(transactionDetails) notesForm.reset({ notes: transactionDetails.notes || ''}); }}>Cancel</Button>
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

      {/* Checkout Confirmation Dialog (standard Dialog, not AlertDialog) */}
      <Dialog
        open={isCheckoutModalOpen}
        onOpenChange={(openValue) => {
          if (!openValue) {
            setIsCheckoutModalOpen(false);
            setTransactionDetailsForCheckout(null);
            setCurrentBillForCheckout(null);
            setRoomForActionConfirmation(null);
            setActiveTransactionIdForAction(null);
            checkoutForm.reset(defaultCheckoutFormValues);
          } else {
            setIsCheckoutModalOpen(openValue);
          }
        }}
      >
        <DialogContent className="sm:max-w-md p-4">
            <DialogHeader className="border-b pb-3 mb-3">
                <DialogTitle className="text-xl">Confirm Check-out: {roomForActionConfirmation?.room_name}</DialogTitle>
                <ShadDialogDescriptionAliased className="text-sm">Room #: {roomForActionConfirmation?.room_code}</ShadDialogDescriptionAliased>
            </DialogHeader>
            {transactionDetailsForCheckout && currentBillForCheckout !== null && (
                <div className="space-y-3 text-sm py-2">
                    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 p-3 border rounded-md bg-muted/30">
                        <Label className="text-muted-foreground font-medium text-right">Client:</Label> <span className="font-semibold">{transactionDetailsForCheckout.client_name}</span>
                        <Label className="text-muted-foreground font-medium text-right">Checked-in:</Label> <span className="font-semibold">{transactionDetailsForCheckout.check_in_time ? format(parseISO(transactionDetailsForCheckout.check_in_time.replace(' ', 'T')), 'yyyy-MM-dd hh:mm aa') : 'N/A'}</span>
                        <Label className="text-muted-foreground font-medium text-right">Current Time:</Label> <span className="font-semibold">{currentTimeForCheckoutModal}</span>
                        <Label className="text-muted-foreground font-medium text-right">Hours Stayed:</Label> <span className="font-semibold">{displayHoursUsedForCheckoutModal}</span>
                        <Label className="text-muted-foreground font-medium text-right">Rate:</Label> <span className="font-semibold">{transactionDetailsForCheckout.rate_name || 'N/A'}</span>
                    </div>
                    <hr className="my-2 border-border"/>
                    <div className="flex justify-between items-center text-lg pt-1 pb-2">
                        <span className="font-semibold text-muted-foreground">Total Bill:</span>
                        <span className="font-bold text-primary">₱{currentBillForCheckout.toFixed(2)}</span>
                    </div>

                    <Form {...checkoutForm}>
                        <form className="space-y-4">
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
                                        <FormControl>
                                            <Input type="text" placeholder="0.00"
                                                {...field}
                                                onChange={(e) => {
                                                    const val = e.target.value;
                                                    if (/^\d*\.?\d{0,2}$/.test(val) || val === "") {
                                                        field.onChange(val);
                                                    }
                                                }}
                                                value={field.value === null || field.value === undefined ? "" : String(field.value)}
                                                className="w-full text-lg p-2 text-right" />
                                        </FormControl><FormMessage />
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
              setSelectedRoomForBooking(null);
              setCurrentNotesForDisplay(null);
          }
          setIsNotesOnlyModalOpen(isOpen);
      }}>
        <DialogContent className="sm:max-w-md p-3">
          <DialogHeader className="border-b pb-2 mb-2">
            <DialogTitle>Transaction Notes</DialogTitle>
            <ShadDialogDescriptionAliased>Room: {selectedRoomForBooking?.room_name} ({selectedRoomForBooking?.room_code})</ShadDialogDescriptionAliased>
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
                 <ShadDialogDescriptionAliased className="text-sm text-muted-foreground">Room #: {selectedRoomForRatesDisplay?.room_code}</ShadDialogDescriptionAliased>
            </DialogHeader>
            <div className="py-4 max-h-[60vh] overflow-y-auto">
                {selectedRoomForRatesDisplay && Array.isArray(selectedRoomForRatesDisplay.hotel_rate_id) && selectedRoomForRatesDisplay.hotel_rate_id.length > 0 ? (
                    (() => {
                        const extractHoursFromName = (name: string | undefined): number => {
                            if (!name) return Infinity;
                            const match = name.match(/(\d+)\s*hr/i);
                            return match ? parseInt(match[1], 10) : Infinity;
                          };

                        const ratesForRoom = allBranchActiveRates
                            .filter(rate => selectedRoomForRatesDisplay!.hotel_rate_id!.includes(rate.id))
                            .sort((a, b) => {
                                const hoursA = extractHoursFromName(a.name);
                                const hoursB = extractHoursFromName(b.name);
                                if (hoursA !== hoursB) {
                                  return hoursA - hoursB;
                                }
                                return a.name.localeCompare(b.name);
                              });
                        if (ratesForRoom.length > 0) {
                            return (
                                <div className="space-y-2">
                                    {ratesForRoom.map(rate => (
                                        <div key={rate.id} className="bg-muted/30 rounded p-2 border-b last:border-b-0 text-sm">
                                            <p className="font-medium">{rate.name}</p>
                                            <p className="text-xs text-muted-foreground">Price: ₱{Number(rate.price).toFixed(2)} | Hours: {rate.hours}</p>
                                        </div> ))}
                                </div> );
                        }
                        return <p className="text-muted-foreground">No active rates currently associated with this room or found for this branch.</p>;
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
