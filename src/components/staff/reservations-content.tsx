
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogTrigger } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, PlusCircle, CalendarPlus, Bed, CheckCircle, Edit } from 'lucide-react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import type { Transaction, SimpleRate, HotelRoom } from '@/lib/types';
import { transactionCreateSchema, TransactionCreateData, assignRoomAndCheckInSchema, AssignRoomAndCheckInData, transactionUnassignedUpdateSchema, TransactionUnassignedUpdateData } from '@/lib/schemas';
import { getRatesForBranchSimple } from '@/actions/admin';
import {
  listUnassignedReservations,
  createUnassignedReservation,
  updateUnassignedReservation,
  listAvailableRoomsForBranch,
  assignRoomAndCheckIn
} from '@/actions/staff';
import { TRANSACTION_STATUS, TRANSACTION_STATUS_TEXT } from '@/lib/constants'; // Added TRANSACTION_STATUS and TRANSACTION_STATUS_TEXT
import { format } from 'date-fns';

interface ReservationsContentProps {
  tenantId: number;
  branchId: number;
  staffUserId: number;
}

const defaultUnassignedReservationFormValues: TransactionCreateData = {
  client_name: '',
  selected_rate_id: undefined,
  client_payment_method: undefined,
  notes: '',
  is_advance_reservation: false,
  reserved_check_in_datetime: null,
  reserved_check_out_datetime: null,
};

const defaultAssignRoomFormValues: AssignRoomAndCheckInData = {
  selected_room_id: undefined as unknown as number, // Explicitly type as number, knowing it will be set
};

