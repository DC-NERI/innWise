
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Label } from "@/components/ui/label"; // Base Label
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BedDouble, Loader2, Info, User, LogOutIcon, LogIn, CalendarClock, Edit3, Ban } from "lucide-react";
import type { HotelRoom, Transaction, SimpleRate } from '@/lib/types';
import { listRoomsForBranch, getRatesForBranchSimple } from '@/actions/admin';
import { 
  createTransactionAndOccupyRoom, 
  createReservation,
  getActiveTransactionForRoom, 
  checkOutGuestAndFreeRoom, 
  updateTransactionNotes,
  updateReservedTransactionDetails,
  cancelReservation,
  checkInReservedGuest
} from '@/actions/staff';
import { 
  transactionCreateSchema, TransactionCreateData, 
  transactionUpdateNotesSchema, TransactionUpdateNotesData,
  transactionReservedUpdateSchema, TransactionReservedUpdateData
} from '@/lib/schemas';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { 
  ROOM_AVAILABILITY_STATUS, 
  ROOM_AVAILABILITY_STATUS_TEXT, 
  TRANSACTION_STATUS,
  TRANSACTION_STATUS_TEXT 
} from '@/lib/constants';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";


interface RoomStatusContentProps {
  tenantId: number | null;
  branchId: number | null;
  staffUserId: number | null;
}

interface GroupedRooms {
  [floor: string]: HotelRoom[];
}

const defaultBookingFormValues: TransactionCreateData = {
  client_name: '',
  client_payment_method: 'Cash',
  notes: '',
  selected_rate_id: undefined as unknown as number, 
};

const defaultNotesEditFormValues: TransactionUpdateNotesData = {
  notes: '',
};

const defaultReservationEditFormValues: TransactionReservedUpdateData = {
  client_name: '',
  client_payment_method: 'Cash',
  notes: '',
};


