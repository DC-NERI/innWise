
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"; // Removed AlertDialogTrigger as it's used as child
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BedDouble, Loader2, Info, LogOutIcon, User } from "lucide-react";
import type { HotelRoom, Transaction, SimpleRate } from '@/lib/types';
import { listRoomsForBranch, getRatesForBranchSimple } from '@/actions/admin'; // getRatesForBranchSimple is from admin actions
import { createTransactionAndOccupyRoom, getActiveTransactionForRoom, checkOutGuestAndFreeRoom } from '@/actions/staff';
import { transactionCreateSchema, TransactionCreateData } from '@/lib/schemas';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface RoomStatusContentProps {
  tenantId: number | null;
  branchId: number | null;
  staffUserId: number | null;
}

interface GroupedRooms {
  [floor: string]: HotelRoom[];
}

const defaultTransactionFormValues: TransactionCreateData = {
  client_name: '',
  client_payment_method: 'Cash',
  notes: '',
  selected_rate_id: undefined as unknown as number, // Ensure it's undefined initially
};

export default function RoomStatusContent({ tenantId, branchId, staffUserId }: RoomStatusContentProps) {
  const [rooms, setRooms] = useState<HotelRoom[]>([]);
  const [groupedRooms, setGroupedRooms] = useState<GroupedRooms>({});
  const [isLoading, setIsLoading] = useState(true);
  
  const [isBookingDialogOpen, setIsBookingDialogOpen] = useState(false);
  const [selectedRoomForBooking, setSelectedRoomForBooking] = useState<HotelRoom | null>(null);
  
  const [isTransactionDetailsDialogOpen, setIsTransactionDetailsDialogOpen] = useState(false);
  const [transactionDetails, setTransactionDetails] = useState<Transaction | null>(null);
  
  const [isCheckoutConfirmOpen, setIsCheckoutConfirmOpen] = useState(false);
  const [roomForCheckoutConfirmation, setRoomForCheckoutConfirmation] = useState<HotelRoom | null>(null);
  const [activeTransactionIdForCheckout, setActiveTransactionIdForCheckout] = useState<number | null>(null);

  const [allBranchActiveRates, setAllBranchActiveRates] = useState<SimpleRate[]>([]);
  const [applicableRatesForBookingDialog, setApplicableRatesForBookingDialog] = useState<SimpleRate[]>([]);


  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const bookingForm = useForm<TransactionCreateData>({
    resolver: zodResolver(transactionCreateSchema),
    defaultValues: defaultTransactionFormValues,
  });

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
      console.log(`[RoomStatusContent] Fetching rooms and rates for tenant: ${tenantId}, branch: ${branchId}`);
      const [fetchedRooms, fetchedBranchRates] = await Promise.all([
        listRoomsForBranch(branchId, tenantId),
        getRatesForBranchSimple(branchId, tenantId) 
      ]);
      
      console.log("[RoomStatusContent] Fetched Rooms:", fetchedRooms);
      console.log("[RoomStatusContent] Fetched Branch Rates:", fetchedBranchRates);

      setRooms(fetchedRooms);
      setAllBranchActiveRates(fetchedBranchRates);

      const grouped = fetchedRooms.reduce((acc, room) => {
        const floorKey = room.floor?.toString() ?? 'Ground Floor / Other';
        if (!acc[floorKey]) acc[floorKey] = [];
        acc[floorKey].push(room);
        acc[floorKey].sort((a, b) => (a.room_name || a.room_code).localeCompare(b.room_name || b.room_code));
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
      console.error("Failed to fetch rooms and rates for staff dashboard:", error);
      toast({ title: "Error", description: `Could not fetch room statuses or rates. ${error instanceof Error ? error.message : ''}`, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [tenantId, branchId, toast]);

  useEffect(() => {
    fetchRoomsAndRatesData();
  }, [fetchRoomsAndRatesData]);

  const handleOpenBookingDialog = (room: HotelRoom) => {
    if (!room.is_available) {
        toast({title: "Room Occupied", description: "This room is currently occupied.", variant: "default"});
        return;
    }
    if (!room.hotel_rate_id || room.hotel_rate_id.length === 0) {
        toast({title: "No Rates Assigned", description: "This room has no rates assigned. Please contact an administrator.", variant: "destructive"});
        return;
    }

    setSelectedRoomForBooking(room);

    const applicableRates = allBranchActiveRates.filter(branchRate => 
        room.hotel_rate_id!.includes(branchRate.id)
    );
    setApplicableRatesForBookingDialog(applicableRates);
    
    console.log("[RoomStatusContent] Opening booking dialog for room:", room.room_name, "Applicable rates:", applicableRates);

    const defaultRateId = applicableRates.length > 0 ? applicableRates[0].id : undefined;
    bookingForm.reset({...defaultTransactionFormValues, selected_rate_id: defaultRateId });
    setIsBookingDialogOpen(true);
  };

  const handleBookingSubmit = async (data: TransactionCreateData) => {
    console.log("[RoomStatusContent] Booking submit data:", data);
    console.log("[RoomStatusContent] Selected room for booking:", selectedRoomForBooking);
    console.log("[RoomStatusContent] Staff User ID:", staffUserId);

    if (!selectedRoomForBooking || !staffUserId || !tenantId || !branchId || !data.selected_rate_id) {
      let missingFields = [];
      if (!selectedRoomForBooking) missingFields.push("room details");
      if (!staffUserId) missingFields.push("staff ID");
      if (!tenantId) missingFields.push("tenant ID");
      if (!branchId) missingFields.push("branch ID");
      if (!data.selected_rate_id) missingFields.push("selected rate");

      toast({ 
        title: "Booking Error", 
        description: `Required information missing: ${missingFields.join(', ')}. Please try again.`, 
        variant: "destructive" 
      });
      console.error("Booking submission failed prerequisites:", {selectedRoomForBooking, staffUserId, tenantId, branchId, selected_rate_id: data.selected_rate_id});
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await createTransactionAndOccupyRoom(
        data, tenantId, branchId, selectedRoomForBooking.id, data.selected_rate_id, staffUserId
      );
      if (result.success) {
        toast({ title: "Success", description: result.message || "Guest checked in successfully." });
        setIsBookingDialogOpen(false);
        fetchRoomsAndRatesData(); 
      } else {
        toast({ title: "Booking Failed", description: result.message || "Could not complete booking.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "An unexpected error occurred during booking.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

 const handleOpenTransactionInfoDialog = useCallback(async (roomId: number) => {
    if (!tenantId || !branchId) {
      toast({ title: "Error", description: "Tenant or branch information missing.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const transaction = await getActiveTransactionForRoom(roomId, tenantId, branchId);
      if (transaction) {
        setTransactionDetails(transaction);
        setIsTransactionDetailsDialogOpen(true);
      } else {
        toast({ title: "No Active Transaction", description: "No active booking found for this room.", variant: "default" });
        fetchRoomsAndRatesData(); // Refresh if data seems inconsistent
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to fetch transaction details.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  }, [tenantId, branchId, toast, fetchRoomsAndRatesData]);
  
  const handleOpenCheckoutConfirmation = useCallback(async (room: HotelRoom) => {
    if (!tenantId || !branchId) {
        toast({ title: "Error", description: "Tenant or branch information missing.", variant: "destructive" });
        return;
    }
    setIsSubmitting(true);
    try {
        const transaction = await getActiveTransactionForRoom(room.id, tenantId, branchId);
        if (transaction && transaction.id) {
            setRoomForCheckoutConfirmation(room);
            setActiveTransactionIdForCheckout(transaction.id);
            setIsCheckoutConfirmOpen(true);
        } else {
            toast({ title: "No Active Transaction", description: "Cannot checkout, no active booking found for this room.", variant: "default" });
            fetchRoomsAndRatesData();
        }
    } catch (error) {
         toast({ title: "Error", description: "Failed to get transaction details for checkout.", variant: "destructive" });
    } finally {
        setIsSubmitting(false);
    }
  }, [tenantId, branchId, toast, fetchRoomsAndRatesData]);

  const handleConfirmCheckout = async () => {
    if (!activeTransactionIdForCheckout || !roomForCheckoutConfirmation || !staffUserId || !tenantId || !branchId) {
      toast({ title: "Checkout Error", description: "Required information for checkout is missing.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await checkOutGuestAndFreeRoom(
        activeTransactionIdForCheckout, staffUserId, tenantId, branchId, roomForCheckoutConfirmation.id
      );
      if (result.success) {
        toast({ title: "Success", description: result.message || "Guest checked out successfully." });
        fetchRoomsAndRatesData(); 
      } else {
        toast({ title: "Check-out Failed", description: result.message || "Could not complete check-out.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "An unexpected error occurred during check-out.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
      setIsCheckoutConfirmOpen(false);
      setRoomForCheckoutConfirmation(null);
      setActiveTransactionIdForCheckout(null);
    }
  };

  const getRateNameForRoomCard = (room: HotelRoom) => {
    if (!room.hotel_rate_id || room.hotel_rate_id.length === 0 || allBranchActiveRates.length === 0) {
        return 'Rate N/A';
    }
    // For simplicity, show the name of the first associated rate
    const firstRateId = room.hotel_rate_id[0];
    const rateDetails = allBranchActiveRates.find(rate => rate.id === firstRateId);
    return rateDetails ? rateDetails.name : 'Rate N/A';
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

  return (
    <div className="space-y-6">
      {Object.entries(groupedRooms).map(([floor, floorRooms]) => (
        <div key={floor}>
          <h2 className="text-xl font-semibold mb-3 pb-2 border-b">Floor: {floor.replace('Ground Floor / Other', 'Ground Floor / Unspecified')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {floorRooms.map(room => {
               console.log(`Rendering Room Card: Name: ${room.room_name}, Available: ${room.is_available}, Associated Rate IDs: ${room.hotel_rate_id?.join(', ')}`);
              return (
                <Card 
                  key={room.id} 
                  className={cn(
                      "shadow-md hover:shadow-lg transition-shadow duration-200 flex flex-col",
                      room.is_available && "cursor-pointer"
                  )}
                  onClick={room.is_available ? () => handleOpenBookingDialog(room) : undefined}
                >
                  <CardHeader className="p-4">
                    <CardTitle className="text-lg truncate" title={room.room_name}>{room.room_name} ({room.room_code})</CardTitle>
                    <CardDescription className="text-xs">
                      {room.is_available ? getRateNameForRoomCard(room) : (room.active_transaction_rate_name || 'Occupied')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 flex-grow flex flex-col justify-between">
                    <div className="mb-3 space-y-1">
                      {room.is_available ? (
                        <div className="flex items-center space-x-2">
                          <span className="h-3 w-3 rounded-full bg-green-500 animate-pulse"></span>
                          <span className="text-sm font-medium text-green-600">Available</span>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center space-x-2">
                            <span className="h-3 w-3 rounded-full bg-red-500"></span>
                            <span className="text-sm font-medium text-red-600">Occupied</span>
                          </div>
                          {room.active_transaction_client_name && (
                            <div className="flex items-center text-xs text-muted-foreground mt-1">
                                <User className="h-3 w-3 mr-1 flex-shrink-0 text-primary" />
                                <span className="font-medium text-foreground mr-1">Guest:</span>
                                {room.active_transaction_client_name}
                            </div>
                          )}
                          {room.active_transaction_check_in_time && (
                             <p className="text-xs text-muted-foreground">Checked-in: {new Date(room.active_transaction_check_in_time).toLocaleTimeString()}</p>
                          )}
                        </>
                      )}
                    </div>
                    
                    {!room.is_available && (
                        <div className="mt-auto pt-3 space-y-2 border-t">
                           <Button
                                variant="outline"
                                size="sm"
                                className="w-full"
                                title="View Transaction Details"
                                onClick={(e) => { e.stopPropagation(); handleOpenTransactionInfoDialog(room.id); }}
                            >
                                <Info className="mr-2 h-4 w-4" /> View Details
                            </Button>
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        className="w-full"
                                        title="Check-out Guest"
                                        onClick={(e) => e.stopPropagation()} // Stop propagation for trigger
                                    >
                                        <LogOutIcon className="mr-2 h-4 w-4" /> Check-out
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Confirm Check-out</AlertDialogTitle>
                                        <AlertDialogDescription>
                                        Are you sure you want to check out the guest from room {room.room_name} ({room.room_code})?
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel onClick={(e) => { e.stopPropagation(); setIsCheckoutConfirmOpen(false);}}>Cancel</AlertDialogCancel>
                                        <AlertDialogAction onClick={(e) => { e.stopPropagation(); handleOpenCheckoutConfirmation(room); }} disabled={isSubmitting}>
                                            {isSubmitting ? <Loader2 className="animate-spin" /> : "Confirm Check-out"}
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      ))}

      {/* Booking Dialog */}
      <Dialog open={isBookingDialogOpen} onOpenChange={(isOpen) => {
          if (!isOpen) setSelectedRoomForBooking(null);
          setIsBookingDialogOpen(isOpen);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Book Room: {selectedRoomForBooking?.room_name} ({selectedRoomForBooking?.room_code})</DialogTitle>
          </DialogHeader>
          <Form {...bookingForm}>
            <form onSubmit={bookingForm.handleSubmit(handleBookingSubmit)} className="space-y-4 py-4">
              <FormField control={bookingForm.control} name="client_name" render={({ field }) => (
                <FormItem><FormLabel>Client Name *</FormLabel><FormControl><Input placeholder="John Doe" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              
              <FormField control={bookingForm.control} name="selected_rate_id" render={({ field }) => (
                <FormItem>
                    <FormLabel>Select Rate *</FormLabel>
                    <Select
                        onValueChange={(value) => field.onChange(value ? parseInt(value) : undefined)} // Ensure number is passed
                        value={field.value?.toString()} // Ensure value is string for Select
                        disabled={applicableRatesForBookingDialog.length === 0}
                    >
                        <FormControl>
                            <SelectTrigger>
                                <SelectValue placeholder={
                                    applicableRatesForBookingDialog.length === 0 
                                    ? "No rates for this room" 
                                    : "Select a rate"
                                } />
                            </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                            {applicableRatesForBookingDialog.map(rate => (
                                <SelectItem key={rate.id} value={rate.id.toString()}>
                                    {rate.name} (₱{rate.price ? Number(rate.price).toFixed(2) : 'N/A'})
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <FormMessage />
                </FormItem>
              )} />

              <FormField control={bookingForm.control} name="client_payment_method" render={({ field }) => (
                <FormItem><FormLabel>Payment Method *</FormLabel>
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
                <FormItem><FormLabel>Notes (Optional)</FormLabel><FormControl><Textarea placeholder="Any special requests or notes..." {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <DialogFooter className="pt-4">
                <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                <Button type="submit" disabled={isSubmitting || applicableRatesForBookingDialog.length === 0}>
                    {isSubmitting ? <Loader2 className="animate-spin" /> : "Confirm Booking"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Transaction Details Dialog */}
      <Dialog open={isTransactionDetailsDialogOpen} onOpenChange={setIsTransactionDetailsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Transaction Details</DialogTitle>
            {transactionDetails?.room_name && <CardDescription>Room: {transactionDetails.room_name} ({transactionDetails.rate_name || 'N/A'})</CardDescription>}
          </DialogHeader>
          {transactionDetails ? (
            <div className="space-y-2 text-sm py-4">
              <p><strong>Client:</strong> {transactionDetails.client_name}</p>
              <p><strong>Payment Method:</strong> {transactionDetails.client_payment_method}</p>
              <p><strong>Check-in:</strong> {new Date(transactionDetails.check_in_time).toLocaleString()}</p>
              {transactionDetails.check_out_time && (<p><strong>Check-out:</strong> {new Date(transactionDetails.check_out_time).toLocaleString()}</p>)}
              {transactionDetails.hours_used !== undefined && transactionDetails.hours_used !== null && (<p><strong>Hours Used:</strong> {transactionDetails.hours_used}</p>)}
              {transactionDetails.total_amount !== undefined && transactionDetails.total_amount !== null && (<p><strong>Total Amount:</strong> ₱{Number(transactionDetails.total_amount).toFixed(2)}</p>)}
              {transactionDetails.notes && <p><strong>Notes:</strong> {transactionDetails.notes}</p>}
              <p><strong>Status:</strong> {transactionDetails.status === '0' ? 'Active' : 'Completed'}</p>
            </div>
          ) : <p className="py-4">Loading details or no active transaction...</p>}
          <DialogFooter className="pt-4">
            <DialogClose asChild><Button variant="outline">Close</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Checkout Confirmation Dialog (Separate from AlertDialogTrigger logic) */}
       <AlertDialog open={isCheckoutConfirmOpen} onOpenChange={setIsCheckoutConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Check-out</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to check out the guest from room {roomForCheckoutConfirmation?.room_name} ({roomForCheckoutConfirmation?.room_code})?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setRoomForCheckoutConfirmation(null); setActiveTransactionIdForCheckout(null); setIsCheckoutConfirmOpen(false);}}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmCheckout} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="animate-spin" /> : "Confirm Check-out"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

    