export default function ReservationsContent({ tenantId, branchId, staffUserId }: ReservationsContentProps) {
  const [unassignedReservations, setUnassignedReservations] = useState<Transaction[]>([]);
  const [availableRooms, setAvailableRooms] = useState<Array<Pick<HotelRoom, 'id' | 'room_name' | 'room_code'>>>([]);
  const [allBranchRates, setAllBranchRates] = useState<SimpleRate[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isAddReservationDialogOpen, setIsAddReservationDialogOpen] = useState(false);
  const [isEditReservationDialogOpen, setIsEditReservationDialogOpen] = useState(false);
  const [selectedReservationForEdit, setSelectedReservationForEdit] = useState<Transaction | null>(null);

  const [isAssignRoomDialogOpen, setIsAssignRoomDialogOpen] = useState(false);
  const [selectedReservationForAssignment, setSelectedReservationForAssignment] = useState<Transaction | null>(null);

  const { toast } = useToast();

  const addReservationForm = useForm<TransactionCreateData>({
    resolver: zodResolver(transactionCreateSchema),
    defaultValues: defaultUnassignedReservationFormValues,
  });
  const watchIsAdvanceReservationAdd = addReservationForm.watch("is_advance_reservation");

  const editReservationForm = useForm<TransactionUnassignedUpdateData>({
    resolver: zodResolver(transactionUnassignedUpdateSchema),
    // Default values are set when the dialog opens for editing
  });
  const watchIsAdvanceReservationEdit = editReservationForm.watch("is_advance_reservation");


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
    } catch (error) {
      toast({ title: "Error", description: "Could not fetch reservations or rates.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [tenantId, branchId, toast]);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);
  
  const handleAddReservationSubmit = async (data: TransactionCreateData) => {
    if (!tenantId || !branchId || !staffUserId) {
      toast({ title: "Error", description: "Missing required information (Tenant, Branch, or Staff).", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await createUnassignedReservation(data, tenantId, branchId, staffUserId);
      if (result.success && result.transaction) {
        toast({ title: "Success", description: "Unassigned reservation created." });
        setUnassignedReservations(prev => [result.transaction!, ...prev]);
        setIsAddReservationDialogOpen(false);
        addReservationForm.reset(defaultUnassignedReservationFormValues);
      } else {
        toast({ title: "Creation Failed", description: result.message, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "An unexpected error occurred.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const handleOpenEditReservationDialog = (reservation: Transaction) => {
    setSelectedReservationForEdit(reservation);
    editReservationForm.reset({
        client_name: reservation.client_name,
        selected_rate_id: reservation.hotel_rate_id ?? undefined,
        client_payment_method: reservation.client_payment_method ?? undefined,
        notes: reservation.notes ?? '',
        is_advance_reservation: reservation.status === TRANSACTION_STATUS.ADVANCE_RESERVATION,
        reserved_check_in_datetime: reservation.reserved_check_in_datetime 
            ? format(new Date(reservation.reserved_check_in_datetime), "yyyy-MM-dd'T'HH:mm") 
            : null,
        reserved_check_out_datetime: reservation.reserved_check_out_datetime
            ? format(new Date(reservation.reserved_check_out_datetime), "yyyy-MM-dd'T'HH:mm")
            : null,
    });
    setIsEditReservationDialogOpen(true);
  };

  const handleEditReservationSubmit = async (data: TransactionUnassignedUpdateData) => {
    if (!selectedReservationForEdit || !tenantId || !branchId) {
        toast({ title: "Error", description: "Missing data for update.", variant: "destructive" });
        return;
    }
    setIsSubmitting(true);
    try {
        const result = await updateUnassignedReservation(selectedReservationForEdit.id, data, tenantId, branchId);
        if (result.success && result.updatedTransaction) {
            toast({ title: "Success", description: "Reservation updated." });
            setUnassignedReservations(prev => 
                prev.map(r => r.id === result.updatedTransaction!.id ? result.updatedTransaction! : r)
            );
            setIsEditReservationDialogOpen(false);
            setSelectedReservationForEdit(null);
        } else {
            toast({ title: "Update Failed", description: result.message, variant: "destructive" });
        }
    } catch (error) {
        toast({ title: "Error", description: "An unexpected error occurred during update.", variant: "destructive" });
    } finally {
        setIsSubmitting(false);
    }
  };


  const handleOpenAssignRoomDialog = async (reservation: Transaction) => {
    if (!tenantId || !branchId) return;
    setSelectedReservationForAssignment(reservation);
    assignRoomForm.reset(defaultAssignRoomFormValues);
    setIsLoading(true); 
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
        fetchInitialData(); 
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

  const renderReservationFormFields = (formInstance: typeof addReservationForm | typeof editReservationForm, isAdvance: boolean | undefined) => {
    const now = new Date();
    const defaultCheckIn = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 0, 0); // Today 2 PM
    const defaultCheckOut = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12, 0, 0); // Next day 12 PM

    return (
      <>
        <FormField control={formInstance.control} name="client_name" render={({ field }) => (
          <FormItem><FormLabel>Client Name *</FormLabel><FormControl><Input placeholder="Jane Doe" {...field} /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={formInstance.control} name="selected_rate_id" render={({ field }) => (
          <FormItem>
            <FormLabel>Select Rate</FormLabel>
            <Select onValueChange={(value) => field.onChange(value ? parseInt(value) : undefined)} value={field.value?.toString()} disabled={allBranchRates.length === 0}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder={allBranchRates.length === 0 ? "No rates available" : "Select a rate (Optional)"} />
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
        <FormField control={formInstance.control} name="client_payment_method" render={({ field }) => (
          <FormItem><FormLabel>Payment Method</FormLabel>
            <Select onValueChange={field.onChange} value={field.value ?? undefined}>
              <FormControl><SelectTrigger><SelectValue placeholder="Select payment method (Optional)" /></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value="Cash">Cash</SelectItem><SelectItem value="Card">Card</SelectItem>
                <SelectItem value="Online Payment">Online Payment</SelectItem><SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select><FormMessage />
          </FormItem>
        )} />
        <FormField control={formInstance.control} name="notes" render={({ field }) => (
          <FormItem><FormLabel>Notes (Optional)</FormLabel><FormControl><Textarea placeholder="Reservation notes..." {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={formInstance.control} name="is_advance_reservation" render={({ field }) => (
          <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-3 shadow-sm">
            <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
            <div className="space-y-1 leading-none"><FormLabel>Is this an Advance Future Reservation?</FormLabel></div>
          </FormItem>
        )} />
        {isAdvance && (
          <>
            <FormField control={formInstance.control} name="reserved_check_in_datetime" render={({ field }) => (
              <FormItem>
                <FormLabel>Reserved Check-in Date & Time *</FormLabel>
                <FormControl>
                  <Input 
                    type="datetime-local" 
                    {...field} 
                    value={field.value || format(defaultCheckIn, "yyyy-MM-dd'T'HH:mm")}
                    min={format(now, "yyyy-MM-dd'T'HH:mm")}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={formInstance.control} name="reserved_check_out_datetime" render={({ field }) => (
              <FormItem>
                <FormLabel>Reserved Check-out Date & Time *</FormLabel>
                <FormControl>
                  <Input 
                    type="datetime-local" 
                    {...field} 
                    value={field.value || format(defaultCheckOut, "yyyy-MM-dd'T'HH:mm")}
                    min={formInstance.getValues("reserved_check_in_datetime") || format(now, "yyyy-MM-dd'T'HH:mm")}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </>
        )}
      </>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <CalendarPlus className="h-6 w-6 text-primary" />
            <CardTitle>Manage Unassigned Reservations</CardTitle>
          </div>
          <CardDescription>Handle upcoming reservations not yet assigned to a room.</CardDescription>
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
                    addReservationForm.setValue('selected_rate_id', undefined);
                 }
                 addReservationForm.reset({
                    ...defaultUnassignedReservationFormValues,
                    selected_rate_id: allBranchRates.length > 0 ? allBranchRates[0].id : undefined
                 });
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
              <form onSubmit={addReservationForm.handleSubmit(handleAddReservationSubmit)} className="space-y-4 py-4 max-h-[70vh] overflow-y-auto pr-2">
                {renderReservationFormFields(addReservationForm, watchIsAdvanceReservationAdd)}
                <DialogFooter className="pt-4 sticky bottom-0 bg-background pb-1">
                  <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                  <Button type="submit" disabled={isSubmitting}>
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
            <TableHeader><TableRow><TableHead>Client Name</TableHead><TableHead>Rate</TableHead><TableHead>Status</TableHead><TableHead>Reserved On / For</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {unassignedReservations.map(res => (
                <TableRow key={res.id}>
                  <TableCell className="font-medium">{res.client_name}</TableCell>
                  <TableCell>{res.rate_name || 'N/A'}</TableCell>
                  <TableCell>{TRANSACTION_STATUS_TEXT[res.status as keyof typeof TRANSACTION_STATUS_TEXT] || 'Unknown'}</TableCell>
                  <TableCell>
                    {res.status === TRANSACTION_STATUS.ADVANCE_RESERVATION && res.reserved_check_in_datetime 
                      ? `For: ${format(new Date(res.reserved_check_in_datetime), 'MMM dd, yyyy HH:mm')}`
                      : `Created: ${format(new Date(res.created_at), 'MMM dd, yyyy HH:mm')}`}
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                     <Button variant="outline" size="sm" onClick={() => handleOpenEditReservationDialog(res)}>
                      <Edit className="mr-1 h-3 w-3" /> Edit
                    </Button>
                    <Button variant="default" size="sm" onClick={() => handleOpenAssignRoomDialog(res)}>
                      <Bed className="mr-1 h-3 w-3" /> Assign & Check-in
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Edit Reservation Dialog */}
      <Dialog open={isEditReservationDialogOpen} onOpenChange={(open) => {
        if (!open) {
            setSelectedReservationForEdit(null);
            // editReservationForm.reset(); // Reset with default values if needed, or specific logic
        }
        setIsEditReservationDialogOpen(open);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Unassigned Reservation</DialogTitle>
            <CardDescription>Client: {selectedReservationForEdit?.client_name}</CardDescription>
          </DialogHeader>
          <Form {...editReservationForm}>
            <form onSubmit={editReservationForm.handleSubmit(handleEditReservationSubmit)} className="space-y-4 py-4 max-h-[70vh] overflow-y-auto pr-2">
              {renderReservationFormFields(editReservationForm, watchIsAdvanceReservationEdit)}
              <DialogFooter className="pt-4 sticky bottom-0 bg-background pb-1">
                <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="animate-spin" /> : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

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
