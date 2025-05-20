
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, PlusCircle, CalendarPlus, Bed, CheckCircle } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import type { Transaction, SimpleRate, HotelRoom } from '@/lib/types';
import { transactionCreateSchema, TransactionCreateData, assignRoomAndCheckInSchema, AssignRoomAndCheckInData } from '@/lib/schemas';
import { getRatesForBranchSimple } from '@/actions/admin';
import {
  listUnassignedReservations,
  createUnassignedReservation,
  listAvailableRoomsForBranch,
  assignRoomAndCheckIn
} from '@/actions/staff';

interface ReservationsContentProps {
  tenantId: number;
  branchId: number;
  staffUserId: number;
}

const defaultUnassignedReservationFormValues: TransactionCreateData = {
  client_name: '',
  client_payment_method: 'Cash',
  notes: '',
  selected_rate_id: undefined as unknown as number,
};

const defaultAssignRoomFormValues: AssignRoomAndCheckInData = {
  selected_room_id: undefined as unknown as number,
};

export default function ReservationsContent({ tenantId, branchId, staffUserId }: ReservationsContentProps) {
  const [unassignedReservations, setUnassignedReservations] = useState<Transaction[]>([]);
  const [availableRooms, setAvailableRooms] = useState<Array<Pick<HotelRoom, 'id' | 'room_name' | 'room_code'>>>([]);
  const [allBranchRates, setAllBranchRates] = useState<SimpleRate[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isAddReservationDialogOpen, setIsAddReservationDialogOpen] = useState(false);
  const [isAssignRoomDialogOpen, setIsAssignRoomDialogOpen] = useState(false);
  const [selectedReservationForAssignment, setSelectedReservationForAssignment] = useState<Transaction | null>(null);

  const { toast } = useToast();

  const addReservationForm = useForm<TransactionCreateData>({
    resolver: zodResolver(transactionCreateSchema),
    defaultValues: defaultUnassignedReservationFormValues,
  });

  const assignRoomForm = useForm<AssignRoomAndCheckInData>({
    resolver: zodResolver(assignRoomAndCheckInSchema),
    defaultValues: defaultAssignRoomFormValues,
  });

  const fetchInitialData = useCallback(async () => {
    if (!tenantId || !branchId) return;
    setIsLoading(true);
    try {
      const [reservations, rates] = await Promise.all([
        listUnassignedReservations(tenantId, branchId),
        getRatesForBranchSimple(tenantId, branchId)
      ]);
      setUnassignedReservations(reservations);
      setAllBranchRates(rates);
      if (rates.length > 0) {
        addReservationForm.setValue('selected_rate_id', rates[0].id);
      }
    } catch (error) {
      toast({ title: "Error", description: "Could not fetch reservations or rates.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [tenantId, branchId, toast, addReservationForm]);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  const handleAddUnassignedReservationSubmit = async (data: TransactionCreateData) => {
    if (!tenantId || !branchId || !staffUserId || !data.selected_rate_id) {
      toast({ title: "Error", description: "Missing required information.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await createUnassignedReservation(data, tenantId, branchId, data.selected_rate_id, staffUserId);
      if (result.success && result.transaction) {
        toast({ title: "Success", description: "Unassigned reservation created." });
        setUnassignedReservations(prev => [result.transaction!, ...prev]);
        setIsAddReservationDialogOpen(false);
        addReservationForm.reset(defaultUnassignedReservationFormValues);
         if (allBranchRates.length > 0) {
           addReservationForm.setValue('selected_rate_id', allBranchRates[0].id);
         }
      } else {
        toast({ title: "Creation Failed", description: result.message, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "An unexpected error occurred.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenAssignRoomDialog = async (reservation: Transaction) => {
    if (!tenantId || !branchId) return;
    setSelectedReservationForAssignment(reservation);
    assignRoomForm.reset(defaultAssignRoomFormValues);
    setIsLoading(true); // For fetching available rooms
    try {
      const rooms = await listAvailableRoomsForBranch(tenantId, branchId);
      setAvailableRooms(rooms);
      if (rooms.length > 0) {
         assignRoomForm.setValue('selected_room_id', rooms[0].id);
      }
    } catch (error) {
      toast({ title: "Error", description: "Could not fetch available rooms.", variant: "destructive" });
      setAvailableRooms([]);
    } finally {
      setIsLoading(false);
      setIsAssignRoomDialogOpen(true);
    }
  };

  const handleAssignRoomAndCheckInSubmit = async (data: AssignRoomAndCheckInData) => {
    if (!selectedReservationForAssignment || !data.selected_room_id || !tenantId || !branchId || !staffUserId) {
      toast({ title: "Error", description: "Missing required information for assignment.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await assignRoomAndCheckIn(
        selectedReservationForAssignment.id,
        data.selected_room_id,
        staffUserId,
        tenantId,
        branchId
      );
      if (result.success) {
        toast({ title: "Success", description: `Reservation for ${selectedReservationForAssignment.client_name} checked in to room.` });
        fetchInitialData(); // Refresh unassigned reservations list
        // Optionally, if you have a shared state or event bus, notify RoomStatusContent to update its view
        setIsAssignRoomDialogOpen(false);
        setSelectedReservationForAssignment(null);
      } else {
        toast({ title: "Assignment Failed", description: result.message, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "An unexpected error occurred during assignment.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };


  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <CalendarPlus className="h-6 w-6 text-primary" />
            <CardTitle>Manage Reservations</CardTitle>
          </div>
          <CardDescription>Handle unassigned reservations and check-ins.</CardDescription>
        </div>
        <Dialog open={isAddReservationDialogOpen} onOpenChange={(open) => {
          if (!open) addReservationForm.reset(defaultUnassignedReservationFormValues);
          setIsAddReservationDialogOpen(open);
        }}>
          <DialogTrigger asChild>
            <Button onClick={() => {
                 if (allBranchRates.length > 0) {
                    addReservationForm.setValue('selected_rate_id', allBranchRates[0].id);
                 } else {
                    addReservationForm.setValue('selected_rate_id', undefined as unknown as number);
                 }
                setIsAddReservationDialogOpen(true);
            }}>
              <PlusCircle className="mr-2 h-4 w-4" /> Add New Reservation
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create Unassigned Reservation</DialogTitle>
            </DialogHeader>
            <Form {...addReservationForm}>
              <form onSubmit={addReservationForm.handleSubmit(handleAddUnassignedReservationSubmit)} className="space-y-4 py-4">
                <FormField control={addReservationForm.control} name="client_name" render={({ field }) => (
                  <FormItem><FormLabel>Client Name *</FormLabel><FormControl><Input placeholder="Jane Doe" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={addReservationForm.control} name="selected_rate_id" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Select Rate *</FormLabel>
                    <Select onValueChange={(value) => field.onChange(value ? parseInt(value) : undefined)} value={field.value?.toString()} disabled={allBranchRates.length === 0}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={allBranchRates.length === 0 ? "No rates available" : "Select a rate"} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {allBranchRates.map(rate => (
                          <SelectItem key={rate.id} value={rate.id.toString()}>
                            {rate.name} (₱{Number(rate.price).toFixed(2)})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={addReservationForm.control} name="client_payment_method" render={({ field }) => (
                  <FormItem><FormLabel>Payment Method *</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select payment method" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="Cash">Cash</SelectItem><SelectItem value="Card">Card</SelectItem>
                        <SelectItem value="Online Payment">Online Payment</SelectItem><SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select><FormMessage />
                  </FormItem>
                )} />
                <FormField control={addReservationForm.control} name="notes" render={({ field }) => (
                  <FormItem><FormLabel>Notes (Optional)</FormLabel><FormControl><Textarea placeholder="Reservation notes..." {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
                )} />
                <DialogFooter className="pt-4">
                  <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                  <Button type="submit" disabled={isSubmitting || allBranchRates.length === 0}>
                    {isSubmitting ? <Loader2 className="animate-spin" /> : "Create Reservation"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center items-center h-32"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2 text-muted-foreground">Loading reservations...</p></div>
        ) : unassignedReservations.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No unassigned reservations found for this branch.</p>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Client Name</TableHead><TableHead>Rate</TableHead><TableHead>Reserved On</TableHead><TableHead>Notes</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {unassignedReservations.map(res => (
                <TableRow key={res.id}>
                  <TableCell className="font-medium">{res.client_name}</TableCell>
                  <TableCell>{res.rate_name || 'N/A'}</TableCell>
                  <TableCell>{new Date(res.check_in_time).toLocaleString()}</TableCell>
                  <TableCell className="max-w-[200px] truncate" title={res.notes || ''}>{res.notes || '-'}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => handleOpenAssignRoomDialog(res)}>
                      <Bed className="mr-2 h-4 w-4" /> Assign & Check-in
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Assign Room Dialog */}
      <Dialog open={isAssignRoomDialogOpen && !!selectedReservationForAssignment} onOpenChange={(open) => {
        if (!open) {
          setSelectedReservationForAssignment(null);
          assignRoomForm.reset(defaultAssignRoomFormValues);
          setAvailableRooms([]);
        }
        setIsAssignRoomDialogOpen(open);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Room & Check-in</DialogTitle>
            {selectedReservationForAssignment && (
              <CardDescription>
                Client: {selectedReservationForAssignment.client_name} <br/>
                Rate: {selectedReservationForAssignment.rate_name || 'N/A'}
              </CardDescription>
            )}
          </DialogHeader>
          <Form {...assignRoomForm}>
            <form onSubmit={assignRoomForm.handleSubmit(handleAssignRoomAndCheckInSubmit)} className="space-y-4 py-4">
              <FormField control={assignRoomForm.control} name="selected_room_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Select Available Room *</FormLabel>
                  <Select onValueChange={(value) => field.onChange(value ? parseInt(value) : undefined)} value={field.value?.toString()} disabled={isLoading || availableRooms.length === 0}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={isLoading ? "Loading rooms..." : availableRooms.length === 0 ? "No rooms available" : "Select a room"} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {availableRooms.map(room => (
                        <SelectItem key={room.id} value={room.id.toString()}>
                          {room.room_name} ({room.room_code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter className="pt-4">
                <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                <Button type="submit" disabled={isSubmitting || availableRooms.length === 0 || isLoading}>
                  {isSubmitting ? <Loader2 className="animate-spin" /> : "Confirm Check-in"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
