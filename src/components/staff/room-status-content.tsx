
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription as ShadDialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription as ShadAlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Label } from "@/components/ui/label";
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BedDouble, Loader2, Info, User, LogOutIcon, LogIn, CalendarClock, Edit3, Ban, CheckCircle2, CalendarPlus, Tags, Eye, X } from "lucide-react";
import type { HotelRoom, Transaction, SimpleRate, GroupedRooms } from '@/lib/types';
import { listRoomsForBranch, getRatesForBranchSimple } from '@/actions/admin';
import {
  createTransactionAndOccupyRoom,
  getActiveTransactionForRoom,
  checkOutGuestAndFreeRoom,
  updateTransactionNotes,
  createReservation,
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
import { format, parseISO } from 'date-fns';


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

const defaultReservationEditFormValues: TransactionReservedUpdateData = {
  client_name: '',
  client_payment_method: undefined,
  notes: '',
};


export default function RoomStatusContent({ tenantId, branchId, staffUserId, showAvailableRoomsOverview, onCloseAvailableRoomsOverview }: RoomStatusContentProps) {
  const [rooms, setRooms] = useState<HotelRoom[]>([]);
  const [groupedRooms, setGroupedRooms] = useState<GroupedRooms>({});
  const [isLoading, setIsLoading] = useState(true);

  const [bookingMode, setBookingMode] = useState<'book' | 'reserve' | null>(null);
  const [isBookingDialogOpen, setIsBookingDialogOpen] = useState(false);
  const [selectedRoomForBooking, setSelectedRoomForBooking] = useState<HotelRoom | null>(null);

  const [isTransactionDetailsDialogOpen, setIsTransactionDetailsDialogOpen] = useState(false);
  const [transactionDetails, setTransactionDetails] = useState<Transaction | null>(null);
  const [editingModeForDialog, setEditingModeForDialog] = useState<'notesOnly' | 'fullReservation' | null>(null);

  const [isNotesOnlyModalOpen, setIsNotesOnlyModalOpen] = useState(false);
  const [currentNotesForDisplay, setCurrentNotesForDisplay] = useState<string | null>(null);

  const [roomForActionConfirmation, setRoomForActionConfirmation] = useState<HotelRoom | null>(null);
  const [activeTransactionIdForAction, setActiveTransactionIdForAction] = useState<number | null>(null);
  const [isCheckoutConfirmOpen, setIsCheckoutConfirmOpen] = useState(false);
  const [isCancelReservationConfirmOpen, setIsCancelReservationConfirmOpen] = useState(false);
  const [isCheckInReservedConfirmOpen, setIsCheckInReservedConfirmOpen] = useState(false);

  const [allBranchActiveRates, setAllBranchActiveRates] = useState<SimpleRate[]>([]);
  const [applicableRatesForBookingDialog, setApplicableRatesForBookingDialog] = useState<SimpleRate[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const [isRoomRatesDetailModalOpen, setIsRoomRatesDetailModalOpen] = useState(false);
  const [selectedRoomForRatesDisplay, setSelectedRoomForRatesDisplay] = useState<HotelRoom | null>(null);


  const bookingForm = useForm<TransactionCreateData>({
    resolver: zodResolver(transactionCreateSchema),
    defaultValues: defaultBookingFormValues,
  });

  const notesForm = useForm<TransactionUpdateNotesData>({
    resolver: zodResolver(transactionUpdateNotesSchema),
    defaultValues: defaultNotesEditFormValues,
  });

  const reservationEditForm = useForm<TransactionReservedUpdateData>({
    resolver: zodResolver(transactionReservedUpdateSchema),
    defaultValues: defaultReservationEditFormValues,
  });

  const updateRoomInLocalState = useCallback((updatedRoomData: Partial<HotelRoom> & { id: number }) => {
    console.log("[RoomStatusContent] updateRoomInLocalState called for room ID:", updatedRoomData.id, "with data:", updatedRoomData);
    setRooms(prevRooms => {
      const newRooms = prevRooms.map(r =>
        r.id === updatedRoomData.id ? { ...r, ...updatedRoomData } : r
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

    const roomRateIds = Array.isArray(room.hotel_rate_id) ? room.hotel_rate_id : [];
    const applicableRates = allBranchActiveRates.filter(branchRate =>
        roomRateIds.includes(branchRate.id)
    );
    setApplicableRatesForBookingDialog(applicableRates);

    if (applicableRates.length === 0) {
        toast({title: "No Applicable Rates", description: "This room has no active rates assigned for booking/reservation.", variant: "default"});
    }

    setSelectedRoomForBooking(room);
    setBookingMode(mode);

    const defaultRateIdForForm = applicableRates.length > 0 ? applicableRates[0].id : undefined;
    bookingForm.reset({...defaultBookingFormValues, selected_rate_id: defaultRateIdForForm });
    setIsBookingDialogOpen(true);
  };

  const handleBookingSubmit = async (data: TransactionCreateData) => {
    if (!selectedRoomForBooking || !staffUserId || !tenantId || !branchId || !data.selected_rate_id || !bookingMode) {
      toast({ title: "Submission Error",
      description: `Booking details incomplete. Room: ${!!selectedRoomForBooking}, Staff: ${!!staffUserId}, Tenant: ${!!tenantId}, Branch: ${!!branchId}, Rate Selected: ${!!data.selected_rate_id}, Mode: ${bookingMode}`,
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
    if (!room.transaction_id) {
        toast({ title: "Info", description: "No transaction ID linked to this room.", variant: "default" });
        return;
    }
    if (!tenantId || !branchId) {
        toast({ title: "Error", description: "Tenant or Branch ID missing.", variant: "destructive" });
        return;
    }

    setIsSubmitting(true);
    try {
      const transaction = await getActiveTransactionForRoom(room.transaction_id, tenantId, branchId);
      if (transaction) {
        setTransactionDetails(transaction);
        if (room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED && transaction.status === TRANSACTION_STATUS.UNPAID) {
          setEditingModeForDialog('notesOnly');
          notesForm.reset({ notes: transaction.notes || '' });
        } else if (room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED && transaction.status === TRANSACTION_STATUS.ADVANCE_PAID) {
          setEditingModeForDialog('fullReservation');
          reservationEditForm.reset({
            client_name: transaction.client_name,
            client_payment_method: transaction.client_payment_method || undefined,
            notes: transaction.notes || '',
          });
        } else {
           setEditingModeForDialog(null); // View only if not one of the above
        }
        setIsTransactionDetailsDialogOpen(true);
      } else {
        toast({ title: "No Details", description: `No active or reserved transaction found. It might be completed or cancelled.`, variant: "default" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to fetch transaction details.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  }, [tenantId, branchId, toast, notesForm, reservationEditForm]);


  const handleOpenCheckoutConfirmation = useCallback((room: HotelRoom) => {
    if (!tenantId || !branchId) {
        toast({ title: "Error", description: "Tenant or branch information missing.", variant: "destructive" });
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
    setRoomForActionConfirmation(room);
    setActiveTransactionIdForAction(room.transaction_id);
    setIsCheckoutConfirmOpen(true);
  }, [tenantId, branchId, toast]);

  const handleConfirmCheckout = async () => {
    if (!activeTransactionIdForAction || !roomForActionConfirmation || !staffUserId || !tenantId || !branchId) {
      toast({ title: "Checkout Error", description: "Room, transaction, or staff details missing for checkout.", variant: "destructive" });
      setIsCheckoutConfirmOpen(false);
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

  const handleOpenCancelReservationConfirmation = useCallback((room: HotelRoom) => {
    if (!tenantId || !branchId) {
        toast({ title: "Error", description: "Tenant or branch information missing.", variant: "destructive" });
        return;
    }
     if (!room.transaction_id) {
        toast({ title: "Action Not Allowed", description: "No transaction linked to cancel.", variant: "default" });
        return;
    }
    setRoomForActionConfirmation(room);
    setActiveTransactionIdForAction(room.transaction_id);
    setIsCancelReservationConfirmOpen(true);
  }, [tenantId, branchId, toast]);

  const handleConfirmCancelReservation = async () => {
    if (!activeTransactionIdForAction || !roomForActionConfirmation || !tenantId || !branchId) {
      toast({ title: "Cancellation Error", description: "Required information for cancellation is missing.", variant: "destructive" });
      setIsCancelReservationConfirmOpen(false);
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

  const handleOpenCheckInReservedConfirmation = useCallback((room: HotelRoom) => {
    if (!tenantId || !branchId || !staffUserId) {
        toast({ title: "Error", description: "Required details missing for check-in.", variant: "destructive" });
        return;
    }
    if (room.is_available !== ROOM_AVAILABILITY_STATUS.RESERVED) {
        toast({ title: "Action Not Allowed", description: "Room is not currently reserved.", variant: "default" });
        return;
    }
    if (!room.transaction_id) {
        toast({ title: "Action Not Allowed", description: "No transaction linked to check-in.", variant: "default" });
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
            setTransactionDetails(result.updatedTransaction); // Update details in the dialog
            setEditingModeForDialog(null); // Exit edit mode for notes
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

        // Update client name on the card if it changed
        const roomToUpdate = rooms.find(r => r.transaction_id === result.updatedTransaction!.id);
        if (roomToUpdate && result.updatedTransaction.client_name && roomToUpdate.active_transaction_client_name !== result.updatedTransaction.client_name) {
             updateRoomInLocalState({
                id: roomToUpdate.id,
                active_transaction_client_name: result.updatedTransaction.client_name,
            });
        }
         setEditingModeForDialog(null); // Exit full edit mode
      } else {
        toast({ title: "Update Failed", description: result.message, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Unexpected error updating reservation.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenNotesOnlyModal = useCallback(async (room: HotelRoom) => {
    if (!room.transaction_id || !tenantId || !branchId) {
      toast({ title: "Info", description: "Transaction details not available.", variant: "default" });
      return;
    }
    setIsSubmitting(true);
    try {
      const transaction = await getActiveTransactionForRoom(room.transaction_id, tenantId, branchId);
      if (transaction) {
        setCurrentNotesForDisplay(transaction.notes || "No notes available for this transaction.");
        setIsNotesOnlyModalOpen(true);
      } else {
        toast({ title: "Info", description: "No active transaction found to display notes.", variant: "default" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to fetch notes.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  }, [tenantId, branchId, toast]);

  if (isLoading) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2 text-muted-foreground">Loading room statuses...</p></div>;
  }
  if (!branchId && !isLoading) {
    return <Card><CardHeader><div className="flex items-center space-x-2"><BedDouble className="h-6 w-6 text-primary" /><CardTitle>Room Status</CardTitle></div><CardDescription>View current room availability.</CardDescription></CardHeader><CardContent><p className="text-muted-foreground">No branch assigned or selected. Please ensure your staff account is assigned to a branch.</p></CardContent></Card>;
  }
  if (rooms.length === 0 && !isLoading) {
    return <Card><CardHeader><div className="flex items-center space-x-2"><BedDouble className="h-6 w-6 text-primary" /><CardTitle>Room Status</CardTitle></div><CardDescription>View current room availability.</CardDescription></CardHeader><CardContent><p className="text-muted-foreground">No active rooms found for this branch. Rooms may need to be added by an administrator.</p></CardContent></Card>;
  }

  return (
    <div className="space-y-1">
      <Accordion type="multiple" defaultValue={[]} className="w-full space-y-1">
        {Object.entries(groupedRooms).map(([floor, floorRooms]) => {
          const availableCount = floorRooms.filter(room => room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE).length;
          const occupiedCount = floorRooms.filter(room => room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED).length;
          const reservedCount = floorRooms.filter(room => room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED).length;

          return (
            <AccordionItem value={floor} key={floor} className="border bg-card rounded-md shadow-sm">
              <AccordionTrigger className={cn(
                "text-xl font-semibold px-4 py-3 hover:no-underline",
                "sticky top-0 z-10 shadow-sm bg-inherit"
              )}>
                <div className="flex justify-between items-center w-full">
                  <span>Floor: {floor.replace('Ground Floor / Other', 'Ground Floor / Unspecified')}</span>
                    <span className="text-xs font-normal ml-4 flex items-center space-x-2">
                        <span className="flex items-center text-green-600"><CheckCircle2 className="h-4 w-4 mr-1" /> {availableCount}</span>
                        <span className="flex items-center text-orange-600"><User className="h-4 w-4 mr-1" /> {occupiedCount}</span>
                        <span className="flex items-center text-yellow-600"><CalendarClock className="h-4 w-4 mr-1" /> {reservedCount}</span>
                    </span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4 pt-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {floorRooms.map(room => {
                     console.log(`Rendering Room Card: Name: ${room.room_name}, Available: ${room.is_available}, Active Tx ID: ${room.transaction_id}, Client Name: ${room.active_transaction_client_name}`);
                    return (
                      <Card
                        key={room.id}
                        className="shadow-md hover:shadow-lg transition-shadow duration-200 flex flex-col"
                      >
                        <CardHeader className={cn(
                          "p-4 rounded-t-lg relative",
                          room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && "bg-green-500 text-white",
                          room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED && "bg-orange-500 text-white",
                          room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED && "bg-yellow-500 text-white"
                        )}>
                           <div className="flex justify-between items-start">
                            <div>
                              <CardTitle className="text-lg truncate" title={room.room_name}>{room.room_name}</CardTitle>
                              <CardDescription className="text-xs text-white/90">
                                Room # : {room.room_code}
                              </CardDescription>
                            </div>
                            {room.is_available !== ROOM_AVAILABILITY_STATUS.AVAILABLE && room.transaction_id && (
                              <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-white hover:bg-white/20 p-1"
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
                        <CardContent className="p-4 pt-2 flex-grow flex flex-col justify-between">
                          <div className="mb-3 space-y-1">
                            {room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && (
                              <div className="flex items-center space-x-2">
                                <span className="h-3 w-3 rounded-full bg-green-600 animate-pulse"></span>
                                <span className="text-sm font-medium text-green-700 dark:text-green-300">{ROOM_AVAILABILITY_STATUS_TEXT[ROOM_AVAILABILITY_STATUS.AVAILABLE]}</span>
                              </div>
                            )}
                            {room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED && (
                              <>
                                <div className="flex items-center space-x-2">
                                  <span className="h-3 w-3 rounded-full bg-orange-500"></span>
                                  <span className="text-sm font-medium text-orange-700 dark:text-orange-300">{ROOM_AVAILABILITY_STATUS_TEXT[ROOM_AVAILABILITY_STATUS.OCCUPIED]}</span>
                                </div>
                                {room.active_transaction_client_name && (
                                  <div className="flex items-center text-xs mt-1">
                                      <User className="h-3 w-3 mr-1 flex-shrink-0 text-primary" />
                                      <span className="font-medium text-foreground mr-1">Guest:</span>
                                      <span className="text-muted-foreground truncate" title={room.active_transaction_client_name}>
                                        {room.active_transaction_client_name}
                                      </span>
                                  </div>
                                )}
                                {room.active_transaction_check_in_time && (
                                  <p className="text-xs text-muted-foreground">
                                    Checked-in: {format(parseISO(room.active_transaction_check_in_time.replace(' ', 'T')), 'yyyy-MM-dd hh:mm:ss aa')}
                                  </p>
                                )}
                              </>
                            )}
                            {room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED && (
                              <>
                                <div className="flex items-center space-x-2">
                                  <span className="h-3 w-3 rounded-full bg-yellow-500"></span>
                                  <span className="text-sm font-medium text-yellow-600 dark:text-yellow-400">{ROOM_AVAILABILITY_STATUS_TEXT[ROOM_AVAILABILITY_STATUS.RESERVED]}</span>
                                </div>
                                {room.active_transaction_client_name && (
                                  <div className="flex items-center text-xs mt-1">
                                      <User className="h-3 w-3 mr-1 flex-shrink-0 text-primary" />
                                      <span className="font-medium text-foreground mr-1">Client:</span>
                                       <span className="text-muted-foreground truncate" title={room.active_transaction_client_name}>
                                        {room.active_transaction_client_name}
                                      </span>
                                  </div>
                                )}
                              </>
                            )}
                          </div>

                          <div className="mt-auto pt-3 border-t flex flex-col space-y-2">
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
                                        <CalendarPlus className="mr-2 h-4 w-4" /> Reserve Room
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
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (room.transaction_id) {
                                              handleViewDetails(room);
                                            } else {
                                              toast({title: "Info", description: "No active transaction ID linked to this room.", variant: "default"})
                                            }
                                        }}
                                    >
                                        <Info className="mr-2 h-4 w-4" /> View Details
                                    </Button>
                                    <AlertDialog open={isCheckoutConfirmOpen && roomForActionConfirmation?.id === room.id} onOpenChange={(open) => { if (!open && roomForActionConfirmation?.id === room.id ) { setIsCheckoutConfirmOpen(false); setRoomForActionConfirmation(null); setActiveTransactionIdForAction(null); } else if (open) { setIsCheckoutConfirmOpen(true); } }}>
                                        <AlertDialogTrigger asChild>
                                             <Button
                                                variant="destructive"
                                                size="sm"
                                                className="w-full"
                                                title="Check-out Guest"
                                                onClick={(e) => { e.stopPropagation(); if(room.transaction_id) handleOpenCheckoutConfirmation(room);}}
                                            >
                                                <LogOutIcon className="mr-2 h-4 w-4" /> Check-out
                                            </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>Confirm Check-out</AlertDialogTitle>
                                                <ShadAlertDialogDescription>
                                                Are you sure you want to check out the guest from room {roomForActionConfirmation?.room_name} ({roomForActionConfirmation?.room_code})?
                                                This action will finalize the transaction.
                                                </ShadAlertDialogDescription>
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
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (room.transaction_id) {
                                              handleViewDetails(room);
                                            } else {
                                              toast({title: "Info", description: "No reservation transaction ID linked to this room.", variant: "default"})
                                            }
                                        }}
                                    >
                                        <Info className="mr-2 h-4 w-4" /> View Details
                                    </Button>
                                     <AlertDialog open={isCheckInReservedConfirmOpen && roomForActionConfirmation?.id === room.id} onOpenChange={(open) => { if (!open && roomForActionConfirmation?.id === room.id) { setIsCheckInReservedConfirmOpen(false); setRoomForActionConfirmation(null); setActiveTransactionIdForAction(null); } else if (open) { setIsCheckInReservedConfirmOpen(true);}}}>
                                        <AlertDialogTrigger asChild>
                                            <Button
                                                variant="default"
                                                size="sm"
                                                className="w-full"
                                                title="Check-in Reserved Guest"
                                                onClick={(e) => { e.stopPropagation(); if(room.transaction_id) handleOpenCheckInReservedConfirmation(room); }}
                                            >
                                                <LogIn className="mr-2 h-4 w-4" /> Check-in Reserved
                                            </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>Confirm Reserved Check-in</AlertDialogTitle>
                                                <ShadAlertDialogDescription>
                                                    Are you sure you want to check-in the guest for room {roomForActionConfirmation?.room_name} ({roomForActionConfirmation?.room_code})? This will update the reservation to an active booking.
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
                                    <AlertDialog open={isCancelReservationConfirmOpen && roomForActionConfirmation?.id === room.id && activeTransactionIdForAction === room.transaction_id} onOpenChange={(open) => { if (!open && roomForActionConfirmation?.id === room.id) { setIsCancelReservationConfirmOpen(false); setRoomForActionConfirmation(null); setActiveTransactionIdForAction(null); } else if (open) { setIsCancelReservationConfirmOpen(true); }}}>
                                        <AlertDialogTrigger asChild>
                                            <Button
                                                variant="destructive"
                                                size="sm"
                                                className="w-full"
                                                title="Cancel this Reservation"
                                                onClick={(e) => { e.stopPropagation(); if(room.transaction_id) handleOpenCancelReservationConfirmation(room); }}
                                            >
                                                <Ban className="mr-2 h-4 w-4" /> Cancel Reservation
                                            </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>Confirm Cancellation</AlertDialogTitle>
                                                <ShadAlertDialogDescription>
                                                    Are you sure you want to cancel the reservation for room {roomForActionConfirmation?.room_name} ({roomForActionConfirmation?.room_code})?
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
            setApplicableRatesForBookingDialog([]);
          }
          setIsBookingDialogOpen(isOpen);
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
                  <FormItem><Label>Client Name *</Label><FormControl><Input placeholder="John Doe" {...field} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={bookingForm.control} name="selected_rate_id" render={({ field }) => (
                  <FormItem>
                      <Label>Select Rate *</Label>
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
                  <FormItem><Label>Notes (Optional)</Label><FormControl><Textarea placeholder="Any special requests or notes..." {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <DialogFooter className="bg-card py-2 border-t px-3 sticky bottom-0 z-10">
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
              notesForm.reset(defaultNotesEditFormValues);
              reservationEditForm.reset(defaultReservationEditFormValues);
          } else {
              setIsTransactionDetailsDialogOpen(open);
          }
      }}>
        <DialogContent className="sm:max-w-md p-3">
          <DialogHeader>
            <DialogTitle>Transaction Details</DialogTitle>
            {transactionDetails?.room_name && <ShadDialogDescription>Room: {transactionDetails.room_name} ({transactionDetails.rate_name || 'Rate N/A'})</ShadDialogDescription>}
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
                  <form onSubmit={reservationEditForm.handleSubmit(handleReservationEditSubmit)} className="space-y-3 pt-3 border-t mt-3">
                    <FormField control={reservationEditForm.control} name="client_name" render={({ field }) => (
                      <FormItem><Label>Client Name</Label><FormControl><Input {...field} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={reservationEditForm.control} name="client_payment_method" render={({ field }) => (
                      <FormItem><Label>Payment Method</Label>
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
                      <FormItem><Label>Notes</Label><FormControl><Textarea {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
                    )} />
                     <div className="flex justify-end space-x-2 pt-2">
                        <Button type="submit" size="sm" disabled={isSubmitting}>
                            {isSubmitting ? <Loader2 className="animate-spin h-3 w-3" /> : "Save Reservation Changes"}
                        </Button>
                         <Button type="button" variant="outline" size="sm" onClick={() => { setEditingModeForDialog(null); reservationEditForm.reset(defaultReservationEditFormValues); }}>Cancel Edit</Button>
                    </div>
                  </form>
                </Form>
              ) : editingModeForDialog === 'notesOnly' ? (
                <Form {...notesForm}>
                  <form onSubmit={notesForm.handleSubmit(handleUpdateTransactionDetails)} className="space-y-3 pt-3 border-t mt-3">
                     <p><strong>Client:</strong> {transactionDetails.client_name}</p>
                     <p><strong>Payment Method:</strong> {transactionDetails.client_payment_method || 'N/A'}</p>
                    <FormField control={notesForm.control} name="notes" render={({ field }) => (
                      <FormItem><Label>Notes</Label><FormControl><Textarea {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
                    )} />
                    <div className="flex justify-end space-x-2 pt-2">
                        <Button type="submit" size="sm" disabled={isSubmitting}>
                            {isSubmitting ? <Loader2 className="animate-spin h-3 w-3" /> : "Save Notes"}
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => { setEditingModeForDialog(null); notesForm.reset(defaultNotesEditFormValues);}}>Cancel Edit</Button>
                    </div>
                  </form>
                </Form>
              ) : (
                 <div className="pt-3 border-t mt-3 space-y-1">
                    <p><strong>Client:</strong> {transactionDetails.client_name}</p>
                    <p><strong>Payment Method:</strong> {transactionDetails.client_payment_method || 'N/A'}</p>
                    <div className="flex justify-between items-center">
                        <Label>Notes:</Label>
                        {!editingModeForDialog && (transactionDetails.status === TRANSACTION_STATUS.UNPAID || transactionDetails.status === TRANSACTION_STATUS.ADVANCE_PAID) && (
                            <Button variant="ghost" size="sm" onClick={() => {
                                if (transactionDetails.status === TRANSACTION_STATUS.UNPAID) {
                                    setEditingModeForDialog('notesOnly');
                                    notesForm.reset({ notes: transactionDetails.notes || '' });
                                } else if (transactionDetails.status === TRANSACTION_STATUS.ADVANCE_PAID) {
                                    setEditingModeForDialog('fullReservation');
                                    reservationEditForm.reset({
                                        client_name: transactionDetails.client_name,
                                        client_payment_method: transactionDetails.client_payment_method || undefined,
                                        notes: transactionDetails.notes || '',
                                    });
                                }
                            }}><Edit3 className="h-3 w-3 mr-1" /> Edit Details</Button>
                        )}
                    </div>
                    {!editingModeForDialog && (
                        <p className="text-muted-foreground whitespace-pre-wrap min-h-[40px] p-2 border rounded-md bg-accent/10">
                            {transactionDetails.notes || "No notes yet."}
                        </p>
                    )}
                 </div>
              )}

            </div>
          ) : <p className="py-4">Loading details or no active transaction...</p>}
          <DialogFooter className="pt-4 flex flex-row justify-end space-x-2">
             {transactionDetails && (transactionDetails.status === TRANSACTION_STATUS.ADVANCE_PAID) && !editingModeForDialog && (
                 <AlertDialog
                    open={isCancelReservationConfirmOpen && activeTransactionIdForAction === transactionDetails.id}
                    onOpenChange={(open) => {
                        if (!open && activeTransactionIdForAction === transactionDetails.id) {
                            setIsCancelReservationConfirmOpen(false);
                        } else if(open && transactionDetails?.id){
                            setIsCancelReservationConfirmOpen(true);
                            const originalRoom = rooms.find(r => r.transaction_id === transactionDetails.id);
                            setRoomForActionConfirmation(originalRoom || null);
                            setActiveTransactionIdForAction(transactionDetails.id);
                        }
                    }}
                >
                    <AlertDialogTrigger asChild>
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={(e) => { e.stopPropagation();
                                const originalRoom = rooms.find(r => r.transaction_id === transactionDetails.id);
                                if (originalRoom && transactionDetails.id) {
                                    handleOpenCancelReservationConfirmation(originalRoom);
                                } else {
                                    toast({title: "Error", description: "Could not find linked room details or transaction ID for cancellation.", variant: "destructive"});
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
                            <ShadAlertDialogDescription>
                                Are you sure you want to cancel this reservation for room {roomForActionConfirmation?.room_name}?
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
            <DialogClose asChild><Button variant="outline" onClick={() => {
              setIsTransactionDetailsDialogOpen(false);
              setTransactionDetails(null);
              setEditingModeForDialog(null);
              notesForm.reset(defaultNotesEditFormValues);
              reservationEditForm.reset(defaultReservationEditFormValues);
            }}>Close</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Notes Only Modal */}
      <Dialog open={isNotesOnlyModalOpen} onOpenChange={setIsNotesOnlyModalOpen}>
        <DialogContent className="sm:max-w-md p-3">
          <DialogHeader className="border-b pb-2 mb-2">
            <DialogTitle>Transaction Notes</DialogTitle>
             <ShadDialogDescription>Room: { (selectedRoomForBooking || (transactionDetails && transactionDetails.room_name) || (roomForActionConfirmation && roomForActionConfirmation.room_name))?.room_name || 'N/A'}</ShadDialogDescription>
          </DialogHeader>
          <div className="py-4 text-sm text-muted-foreground whitespace-pre-wrap min-h-[100px] max-h-[300px] overflow-y-auto border p-2 rounded-md">
            {currentNotesForDisplay || "No notes available."}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsNotesOnlyModalOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Available Rooms Overview Modal */}
      <Dialog open={showAvailableRoomsOverview} onOpenChange={onCloseAvailableRoomsOverview}>
        <DialogContent className="sm:max-w-2xl md:max-w-3xl lg:max-w-4xl p-0 flex flex-col max-h-[90vh] overflow-hidden">
          <DialogHeader className="p-3 border-b">
            <DialogTitle className="flex items-center">
              <Eye className="mr-2 h-5 w-5 text-primary" /> Available Rooms Overview
            </DialogTitle>
          </DialogHeader>

          <div className="flex-grow overflow-y-auto p-4">
            {isLoading ? (
              <div className="flex justify-center items-center h-32">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="ml-2">Loading rooms...</p>
              </div>
            ) : rooms.filter(r => r.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE).length === 0 ? (
              <p className="text-center text-muted-foreground py-10">No rooms are currently available.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {rooms
                  .filter(r => r.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE)
                  .sort((a, b) => (a.room_code || "").localeCompare(b.room_code || ""))
                  .map(room => (
                    <Card key={`avail-${room.id}`} className="shadow-sm bg-card">
                      <CardHeader className="p-3 bg-green-500 text-white rounded-t-lg">
                        <CardTitle className="text-md truncate">{room.room_name}</CardTitle>
                        <ShadDialogDescription className="text-xs text-white/80">
                          Room # : {room.room_code}
                        </ShadDialogDescription>
                      </CardHeader>
                      <CardContent className="p-3 text-sm">
                        <p>Floor: {room.floor ?? 'N/A'}</p>
                        <p>Type: {room.room_type || 'N/A'}</p>
                        <p>Bed: {room.bed_type || 'N/A'}</p>
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

          <DialogFooter className="bg-card py-3 border-t px-4">
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
                <DialogTitle>
                    Rates for Room: {selectedRoomForRatesDisplay?.room_name}
                </DialogTitle>
                <ShadDialogDescription>
                    Room #: {selectedRoomForRatesDisplay?.room_code}
                </ShadDialogDescription>
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
                                        <div key={rate.id} className="p-2 border-b last:border-b-0 text-sm">
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
            <DialogFooter>
                <Button variant="outline" onClick={() => { setIsRoomRatesDetailModalOpen(false); setSelectedRoomForRatesDisplay(null); }}>Close</Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
