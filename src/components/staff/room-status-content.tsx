
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BedDouble, Loader2, Info, LogIn, LogOut } from "lucide-react";
import type { HotelRoom, Transaction } from '@/lib/types';
import { listRoomsForBranch } from '@/actions/admin';
import { createTransactionAndOccupyRoom, getActiveTransactionDetails, checkOutGuestAndFreeRoom } from '@/actions/staff';
import { transactionCreateSchema, TransactionCreateData } from '@/lib/schemas';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';

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
};

export default function RoomStatusContent({ tenantId, branchId, staffUserId }: RoomStatusContentProps) {
  const [rooms, setRooms] = useState<HotelRoom[]>([]);
  const [groupedRooms, setGroupedRooms] = useState<GroupedRooms>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isBookingDialogOpen, setIsBookingDialogOpen] = useState(false);
  const [selectedRoomForBooking, setSelectedRoomForBooking] = useState<HotelRoom | null>(null);
  const [isTransactionInfoDialogOpen, setIsTransactionInfoDialogOpen] = useState(false);
  const [currentTransactionDetails, setCurrentTransactionDetails] = useState<Transaction | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [roomToCheckout, setRoomToCheckout] = useState<HotelRoom | null>(null);


  const { toast } = useToast();

  const bookingForm = useForm<TransactionCreateData>({
    resolver: zodResolver(transactionCreateSchema),
    defaultValues: defaultTransactionFormValues,
  });

  console.log("[RoomStatusContent] Props received:", { tenantId, branchId, staffUserId });


  const fetchRoomsData = useCallback(async () => {
    if (!tenantId || !branchId) {
      console.log("[RoomStatusContent] TenantId or BranchId is missing, skipping fetchRoomsData.");
      setIsLoading(false);
      setRooms([]); 
      setGroupedRooms({});
      return;
    }
    console.log("[RoomStatusContent] Fetching rooms for tenantId:", tenantId, "branchId:", branchId);
    setIsLoading(true);
    try {
      const fetchedRooms = await listRoomsForBranch(branchId, tenantId);
      const activeDisplayRooms = fetchedRooms.filter(room => room.status === '1'); 
      setRooms(activeDisplayRooms);

      const grouped = activeDisplayRooms.reduce((acc, room) => {
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
      console.log("[RoomStatusContent] Rooms fetched and grouped:", sortedGroupedRooms);

    } catch (error) {
      console.error("Failed to fetch rooms:", error);
      toast({ title: "Error", description: "Could not fetch room statuses.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [tenantId, branchId, toast]);

  useEffect(() => {
    fetchRoomsData();
  }, [fetchRoomsData]);

  const handleOpenBookingDialog = (room: HotelRoom) => {
    console.log("[RoomStatusContent] Opening booking dialog for room:", room);
    setSelectedRoomForBooking(room);
    bookingForm.reset(defaultTransactionFormValues);
    setIsBookingDialogOpen(true);
  };

  const handleBookingSubmit = async (data: TransactionCreateData) => {
    console.log("[RoomStatusContent] handleBookingSubmit called. Current state:", {
      selectedRoomForBooking,
      staffUserId,
      formData: data
    });

    if (!selectedRoomForBooking || !staffUserId) {
      console.error("[RoomStatusContent] Booking check failed:", {
        selectedRoomForBookingExists: !!selectedRoomForBooking,
        selectedRoomId: selectedRoomForBooking?.id,
        staffUserId: staffUserId,
      });
      toast({ title: "Error", description: "Selected room or staff details are missing. Please ensure you are logged in correctly and have selected a room.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await createTransactionAndOccupyRoom(
        data, tenantId!, branchId!, selectedRoomForBooking.id, selectedRoomForBooking.hotel_rate_id, staffUserId
      );
      if (result.success) {
        toast({ title: "Success", description: result.message });
        setIsBookingDialogOpen(false);
        fetchRoomsData(); 
      } else {
        toast({ title: "Booking Failed", description: result.message, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "An unexpected error occurred during booking.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenTransactionInfoDialog = async (transactionId: number | null | undefined) => {
    if (!transactionId) {
      toast({ title: "Info", description: "No active transaction for this room.", variant: "default" });
      return;
    }
    setIsLoading(true); 
    try {
      const details = await getActiveTransactionDetails(transactionId, tenantId!, branchId!);
      if (details) {
        setCurrentTransactionDetails(details);
        setIsTransactionInfoDialogOpen(true);
      } else {
        toast({ title: "Not Found", description: "Could not find active transaction details.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to fetch transaction details.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCheckout = async () => {
    if (!roomToCheckout || !roomToCheckout.active_transaction_id || !staffUserId) {
      toast({ title: "Error", description: "Room or transaction details missing for checkout.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await checkOutGuestAndFreeRoom(
        roomToCheckout.active_transaction_id, staffUserId, tenantId!, branchId!, roomToCheckout.id
      );
      if (result.success) {
        toast({ title: "Success", description: result.message });
        fetchRoomsData(); 
      } else {
        toast({ title: "Check-out Failed", description: result.message, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "An unexpected error occurred during check-out.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
      setRoomToCheckout(null); 
    }
  };


  if (isLoading && Object.keys(groupedRooms).length === 0) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2 text-muted-foreground">Loading room statuses...</p></div>;
  }
  if (!branchId && !isLoading) { // Also check !isLoading to avoid showing this during initial load
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
            {floorRooms.map(room => (
              <Card 
                key={room.id} 
                className={`shadow-md hover:shadow-lg transition-shadow duration-200 ${room.is_available ? 'cursor-pointer' : ''}`}
                onClick={room.is_available ? () => handleOpenBookingDialog(room) : undefined}
              >
                <CardHeader className="p-4">
                  <CardTitle className="text-lg truncate" title={room.room_name}>{room.room_name}</CardTitle>
                  <CardDescription className="text-xs">{room.room_code}</CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="flex items-center space-x-2 mb-2">
                    <span className={`h-3 w-3 rounded-full ${room.is_available ? 'bg-green-500' : 'bg-red-500'}`}></span>
                    <span className={`text-sm font-medium ${room.is_available ? 'text-green-600' : 'text-red-600'}`}>
                      {room.is_available ? 'Available' : 'Occupied'}
                    </span>
                  </div>
                  {!room.is_available && room.active_transaction_client_name && (
                    <p className="text-xs text-muted-foreground">Guest: {room.active_transaction_client_name}</p>
                  )}
                  {!room.is_available && room.active_transaction_check_in_time && (
                    <p className="text-xs text-muted-foreground">
                      Checked-in: {new Date(room.active_transaction_check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}
                    </p>
                  )}
                  {room.room_type && <p className="text-xs text-muted-foreground mt-1">Type: {room.room_type}</p>}
                  {room.bed_type && <p className="text-xs text-muted-foreground">Bed: {room.bed_type}</p>}
                  
                  {!room.is_available && room.active_transaction_id && (
                    <div className="mt-3 flex space-x-2">
                      <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); handleOpenTransactionInfoDialog(room.active_transaction_id); }}>
                        <Info className="h-3 w-3 mr-1" /> Info
                      </Button>
                       <AlertDialog open={!!roomToCheckout && roomToCheckout.id === room.id} onOpenChange={(open) => !open && setRoomToCheckout(null)}>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="sm" onClick={(e) => { e.stopPropagation(); setRoomToCheckout(room); }}>
                            <LogOut className="h-3 w-3 mr-1" /> Check-out
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
                            <AlertDialogCancel onClick={(e) => e.stopPropagation()}>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleCheckout} disabled={isSubmitting}>
                              {isSubmitting ? <Loader2 className="animate-spin" /> : "Confirm Check-out"}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}

      <Dialog open={isBookingDialogOpen} onOpenChange={setIsBookingDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Book Room: {selectedRoomForBooking?.room_name} ({selectedRoomForBooking?.room_code})</DialogTitle>
          </DialogHeader>
          <Form {...bookingForm}>
            <form onSubmit={bookingForm.handleSubmit(handleBookingSubmit)} className="space-y-4">
              <FormField control={bookingForm.control} name="client_name" render={({ field }) => (
                <FormItem><FormLabel>Client Name *</FormLabel><FormControl><Input placeholder="John Doe" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={bookingForm.control} name="client_payment_method" render={({ field }) => (
                <FormItem><FormLabel>Payment Method *</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select payment method" /></SelectTrigger></FormControl>
                    <SelectContent><SelectItem value="Cash">Cash</SelectItem><SelectItem value="Card">Card</SelectItem><SelectItem value="Online">Online</SelectItem></SelectContent>
                  </Select><FormMessage />
                </FormItem>
              )} />
              <FormField control={bookingForm.control} name="notes" render={({ field }) => (
                <FormItem><FormLabel>Notes (Optional)</FormLabel><FormControl><Textarea placeholder="Any special requests or notes..." {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <DialogFooter>
                <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : "Confirm Booking"}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={isTransactionInfoDialogOpen} onOpenChange={setIsTransactionInfoDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Transaction Details - Room {currentTransactionDetails?.room_name}</DialogTitle></DialogHeader>
          {currentTransactionDetails ? (
            <div className="space-y-2 text-sm">
              <p><strong>Client:</strong> {currentTransactionDetails.client_name}</p>
              <p><strong>Rate:</strong> {currentTransactionDetails.rate_name}</p>
              <p><strong>Payment Method:</strong> {currentTransactionDetails.client_payment_method}</p>
              <p><strong>Check-in:</strong> {new Date(currentTransactionDetails.check_in_time).toLocaleString()}</p>
              {currentTransactionDetails.check_out_time && (<p><strong>Check-out:</strong> {new Date(currentTransactionDetails.check_out_time).toLocaleString()}</p>)}
              {currentTransactionDetails.hours_used !== undefined && (<p><strong>Hours Used:</strong> {currentTransactionDetails.hours_used}</p>)}
              {currentTransactionDetails.total_amount !== undefined && (<p><strong>Total Amount:</strong> {currentTransactionDetails.total_amount.toFixed(2)}</p>)}
              {currentTransactionDetails.notes && <p><strong>Notes:</strong> {currentTransactionDetails.notes}</p>}
              <p><strong>Status:</strong> {currentTransactionDetails.status === '0' ? 'Active' : 'Completed'}</p>
            </div>
          ) : <p>Loading details...</p>}
          <DialogFooter><DialogClose asChild><Button variant="outline">Close</Button></DialogClose></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