export default function RoomStatusContent({ tenantId, branchId, staffUserId }: RoomStatusContentProps) {
  const [rooms, setRooms] = useState<HotelRoom[]>([]);
  const [groupedRooms, setGroupedRooms] = useState<GroupedRooms>({});
  const [isLoading, setIsLoading] = useState(true);
  
  const [isBookingDialogOpen, setIsBookingDialogOpen] = useState(false);
  const [selectedRoomForBooking, setSelectedRoomForBooking] = useState<HotelRoom | null>(null);
  const [bookingMode, setBookingMode] = useState<'book' | 'reserve' | null>(null);
  
  const [isTransactionDetailsDialogOpen, setIsTransactionDetailsDialogOpen] = useState(false);
  const [transactionDetails, setTransactionDetails] = useState<Transaction | null>(null);
  const [editingModeForDialog, setEditingModeForDialog] = useState<'notesOnly' | 'fullReservation' | null>(null);
  const [isEditNotesMode, setIsEditNotesMode] = useState(false);


  const [roomForActionConfirmation, setRoomForActionConfirmation] = useState<HotelRoom | null>(null); 
  const [activeTransactionIdForAction, setActiveTransactionIdForAction] = useState<number | null>(null); 
  const [isCheckoutConfirmOpen, setIsCheckoutConfirmOpen] = useState(false);
  const [isCancelReservationConfirmOpen, setIsCancelReservationConfirmOpen] = useState(false); 
  const [isCheckInReservedConfirmOpen, setIsCheckInReservedConfirmOpen] = useState(false); 

  const [allBranchActiveRates, setAllBranchActiveRates] = useState<SimpleRate[]>([]);
  const [applicableRatesForBookingDialog, setApplicableRatesForBookingDialog] = useState<SimpleRate[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const bookingForm = useForm<TransactionCreateData>({
    resolver: zodResolver(transactionCreateSchema),
    defaultValues: defaultBookingFormValues,
  });

  const notesEditForm = useForm<TransactionUpdateNotesData>({
    resolver: zodResolver(transactionUpdateNotesSchema),
    defaultValues: defaultNotesEditFormValues,
  });

  const reservationEditForm = useForm<TransactionReservedUpdateData>({
    resolver: zodResolver(transactionReservedUpdateSchema),
    defaultValues: defaultReservationEditFormValues,
  });

  const updateRoomInLocalState = useCallback((updatedRoomPartial: Partial<HotelRoom> & { id: number }) => {
    console.log("[RoomStatusContent] updateRoomInLocalState called with:", updatedRoomPartial);
    setRooms(prevRooms => {
      const newRooms = prevRooms.map(r =>
        r.id === updatedRoomPartial.id ? { ...r, ...updatedRoomPartial } : r
      );
      
      const newGrouped = newRooms.reduce((acc, currentRoom) => {
        const floorKey = currentRoom.floor?.toString() ?? 'Ground Floor / Other';
        if (!acc[floorKey]) acc[floorKey] = [];
        acc[floorKey].push(currentRoom);
        // Sort by room_code within each floor
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
    console.log("[RoomStatusContent] Fetching rooms and rates for tenantId:", tenantId, "branchId:", branchId);
    try {
      const [fetchedRooms, fetchedBranchRates] = await Promise.all([
        listRoomsForBranch(branchId, tenantId),
        getRatesForBranchSimple(branchId, tenantId)
      ]);
      
      setRooms(fetchedRooms);
      setAllBranchActiveRates(fetchedBranchRates);

      const grouped = fetchedRooms.reduce((acc, room) => {
        const floorKey = room.floor?.toString() ?? 'Ground Floor / Other';
        if (!acc[floorKey]) acc[floorKey] = [];
        acc[floorKey].push(room);
        // Sort by room_code within each floor
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
      console.error("[RoomStatusContent] Error fetching room/rate data:", error);
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
    console.log("[RoomStatusContent] handleOpenBookingDialog for room:", room.room_name, "Mode:", mode);
    
    const roomRateIds = Array.isArray(room.hotel_rate_id) ? room.hotel_rate_id : [];
    const applicableRates = allBranchActiveRates.filter(branchRate =>
        roomRateIds.includes(branchRate.id)
    );
    setApplicableRatesForBookingDialog(applicableRates);
    
    if (applicableRates.length === 0) {
        toast({title: "No Applicable Rates", description: "This room has no active rates assigned. Please ensure rates are configured by an Admin.", variant: "destructive"});
        return;
    }
    
    setSelectedRoomForBooking(room);
    setBookingMode(mode);
    
    const defaultRateId = applicableRates.length > 0 ? applicableRates[0].id : undefined;
    bookingForm.reset({...defaultBookingFormValues, selected_rate_id: defaultRateId });
    setIsBookingDialogOpen(true);
  };

  const handleBookingSubmit = async (data: TransactionCreateData) => {
    if (!selectedRoomForBooking || !staffUserId || !tenantId || !branchId || !data.selected_rate_id || !bookingMode) {
      toast({ title: "Submission Error", description: `Booking details incomplete. SelectedRoom: ${!!selectedRoomForBooking}, StaffID: ${staffUserId}, TenantID: ${tenantId}, BranchID: ${branchId}, RateID: ${data.selected_rate_id}, Mode: ${bookingMode}`, variant: "destructive" });
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
    if (!tenantId || !branchId || !room.id) {
      toast({ title: "Error", description: "Missing details for viewing transaction.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const transaction = await getActiveTransactionForRoom(room.id, tenantId, branchId);
      if (transaction) {
        setTransactionDetails(transaction);
        if (room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED && transaction.status === TRANSACTION_STATUS.UNPAID) {
          setEditingModeForDialog('notesOnly');
          notesEditForm.reset({ notes: transaction.notes || '' });
        } else if (room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED && transaction.status === TRANSACTION_STATUS.ADVANCE_PAID) {
          setEditingModeForDialog('fullReservation');
          reservationEditForm.reset({
            client_name: transaction.client_name,
            client_payment_method: transaction.client_payment_method,
            notes: transaction.notes || '',
          });
        } else {
           setEditingModeForDialog(null); 
        }
        setIsEditNotesMode(false); 
        setIsTransactionDetailsDialogOpen(true);
      } else {
        toast({ title: "No Details", description: `No active or reserved transaction found for room ${room.room_name}.`, variant: "default" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to fetch transaction details.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  }, [tenantId, branchId, toast, notesEditForm, reservationEditForm]);
  
  const handleOpenCheckoutConfirmation = useCallback(async (room: HotelRoom) => {
    if (!tenantId || !branchId) {
        toast({ title: "Error", description: "Tenant or branch information missing for checkout prep.", variant: "destructive" });
        return;
    }
    if (room.is_available !== ROOM_AVAILABILITY_STATUS.OCCUPIED) {
        toast({ title: "Action Not Allowed", description: "Room is not currently occupied.", variant: "default" });
        return;
    }
    setIsSubmitting(true);
    try {
        const transaction = await getActiveTransactionForRoom(room.id, tenantId, branchId);
        if (transaction && transaction.id && transaction.status === TRANSACTION_STATUS.UNPAID) {
            setRoomForActionConfirmation(room);
            setActiveTransactionIdForAction(transaction.id);
            setIsCheckoutConfirmOpen(true);
        } else {
            toast({ title: "No Active Check-in", description: "Cannot checkout: no active unpaid check-in found.", variant: "default" });
        }
    } catch (error) {
         toast({ title: "Error", description: "Failed to get transaction details for checkout.", variant: "destructive" });
    } finally {
        setIsSubmitting(false);
    }
  }, [tenantId, branchId, toast]);

  const handleConfirmCheckout = async () => {
    if (!activeTransactionIdForAction || !roomForActionConfirmation || !staffUserId || !tenantId || !branchId) {
      toast({ title: "Checkout Error", description: "Required information for checkout is missing.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await checkOutGuestAndFreeRoom(
        activeTransactionIdForAction, staffUserId, tenantId, branchId, roomForActionConfirmation.id
      );
      if (result.success && result.updatedRoomData) {
        toast({ title: "Success", description: result.message || "Guest checked out successfully." });
        updateRoomInLocalState(result.updatedRoomData);
      } else {
        toast({ title: "Check-out Failed", description: result.message || "Could not complete check-out.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "An unexpected error occurred during check-out.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
      setIsCheckoutConfirmOpen(false);
      setRoomForActionConfirmation(null);
      setActiveTransactionIdForAction(null);
    }
  };

  const handleOpenCancelReservationConfirmation = useCallback(async (room: HotelRoom) => {
    if (!tenantId || !branchId) {
        toast({ title: "Error", description: "Tenant or branch information missing.", variant: "destructive" });
        return;
    }
     if (room.is_available !== ROOM_AVAILABILITY_STATUS.RESERVED) {
        toast({ title: "Action Not Allowed", description: "Room is not currently reserved.", variant: "default" });
        return;
    }
    setIsSubmitting(true);
    try {
        const transaction = await getActiveTransactionForRoom(room.id, tenantId, branchId);
        if (transaction && transaction.id && transaction.status === TRANSACTION_STATUS.ADVANCE_PAID) {
            setRoomForActionConfirmation(room);
            setActiveTransactionIdForAction(transaction.id);
            setIsCancelReservationConfirmOpen(true);
        } else {
            toast({ title: "No Active Reservation", description: "Cannot cancel: no active 'Advance Paid' reservation found.", variant: "default" });
        }
    } catch (error) {
         toast({ title: "Error", description: "Failed to get reservation details for cancellation.", variant: "destructive" });
    } finally {
        setIsSubmitting(false);
    }
  }, [tenantId, branchId, toast]);

  const handleConfirmCancelReservation = async () => {
    if (!activeTransactionIdForAction || !roomForActionConfirmation || !tenantId || !branchId) {
      toast({ title: "Cancellation Error", description: "Required information for cancellation is missing.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await cancelReservation(
        activeTransactionIdForAction, tenantId, branchId, roomForActionConfirmation.id
      );
      if (result.success && result.updatedRoomData) {
        toast({ title: "Success", description: result.message || "Reservation cancelled." });
        updateRoomInLocalState(result.updatedRoomData);
         if (isTransactionDetailsDialogOpen && transactionDetails?.id === activeTransactionIdForAction) {
            setIsTransactionDetailsDialogOpen(false);
            setTransactionDetails(null);
        }
      } else {
        toast({ title: "Cancellation Failed", description: result.message, variant: "destructive" });
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

  const handleOpenCheckInReservedConfirmation = useCallback(async (room: HotelRoom) => {
    if (!tenantId || !branchId || !staffUserId) {
        toast({ title: "Error", description: "Required details missing for check-in.", variant: "destructive" });
        return;
    }
    if (room.is_available !== ROOM_AVAILABILITY_STATUS.RESERVED) {
        toast({ title: "Action Not Allowed", description: "Room is not currently reserved.", variant: "default" });
        return;
    }
    setIsSubmitting(true);
    try {
        const transaction = await getActiveTransactionForRoom(room.id, tenantId, branchId);
        if (transaction && transaction.id && transaction.status === TRANSACTION_STATUS.ADVANCE_PAID) {
            setRoomForActionConfirmation(room);
            setActiveTransactionIdForAction(transaction.id);
            setIsCheckInReservedConfirmOpen(true);
        } else {
            toast({ title: "No Active Reservation", description: "Cannot check-in: no 'Advance Paid' reservation found.", variant: "default" });
        }
    } catch (error) {
        toast({ title: "Error", description: "Failed to get reservation details for check-in.", variant: "destructive" });
    } finally {
        setIsSubmitting(false);
    }
  }, [tenantId, branchId, staffUserId, toast]);

  const handleConfirmCheckInReservedGuest = async () => {
    if (!activeTransactionIdForAction || !roomForActionConfirmation || !staffUserId || !tenantId || !branchId) {
        toast({ title: "Check-in Error", description: "Required information for reserved check-in is missing.", variant: "destructive" });
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


  const handleUpdateTransactionDetails = async (data: TransactionUpdateNotesData) => {
    if (!transactionDetails || !transactionDetails.id || !tenantId || !branchId) {
        toast({ title: "Error", description: "Missing details to update notes.", variant: "destructive" });
        return;
    }
    setIsSubmitting(true);
    try {
        const result = await updateTransactionNotes(transactionDetails.id, data.notes, tenantId, branchId);
        if (result.success && result.updatedTransaction) {
            toast({ title: "Success", description: "Notes updated." });
            setTransactionDetails(result.updatedTransaction); 
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

  const handleReservationEditSubmit = async (data: TransactionReservedUpdateData) => {
    if (!transactionDetails || !transactionDetails.id || !tenantId || !branchId) {
      toast({ title: "Error", description: "Missing details for reservation update.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await updateReservedTransactionDetails(transactionDetails.id, data, tenantId, branchId);
      if (result.success && result.updatedTransaction) {
        toast({ title: "Success", description: "Reservation details updated." });
        setTransactionDetails(result.updatedTransaction); 
        
        const roomToUpdate = rooms.find(r => r.id === result.updatedTransaction!.hotel_room_id);
        if (roomToUpdate && roomToUpdate.active_transaction_client_name !== result.updatedTransaction.client_name) {
             updateRoomInLocalState({
                id: roomToUpdate.id,
                active_transaction_client_name: result.updatedTransaction.client_name,
            });
        }
         setEditingModeForDialog(null);
         setIsEditNotesMode(false); 
      } else {
        toast({ title: "Update Failed", description: result.message, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Unexpected error updating reservation.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getRoomRateNameForCard = (room: HotelRoom): string => {
    if (room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED || room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED) {
        if (room.active_transaction_rate_name) {
            return room.active_transaction_rate_name;
        }
    }
    if (Array.isArray(room.hotel_rate_id) && room.hotel_rate_id.length > 0) {
      const firstRateId = room.hotel_rate_id[0];
      const rate = allBranchActiveRates.find(r => r.id === firstRateId);
      return rate?.name || 'N/A';
    }
    return 'N/A';
  };


  if (isLoading) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2 text-muted-foreground">Loading room statuses...</p></div>;
  }
  if (!branchId && !isLoading) { 
    return <Card><CardHeader><div className="flex items-center space-x-2"><BedDouble className="h-6 w-6 text-primary" /><CardTitle>Room Status</CardTitle></div><CardDescription>View current room availability.</CardDescription></CardHeader><CardContent><p className="text-muted-foreground">No branch assigned or selected. Please ensure your staff account is assigned to a branch.</p></CardContent></Card>;
  }
  if (rooms.length === 0 && !isLoading) {
    return <Card><CardHeader><div className="flex items-center space-x-2"><BedDouble className="h-6 w-6 text-primary" /><CardTitle>Room Status</CardTitle></div><CardDescription>View current room availability.</CardDescription></CardHeader><CardContent><p className="text-muted-foreground">No active rooms found for this branch. Rooms may need to be added by an administrator.</p></CardContent></Card>;
  }

  const defaultOpenFloors = Object.keys(groupedRooms);

  return (
    <div className="space-y-1">
      <Accordion type="multiple" defaultValue={defaultOpenFloors} className="w-full space-y-1">
        {Object.entries(groupedRooms).map(([floor, floorRooms]) => {
          const availableCount = floorRooms.filter(room => room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE).length;
          const occupiedCount = floorRooms.filter(room => room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED).length;
          const reservedCount = floorRooms.filter(room => room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED).length;

          return (
            <AccordionItem value={floor} key={floor} className="border bg-card rounded-md shadow-sm">
              <AccordionTrigger className="text-xl font-semibold px-4 py-3 hover:no-underline">
                <div className="flex justify-between items-center w-full">
                  <span>Floor: {floor.replace('Ground Floor / Other', 'Ground Floor / Unspecified')}</span>
                    <span className="text-xs font-normal ml-4">
                        (<span className="text-green-600">Available: {availableCount}</span>, <span className="text-orange-600">Occupied: {occupiedCount}</span>, <span className="text-blue-600">Reserved: {reservedCount}</span>)
                    </span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4 pt-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {floorRooms.map(room => {
                    // console.log(`Rendering Room Card: Name: ${room.room_name}, Available: ${room.is_available}, Active Tx ID: ${room.active_transaction_id}, Client Name: ${room.active_transaction_client_name}`);
                    return (
                      <Card 
                        key={room.id} 
                        className="shadow-md hover:shadow-lg transition-shadow duration-200 flex flex-col"
                      >
                        <CardHeader className={cn(
                          "p-4 rounded-t-lg",
                          room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && "bg-green-500 text-white",
                          room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED && "bg-orange-500 text-white",
                          room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED && "bg-blue-500 text-white"
                        )}>
                          <CardTitle className="text-lg truncate" title={room.room_name}>{room.room_name}</CardTitle>
                          <CardDescription className="text-xs text-white/90">
                             Room # : {room.room_code}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="p-4 pt-2 flex-grow flex flex-col justify-between">
                          <div className="mb-3 space-y-1">
                             <p className="text-xs text-muted-foreground">Rate: {getRoomRateNameForCard(room)}</p>
                            {room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && (
                              <div className="flex items-center space-x-2">
                                <span className="h-3 w-3 rounded-full bg-green-600 animate-pulse"></span>
                                <span className="text-sm font-medium text-green-700 dark:text-green-300">{ROOM_AVAILABILITY_STATUS_TEXT[ROOM_AVAILABILITY_STATUS.AVAILABLE]}</span>
                              </div>
                            )}
                            {room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED && (
                              <>
                                <div className="flex items-center space-x-2">
                                  <span className="h-3 w-3 rounded-full bg-orange-600"></span>
                                  <span className="text-sm font-medium text-orange-700 dark:text-orange-300">{ROOM_AVAILABILITY_STATUS_TEXT[ROOM_AVAILABILITY_STATUS.OCCUPIED]}</span>
                                </div>
                                {room.active_transaction_client_name && (
                                  <div className="flex items-center text-xs text-muted-foreground mt-1">
                                      <User className="h-3 w-3 mr-1 flex-shrink-0 text-primary" />
                                      <span className="font-medium text-foreground mr-1">Guest:</span>
                                      {room.active_transaction_client_name}
                                  </div>
                                )}
                                {room.active_transaction_check_in_time && (
                                  <p className="text-xs text-muted-foreground">Checked-in: {new Date(room.active_transaction_check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                                )}
                              </>
                            )}
                            {room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED && (
                              <>
                                <div className="flex items-center space-x-2">
                                  <span className="h-3 w-3 rounded-full bg-blue-600"></span>
                                  <span className="text-sm font-medium text-blue-700 dark:text-blue-300">{ROOM_AVAILABILITY_STATUS_TEXT[ROOM_AVAILABILITY_STATUS.RESERVED]}</span>
                                </div>
                                {room.active_transaction_client_name && (
                                  <div className="flex items-center text-xs text-muted-foreground mt-1">
                                      <User className="h-3 w-3 mr-1 flex-shrink-0 text-primary" />
                                      <span className="font-medium text-foreground mr-1">Client:</span>
                                      {room.active_transaction_client_name}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                          
                          <div className="mt-auto pt-3 space-y-2 border-t flex flex-col">
                            {room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && (
                                <>
                                    <Button
                                        variant="default"
                                        size="sm"
                                        className="w-full"
                                        onClick={(e) => { e.stopPropagation(); handleOpenBookingDialog(room, 'book'); }}
                                        title="Book this room for immediate check-in"
                                    >
                                        <LogIn className="mr-2 h-4 w-4" /> Book Room
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="w-full"
                                        onClick={(e) => { e.stopPropagation(); handleOpenBookingDialog(room, 'reserve'); }}
                                        title="Reserve this room"
                                    >
                                        <CalendarClock className="mr-2 h-4 w-4" /> Reserve Room
                                    </Button>
                                </>
                            )}
                            {room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED && (
                                <>
                                    <Button 
                                        variant="outline" 
                                        size="sm" 
                                        className="w-full"
                                        title="View Transaction Details" 
                                        onClick={(e) => { e.stopPropagation(); handleViewDetails(room);}}
                                    >
                                        <Info className="mr-2 h-4 w-4" /> View Details
                                    </Button>
                                    <AlertDialog open={isCheckoutConfirmOpen && roomForActionConfirmation?.id === room.id} onOpenChange={(open) => { if (!open) { setIsCheckoutConfirmOpen(false); setRoomForActionConfirmation(null); setActiveTransactionIdForAction(null); } }}>
                                        <AlertDialogTrigger asChild onClick={(e) => e.stopPropagation()}>
                                            <Button 
                                                variant="destructive" 
                                                size="sm" 
                                                className="w-full"
                                                title="Check-out Guest" 
                                                onClick={(e) => {e.stopPropagation(); handleOpenCheckoutConfirmation(room);}}
                                            >
                                                <LogOutIcon className="mr-2 h-4 w-4" /> Check-out
                                            </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>Confirm Check-out</AlertDialogTitle>
                                                <AlertDialogDescription>
                                                Are you sure you want to check out the guest from room {roomForActionConfirmation?.room_name} ({roomForActionConfirmation?.room_code})?
                                                This action will finalize the transaction.
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel onClick={(e) => { e.stopPropagation(); setIsCheckoutConfirmOpen(false); setRoomForActionConfirmation(null); setActiveTransactionIdForAction(null);}}>Cancel</AlertDialogCancel>
                                                <AlertDialogAction onClick={(e) => { e.stopPropagation(); handleConfirmCheckout(); }} disabled={isSubmitting}>
                                                    {isSubmitting ? <Loader2 className="animate-spin" /> : "Confirm Check-out"}
                                                </AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </>
                            )}
                            {room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED && (
                                <>
                                    <Button 
                                        variant="outline" 
                                        size="sm" 
                                        className="w-full"
                                        title="View Reservation Details" 
                                        onClick={(e) => { e.stopPropagation(); handleViewDetails(room); }}
                                    >
                                        <Info className="mr-2 h-4 w-4" /> View Details
                                    </Button>
                                    <AlertDialog open={isCheckInReservedConfirmOpen && roomForActionConfirmation?.id === room.id} onOpenChange={(open) => { if (!open) { setIsCheckInReservedConfirmOpen(false); setRoomForActionConfirmation(null); setActiveTransactionIdForAction(null); } }}>
                                        <AlertDialogTrigger asChild onClick={(e) => e.stopPropagation()}>
                                            <Button
                                                variant="default"
                                                size="sm"
                                                className="w-full"
                                                title="Check-in Reserved Guest"
                                                onClick={(e) => { e.stopPropagation(); handleOpenCheckInReservedConfirmation(room); }}
                                            >
                                                <LogIn className="mr-2 h-4 w-4" /> Check-in Reserved
                                            </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>Confirm Reserved Check-in</AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    Are you sure you want to check-in the guest for room {roomForActionConfirmation?.room_name} ({roomForActionConfirmation?.room_code})? This will update the reservation to an active booking.
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel onClick={(e) => { e.stopPropagation(); setIsCheckInReservedConfirmOpen(false); setRoomForActionConfirmation(null); setActiveTransactionIdForAction(null); }}>Cancel</AlertDialogCancel>
                                                <AlertDialogAction onClick={(e) => { e.stopPropagation(); handleConfirmCheckInReservedGuest(); }} disabled={isSubmitting}>
                                                    {isSubmitting ? <Loader2 className="animate-spin" /> : "Confirm Check-in"}
                                                </AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </>
                            )}
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

      {/* Booking Dialog */}
      <Dialog open={isBookingDialogOpen} onOpenChange={(isOpen) => {
          if (!isOpen) {
            setSelectedRoomForBooking(null);
            setBookingMode(null);
            bookingForm.reset(defaultBookingFormValues);
          }
          setIsBookingDialogOpen(isOpen);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
                {bookingMode === 'book' ? `Book Room: ${selectedRoomForBooking?.room_name} (${selectedRoomForBooking?.room_code})` : 
                 bookingMode === 'reserve' ? `Reserve Room: ${selectedRoomForBooking?.room_name} (${selectedRoomForBooking?.room_code})` : 
                 'Room Action'}
            </DialogTitle>
          </DialogHeader>
          <Form {...bookingForm}>
            <form onSubmit={bookingForm.handleSubmit(handleBookingSubmit)} className="space-y-4 py-4">
              <FormField control={bookingForm.control} name="client_name" render={({ field }) => (
                <FormItem><Label>Client Name *</Label><FormControl><Input placeholder="John Doe" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={bookingForm.control} name="selected_rate_id" render={({ field }) => (
                <FormItem>
                    <Label>Select Rate *</Label>
                    <Select
                        onValueChange={(value) => field.onChange(value ? parseInt(value) : undefined)} 
                        value={field.value?.toString()} 
                        disabled={applicableRatesForBookingDialog.length === 0}
                    >
                        <FormControl>
                            <SelectTrigger>
                                <SelectValue placeholder={ applicableRatesForBookingDialog.length === 0 ? "No rates for this room" : "Select a rate"} />
                            </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                            {applicableRatesForBookingDialog.map(rate => (
                                <SelectItem key={rate.id} value={rate.id.toString()}>
                                    {rate.name} (₱{Number(rate.price).toFixed(2)})
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <FormMessage />
                </FormItem>
              )} />
              <FormField control={bookingForm.control} name="client_payment_method" render={({ field }) => (
                <FormItem><Label>Payment Method *</Label>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select payment method" /></SelectTrigger></FormControl>
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
                <FormItem><Label>Notes (Optional)</Label><FormControl><Textarea placeholder="Any special requests or notes..." {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
              )} />
              <DialogFooter className="pt-4">
                <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                <Button type="submit" disabled={isSubmitting || applicableRatesForBookingDialog.length === 0}>
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
              setIsTransactionDetailsDialogOpen(false);
              setTransactionDetails(null);
              setEditingModeForDialog(null);
              setIsEditNotesMode(false); // Explicitly reset this
              notesEditForm.reset(defaultNotesEditFormValues);
              reservationEditForm.reset(defaultReservationEditFormValues);
          } else {
              setIsTransactionDetailsDialogOpen(open);
          }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Transaction Details</DialogTitle>
            {transactionDetails?.room_name && <CardDescription>Room: {transactionDetails.room_name} ({transactionDetails.rate_name || 'Rate N/A'})</CardDescription>}
          </DialogHeader>
          {transactionDetails ? (
            <div className="space-y-3 text-sm py-2">
              <p><strong>Status:</strong> {TRANSACTION_STATUS_TEXT[transactionDetails.status as keyof typeof TRANSACTION_STATUS_TEXT] || 'Unknown'}</p>
              <p><strong>Checked-in/Reserved On:</strong> {new Date(transactionDetails.check_in_time).toLocaleString()}</p>
              {transactionDetails.check_out_time && (<p><strong>Check-out:</strong> {new Date(transactionDetails.check_out_time).toLocaleString()}</p>)}
              {transactionDetails.hours_used !== undefined && transactionDetails.hours_used !== null && (<p><strong>Hours Used:</strong> {transactionDetails.hours_used}</p>)}
              {transactionDetails.total_amount !== undefined && transactionDetails.total_amount !== null && (<p><strong>Total Amount:</strong> ₱{Number(transactionDetails.total_amount).toFixed(2)}</p>)}
              
              {editingModeForDialog === 'fullReservation' && transactionDetails.status === TRANSACTION_STATUS.ADVANCE_PAID ? (
                <Form {...reservationEditForm}>
                  <form onSubmit={reservationEditForm.handleSubmit(handleReservationEditSubmit)} className="space-y-3 pt-3 border-t mt-3">
                    <FormField control={reservationEditForm.control} name="client_name" render={({ field }) => (
                      <FormItem><Label>Client Name</Label><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={reservationEditForm.control} name="client_payment_method" render={({ field }) => (
                      <FormItem><Label>Payment Method</Label>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select payment method" /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="Cash">Cash</SelectItem><SelectItem value="Card">Card</SelectItem>
                            <SelectItem value="Online Payment">Online Payment</SelectItem><SelectItem value="Other">Other</SelectItem>
                          </SelectContent>
                        </Select><FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={reservationEditForm.control} name="notes" render={({ field }) => (
                      <FormItem><Label>Notes</Label><FormControl><Textarea {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
                    )} />
                     <div className="flex justify-end space-x-2 pt-2">
                        <Button type="submit" size="sm" disabled={isSubmitting}>
                            {isSubmitting ? <Loader2 className="animate-spin h-3 w-3" /> : "Save Reservation Changes"}
                        </Button>
                         <Button type="button" variant="outline" size="sm" onClick={() => { setEditingModeForDialog(null); setIsEditNotesMode(false); }}>Cancel Edit</Button>
                    </div>
                  </form>
                </Form>
              ) : isEditNotesMode && editingModeForDialog === 'notesOnly' && transactionDetails.status === TRANSACTION_STATUS.UNPAID ? (
                <Form {...notesEditForm}>
                  <form onSubmit={notesEditForm.handleSubmit(handleUpdateTransactionDetails)} className="space-y-3 pt-3 border-t mt-3">
                     <p><strong>Client:</strong> {transactionDetails.client_name}</p>
                     <p><strong>Payment Method:</strong> {transactionDetails.client_payment_method}</p>
                    <FormField control={notesEditForm.control} name="notes" render={({ field }) => (
                      <FormItem><Label>Notes</Label><FormControl><Textarea {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <div className="flex justify-end space-x-2 pt-2">
                        <Button type="submit" size="sm" disabled={isSubmitting}>
                            {isSubmitting ? <Loader2 className="animate-spin h-3 w-3" /> : "Save Notes"}
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => setIsEditNotesMode(false)}>Cancel Edit</Button>
                    </div>
                  </form>
                </Form>
              ) : ( 
                 <div className="pt-3 border-t mt-3 space-y-1">
                    <p><strong>Client:</strong> {transactionDetails.client_name}</p>
                    <p><strong>Payment Method:</strong> {transactionDetails.client_payment_method}</p>
                    <div className="flex justify-between items-center">
                        {isEditNotesMode ? null : <Label>Notes:</Label>}
                        {!isEditNotesMode && (transactionDetails.status === TRANSACTION_STATUS.UNPAID || transactionDetails.status === TRANSACTION_STATUS.ADVANCE_PAID) && (
                            <Button variant="ghost" size="sm" onClick={() => {
                                if (transactionDetails.status === TRANSACTION_STATUS.UNPAID) {
                                    setEditingModeForDialog('notesOnly'); 
                                    notesEditForm.reset({ notes: transactionDetails.notes || '' });
                                    setIsEditNotesMode(true); 
                                } else if (transactionDetails.status === TRANSACTION_STATUS.ADVANCE_PAID) {
                                    setEditingModeForDialog('fullReservation'); 
                                    reservationEditForm.reset({
                                        client_name: transactionDetails.client_name,
                                        client_payment_method: transactionDetails.client_payment_method,
                                        notes: transactionDetails.notes || '',
                                    });
                                }
                            }}><Edit3 className="h-3 w-3 mr-1" /> Edit Details</Button>
                        )}
                    </div>
                    {!isEditNotesMode && editingModeForDialog !== 'fullReservation' && (
                        <p className="text-muted-foreground whitespace-pre-wrap min-h-[40px] p-2 border rounded-md bg-accent/10">
                            {transactionDetails.notes || "No notes yet."}
                        </p>
                    )}
                 </div>
              )}

            </div>
          ) : <p className="py-4">Loading details or no active transaction...</p>}
          <DialogFooter className="pt-4 flex flex-row justify-end space-x-2">
             {transactionDetails && transactionDetails.status === TRANSACTION_STATUS.ADVANCE_PAID && !editingModeForDialog && (
                <AlertDialog 
                    open={isCancelReservationConfirmOpen && roomForActionConfirmation?.id === transactionDetails.hotel_room_id && activeTransactionIdForAction === transactionDetails.id} 
                    onOpenChange={(open) => { 
                        if (!open) { 
                            setIsCancelReservationConfirmOpen(false); 
                            setRoomForActionConfirmation(null);
                            setActiveTransactionIdForAction(null);
                        } else {
                             const room = rooms.find(r => r.id === transactionDetails.hotel_room_id);
                             if (room) {
                                setRoomForActionConfirmation(room);
                                setActiveTransactionIdForAction(transactionDetails.id);
                                setIsCancelReservationConfirmOpen(true);
                             }
                        }
                    }}
                >
                    <AlertDialogTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button 
                            variant="destructive" 
                            size="sm" 
                            onClick={(e) => { e.stopPropagation(); 
                                const originalRoom = rooms.find(r => r.id === transactionDetails.hotel_room_id);
                                if (originalRoom) {
                                    handleOpenCancelReservationConfirmation(originalRoom);
                                } else {
                                    toast({title: "Error", description: "Could not find room details for cancellation.", variant: "destructive"});
                                }
                            }}
                            disabled={isSubmitting}
                        >
                            <Ban className="mr-2 h-4 w-4" /> Cancel Reservation
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Confirm Cancellation</AlertDialogTitle>
                            <AlertDialogDescription>
                                Are you sure you want to cancel this reservation for room {roomForActionConfirmation?.room_name}?
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel onClick={(e) => { e.stopPropagation(); setIsCancelReservationConfirmOpen(false); setRoomForActionConfirmation(null); setActiveTransactionIdForAction(null);}}>No</AlertDialogCancel>
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
            }}>Close</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

    