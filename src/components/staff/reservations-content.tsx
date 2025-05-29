"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogTrigger,
  DialogDescription as ShadDialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription as ShadAlertDialogDescriptionAliased,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle as ShadAlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, PlusCircle, CalendarPlus, Bed, Edit, Ban } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  transactionCreateSchema,
  TransactionCreateData,
  assignRoomAndCheckInSchema,
  AssignRoomAndCheckInData,
  transactionUnassignedUpdateSchema,
  TransactionUnassignedUpdateData
} from '@/lib/schemas';

import { listUnassignedReservations } from '@/actions/staff/reservations/listUnassignedReservations';
import { createUnassignedReservation } from '@/actions/staff/reservations/createUnassignedReservation';
import { updateUnassignedReservation } from '@/actions/staff/reservations/updateUnassignedReservation';
import { listAvailableRoomsForBranch } from '@/actions/staff/rooms/listAvailableRoomsForBranch';
import { assignRoomAndCheckIn } from '@/actions/staff/reservations/assignRoomAndCheckIn';
import { cancelReservation } from '@/actions/staff/reservations/cancelReservation';
import { getRatesForBranchSimple } from '@/actions/admin/rates/getRatesForBranchSimple';


import { TRANSACTION_LIFECYCLE_STATUS, TRANSACTION_LIFECYCLE_STATUS_TEXT, TRANSACTION_PAYMENT_STATUS, TRANSACTION_IS_ACCEPTED_STATUS } from '@/lib/constants';
import { format, addDays, setHours, setMinutes, setSeconds, setMilliseconds, parseISO, isValid } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import type { Transaction, SimpleRate, HotelRoom } from '@/lib/types';

interface ReservationsContentProps {
  tenantId: number | null;
  branchId: number | null;
  staffUserId: number | null;
  refreshReservationCount?: () => void;
}

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
    } catch (e) {
      // If parsing fails, baseDate remains new Date()
    }
  } else {
    baseDate = setMilliseconds(setSeconds(setMinutes(setHours(baseDate, 14), 0), 0), 0);
  }
  const checkOut = setMilliseconds(setSeconds(setMinutes(setHours(addDays(baseDate, 1), 12),0),0),0);
  return format(checkOut, "yyyy-MM-dd'T'HH:mm");
};


const defaultUnassignedReservationFormValues: TransactionCreateData = {
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

const defaultAssignRoomFormValues: AssignRoomAndCheckInData = {
  selected_room_id: undefined as unknown as number,
};

export default function ReservationsContent({ tenantId, branchId, staffUserId, refreshReservationCount }: ReservationsContentProps) {
  const [unassignedReservations, setUnassignedReservations] = useState<Transaction[]>([]);
  const [availableRooms, setAvailableRooms] = useState<Array<Pick<HotelRoom, 'id' | 'room_name' | 'room_code' | 'hotel_rate_id'>>>([]);
  const [allBranchRates, setAllBranchRates] = useState<SimpleRate[]>([]);

  const [isLoading, setIsLoading] = useState(true); // For main list loading
  const [isLoadingAvailableRoomsForModal, setIsLoadingAvailableRoomsForModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isAddReservationDialogOpen, setIsAddReservationDialogOpen] = useState(false);
  const [isEditReservationDialogOpen, setIsEditReservationDialogOpen] = useState(false);
  const [selectedReservationForEdit, setSelectedReservationForEdit] = useState<Transaction | null>(null);

  const [isCancelReservationConfirmOpen, setIsCancelReservationConfirmOpen] = useState(false);
  const [transactionToCancel, setTransactionToCancel] = useState<Transaction | null>(null);

  const [isAssignRoomDialogOpen, setIsAssignRoomDialogOpen] = useState(false);
  const [selectedReservationForAssignment, setSelectedReservationForAssignment] = useState<Transaction | null>(null);

  const { toast } = useToast();

  const addReservationForm = useForm<TransactionCreateData>({
    resolver: zodResolver(transactionCreateSchema),
    defaultValues: defaultUnassignedReservationFormValues,
  });
  const watchIsAdvanceReservationAdd = useWatch({ control: addReservationForm.control, name: 'is_advance_reservation' });
  const watchIsPaidAdd = useWatch({ control: addReservationForm.control, name: 'is_paid' });


  const editReservationForm = useForm<TransactionUnassignedUpdateData>({
    resolver: zodResolver(transactionUnassignedUpdateSchema),
  });
  const watchIsAdvanceReservationEdit = useWatch({ control: editReservationForm.control, name: 'is_advance_reservation'});
  const watchIsPaidEdit = useWatch({ control: editReservationForm.control, name: 'is_paid'});


  const assignRoomForm = useForm<AssignRoomAndCheckInData>({
    resolver: zodResolver(assignRoomAndCheckInSchema),
    defaultValues: defaultAssignRoomFormValues,
  });

  useEffect(() => {
    if (isAddReservationDialogOpen) {
      if (watchIsAdvanceReservationAdd) {
        if (!addReservationForm.getValues('reserved_check_in_datetime')) {
          addReservationForm.setValue('reserved_check_in_datetime', getDefaultCheckInDateTimeString(), { shouldValidate: true, shouldDirty: true });
        }
        const currentCheckIn = addReservationForm.getValues('reserved_check_in_datetime');
        if (!addReservationForm.getValues('reserved_check_out_datetime')) {
          addReservationForm.setValue('reserved_check_out_datetime', getDefaultCheckOutDateTimeString(currentCheckIn), { shouldValidate: true, shouldDirty: true });
        }
      } else {
        addReservationForm.setValue('reserved_check_in_datetime', null, { shouldValidate: true });
        addReservationForm.setValue('reserved_check_out_datetime', null, { shouldValidate: true });
      }
    }
  }, [watchIsAdvanceReservationAdd, addReservationForm, isAddReservationDialogOpen]);

  useEffect(() => {
    if (isEditReservationDialogOpen && selectedReservationForEdit) {
        const currentIsAdvance = editReservationForm.getValues('is_advance_reservation');
        if (currentIsAdvance) {
            if (!editReservationForm.getValues('reserved_check_in_datetime')) {
                 editReservationForm.setValue('reserved_check_in_datetime', selectedReservationForEdit.reserved_check_in_datetime && isValid(parseISO(selectedReservationForEdit.reserved_check_in_datetime.replace(' ', 'T'))) ? format(parseISO(selectedReservationForEdit.reserved_check_in_datetime.replace(' ', 'T')), "yyyy-MM-dd'T'HH:mm") : getDefaultCheckInDateTimeString(), { shouldValidate: true, shouldDirty: true });
            }
             const currentCheckInEdit = editReservationForm.getValues('reserved_check_in_datetime');
            if (!editReservationForm.getValues('reserved_check_out_datetime')) {
                editReservationForm.setValue('reserved_check_out_datetime', selectedReservationForEdit.reserved_check_out_datetime && isValid(parseISO(selectedReservationForEdit.reserved_check_out_datetime.replace(' ', 'T'))) ? format(parseISO(selectedReservationForEdit.reserved_check_out_datetime.replace(' ', 'T')), "yyyy-MM-dd'T'HH:mm") : getDefaultCheckOutDateTimeString(currentCheckInEdit), { shouldValidate: true, shouldDirty: true });
            }
        } else {
            editReservationForm.setValue('reserved_check_in_datetime', null, { shouldValidate: true });
            editReservationForm.setValue('reserved_check_out_datetime', null, { shouldValidate: true });
        }
    }
  }, [watchIsAdvanceReservationEdit, editReservationForm, isEditReservationDialogOpen, selectedReservationForEdit]);


  const fetchInitialData = useCallback(async () => {
    if (!tenantId || !branchId) {
        setIsLoading(false);
        setUnassignedReservations([]);
        setAllBranchRates([]);
        return;
    }
    setIsLoading(true);
    try {
      const [reservations, rates] = await Promise.all([
        listUnassignedReservations(tenantId, branchId),
        getRatesForBranchSimple(tenantId, branchId)
      ]);
      setUnassignedReservations(reservations);
      setAllBranchRates(rates);
    } catch (error) {
      toast({ title: "Error", description: `Could not fetch initial data. ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [tenantId, branchId, toast]);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  const handleAddReservationSubmit = async (data: TransactionCreateData) => {
    if (!tenantId || !branchId || !staffUserId || staffUserId <= 0) {
      toast({ title: "Error", description: "Missing required information (Tenant, Branch, or Staff ID).", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await createUnassignedReservation(
        data,
        tenantId,
        branchId,
        staffUserId
      );
      if (result.success && result.transaction) {
        toast({ title: "Success", description: "Unassigned reservation created." });
        setUnassignedReservations(prev => [result.transaction!, ...prev].sort((a, b) => {
            const dateAVal = a.reserved_check_in_datetime || a.created_at;
            const dateBVal = b.reserved_check_in_datetime || b.created_at;
            const dateA = dateAVal && isValid(parseISO(dateAVal.replace(' ', 'T'))) ? parseISO(dateAVal.replace(' ', 'T')) : new Date(0);
            const dateB = dateBVal && isValid(parseISO(dateBVal.replace(' ', 'T'))) ? parseISO(dateBVal.replace(' ', 'T')) : new Date(0);
            return dateA.getTime() - dateB.getTime();
        }));
        setIsAddReservationDialogOpen(false);
        addReservationForm.reset(defaultUnassignedReservationFormValues);
        refreshReservationCount?.();
      } else {
        toast({ title: "Creation Failed", description: result.message || "Could not create reservation.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: `An unexpected error occurred: ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenEditReservationDialog = (reservation: Transaction) => {
    setSelectedReservationForEdit(reservation);
    const isAdvance = !!reservation.reserved_check_in_datetime;

    let checkInDateTimeFormatted = null;
    if (reservation.reserved_check_in_datetime && isValid(parseISO(reservation.reserved_check_in_datetime.replace(' ', 'T')))) {
        checkInDateTimeFormatted = format(parseISO(reservation.reserved_check_in_datetime.replace(' ', 'T')), "yyyy-MM-dd'T'HH:mm");
    }

    let checkOutDateTimeFormatted = null;
    if (reservation.reserved_check_out_datetime && isValid(parseISO(reservation.reserved_check_out_datetime.replace(' ', 'T')))) {
        checkOutDateTimeFormatted = format(parseISO(reservation.reserved_check_out_datetime.replace(' ', 'T')), "yyyy-MM-dd'T'HH:mm");
    }

    editReservationForm.reset({
        client_name: reservation.client_name,
        selected_rate_id: reservation.hotel_rate_id ?? undefined,
        client_payment_method: reservation.client_payment_method ?? undefined,
        notes: reservation.notes ?? '',
        is_advance_reservation: isAdvance,
        reserved_check_in_datetime: checkInDateTimeFormatted,
        reserved_check_out_datetime: checkOutDateTimeFormatted,
        is_paid: (reservation.is_paid as 0 | 1 | 2 | null | undefined) ?? TRANSACTION_PAYMENT_STATUS.UNPAID,
        tender_amount_at_checkin: reservation.tender_amount ?? null,
    });
    setIsEditReservationDialogOpen(true);
  };

  const handleEditReservationSubmit = async (data: TransactionUnassignedUpdateData) => {
    if (!selectedReservationForEdit || !tenantId || !branchId || !staffUserId || staffUserId <= 0) {
        toast({ title: "Action Failed", description: "Required information (User, Tenant, Branch, or Reservation) is missing for update.", variant: "destructive" });
        setIsSubmitting(false);
        return;
    }
    setIsSubmitting(true);
    try {
        const result = await updateUnassignedReservation(selectedReservationForEdit.id, data, tenantId, branchId, staffUserId);
        if (result.success && result.updatedTransaction) {
            toast({ title: "Success", description: "Reservation updated." });
            setUnassignedReservations(prev =>
                prev.map(r => r.id === result.updatedTransaction!.id ? result.updatedTransaction! : r).sort((a, b) => {
                   const dateAVal = a.reserved_check_in_datetime || a.created_at;
                   const dateBVal = b.reserved_check_in_datetime || b.created_at;
                   const dateA = dateAVal && isValid(parseISO(dateAVal.replace(' ', 'T'))) ? parseISO(dateAVal.replace(' ', 'T')) : new Date(0);
                   const dateB = dateBVal && isValid(parseISO(dateBVal.replace(' ', 'T'))) ? parseISO(dateBVal.replace(' ', 'T')) : new Date(0);
                   return dateA.getTime() - dateB.getTime();
                })
            );
            setIsEditReservationDialogOpen(false);
            setSelectedReservationForEdit(null);
            refreshReservationCount?.();
        } else {
            toast({ title: "Update Failed", description: result.message || "Could not update reservation.", variant: "destructive" });
        }
    } catch (error) {
        toast({ title: "Error", description: `An unexpected error occurred during update: ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
    } finally {
        setIsSubmitting(false);
    }
  };

  const handleOpenCancelUnassignedReservationDialog = (transaction: Transaction) => {
    setTransactionToCancel(transaction);
    setIsCancelReservationConfirmOpen(true);
  };

  const handleConfirmCancelUnassignedReservation = async () => {
    if (!transactionToCancel || !tenantId || !branchId || !staffUserId || staffUserId <= 0) {
      toast({ title: "Cancellation Error", description: "Required information missing or invalid user ID.", variant: "destructive" });
      setIsCancelReservationConfirmOpen(false);
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await cancelReservation(transactionToCancel.id, tenantId, branchId, null, staffUserId); // roomId is null for unassigned
      if (result.success) {
        toast({ title: "Success", description: "Reservation cancelled." });
        setUnassignedReservations(prev => prev.filter(res => res.id !== transactionToCancel.id));
        setIsCancelReservationConfirmOpen(false);
        setTransactionToCancel(null);
        refreshReservationCount?.();
      } else {
        toast({ title: "Cancellation Failed", description: result.message || "Could not cancel reservation.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: `An unexpected error occurred during cancellation: ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenAssignRoomDialog = async (reservation: Transaction) => {
    if (!tenantId || !branchId || !staffUserId || staffUserId <= 0) {
        toast({title: "Error", description: "User, tenant, or branch info missing.", variant: "destructive"});
        return;
    }
    if (!reservation.hotel_rate_id) {
        toast({title: "Action Required", description: "This reservation has no rate selected. Please edit the reservation to select a rate before assigning a room.", variant: "default"});
        return;
    }
    setSelectedReservationForAssignment(reservation);
    assignRoomForm.reset(defaultAssignRoomFormValues);
    setIsLoadingAvailableRoomsForModal(true);
    try {
      const roomsData = await listAvailableRoomsForBranch(tenantId, branchId);
      const compatibleRooms = roomsData.filter(room => 
        room.hotel_rate_id && room.hotel_rate_id.includes(reservation.hotel_rate_id!)
      );
      setAvailableRooms(compatibleRooms.map(r => ({ id: r.id, room_name: r.room_name, room_code: r.room_code, hotel_rate_id: r.hotel_rate_id })));
      
      if (compatibleRooms.length === 0) {
        toast({ title: "No Compatible Rooms", description: "There are no currently available and clean rooms that offer the rate selected for this reservation.", variant: "default"});
      }
    } catch (error) {
      toast({ title: "Error", description: `Could not fetch available rooms: ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
      setAvailableRooms([]);
    } finally {
      setIsLoadingAvailableRoomsForModal(false);
      setIsAssignRoomDialogOpen(true);
    }
  };

  const handleAssignRoomAndCheckInSubmit = async (data: AssignRoomAndCheckInData) => {
    if (!selectedReservationForAssignment || !data.selected_room_id || !tenantId || !branchId || !staffUserId || staffUserId <= 0) {
      toast({ title: "Error", description: "Missing required information for assignment or invalid user ID.", variant: "destructive" });
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
        setUnassignedReservations(prev => prev.filter(res => res.id !== selectedReservationForAssignment.id));
        setIsAssignRoomDialogOpen(false);
        setSelectedReservationForAssignment(null);
        refreshReservationCount?.();
        // TODO: Potentially trigger a refresh of RoomStatusContent as well if it's visible
      } else {
        toast({ title: "Assignment Failed", description: result.message || "Could not assign room.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: `An unexpected error occurred during assignment: ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderReservationFormFields = (
    formInstance: typeof addReservationForm | typeof editReservationForm,
    isAdvance: boolean | undefined,
    isPaid: typeof TRANSACTION_PAYMENT_STATUS[keyof typeof TRANSACTION_PAYMENT_STATUS] | undefined | null,
    isRateOptional: boolean = false
  ) => {
    const formValues = formInstance.getValues();
    return (
      <div className="p-1 space-y-3">
        <FormField control={formInstance.control} name="client_name" render={({ field }) => (
          <FormItem>
            <FormLabel>Client Name *</FormLabel>
            <FormControl>
              <Input
                placeholder="Jane Doe"
                {...field}
                value={field.value ?? ""}
                className="w-[90%]"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={formInstance.control} name="selected_rate_id" render={({ field }) => (
          <FormItem>
            <FormLabel>Select Rate {isRateOptional ? '(Optional)' : '*'}</FormLabel>
            <Select onValueChange={(value) => field.onChange(value ? parseInt(value) : undefined)} value={field.value?.toString() ?? ""} disabled={allBranchRates.length === 0}>
              <FormControl>
                <SelectTrigger className="w-[90%]">
                  <SelectValue placeholder={allBranchRates.length === 0 ? "No rates available for branch" : `Select a rate ${isRateOptional ? '(Optional)' : '*'}`} />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {allBranchRates.map(rate => (
                  <SelectItem key={rate.id} value={rate.id.toString()}>
                    {rate.name} (₱{Number(rate.price).toFixed(2)} for {rate.hours}hr/s)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={formInstance.control} name="client_payment_method" render={({ field }) => (
          <FormItem><FormLabel>Payment Method {isRateOptional ? '(Optional)' : '*'}</FormLabel>
            <Select onValueChange={field.onChange} value={field.value ?? undefined} defaultValue={isRateOptional ? undefined : "Cash"}>
              <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder={`Select payment method ${isRateOptional ? '(Optional)' : ''}`} /></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value="Cash">Cash</SelectItem><SelectItem value="Card">Card</SelectItem>
                <SelectItem value="Online Payment">Online Payment</SelectItem><SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select><FormMessage />
          </FormItem>
        )} />
         <FormField
          control={formInstance.control}
          name="is_paid"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-3 shadow-sm w-[90%]">
              <FormControl>
                <Checkbox
                  checked={field.value === TRANSACTION_PAYMENT_STATUS.PAID || field.value === TRANSACTION_PAYMENT_STATUS.ADVANCE_PAID}
                  onCheckedChange={(checked) => {
                    const currentIsAdvance = formInstance.getValues().is_advance_reservation;
                    if (checked) {
                        field.onChange(currentIsAdvance ? TRANSACTION_PAYMENT_STATUS.ADVANCE_PAID : TRANSACTION_PAYMENT_STATUS.PAID);
                    } else {
                        field.onChange(TRANSACTION_PAYMENT_STATUS.UNPAID);
                        formInstance.setValue('tender_amount_at_checkin', null, { shouldValidate: true });
                    }
                  }}
                />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel>Paid in Advance?</FormLabel>
              </div>
            </FormItem>
          )}
        />
        {(isPaid === TRANSACTION_PAYMENT_STATUS.PAID || isPaid === TRANSACTION_PAYMENT_STATUS.ADVANCE_PAID) && (
          <FormField
            control={formInstance.control}
            name="tender_amount_at_checkin"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tender Amount *</FormLabel>
                <FormControl>
                   <Input
                    type="text"
                    placeholder="0.00"
                    {...field}
                    value={field.value === null || field.value === undefined ? "" : String(field.value)}
                    onChange={(e) => {
                        const val = e.target.value;
                        if (val === "" || /^[0-9]*\.?[0-9]{0,2}$/.test(val)) {
                          field.onChange(val === "" ? null : parseFloat(val));
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
        <FormField control={formInstance.control} name="notes" render={({ field }) => (
          <FormItem><FormLabel>Notes (Optional)</FormLabel><FormControl><Textarea placeholder="Reservation notes..." {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={formInstance.control} name="is_advance_reservation" render={({ field }) => (
          <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-3 shadow-sm w-[90%]">
            <FormControl>
                <Checkbox
                    checked={!!field.value}
                    onCheckedChange={(checked) => {
                        field.onChange(!!checked);
                        const currentIsPaid = formInstance.getValues().is_paid;
                        if (Number(currentIsPaid) !== TRANSACTION_PAYMENT_STATUS.UNPAID) {
                            formInstance.setValue("is_paid", !!checked ? TRANSACTION_PAYMENT_STATUS.ADVANCE_PAID : TRANSACTION_PAYMENT_STATUS.PAID, { shouldValidate: true });
                        }
                    }}
                />
            </FormControl>
            <div className="space-y-1 leading-none"><FormLabel>Advance Future Reservation?</FormLabel></div>
          </FormItem>
        )} />
        {isAdvance && (
          <>
            <FormField control={formInstance.control} name="reserved_check_in_datetime" render={({ field }) => (
              <FormItem>
                <FormLabel>Reserved Check-in Date &amp; Time *</FormLabel>
                <FormControl>
                  <Input
                    type="datetime-local"
                    className="w-[90%]"
                    {...field}
                    value={field.value || ""}
                    min={format(new Date(), "yyyy-MM-dd'T'HH:mm")}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={formInstance.control} name="reserved_check_out_datetime" render={({ field }) => (
              <FormItem>
                <FormLabel>Reserved Check-out Date &amp; Time *</FormLabel>
                <FormControl>
                  <Input
                    type="datetime-local"
                    className="w-[90%]"
                    {...field}
                    value={field.value || ""}
                    min={((formInstance.getValues() as TransactionCreateData).reserved_check_in_datetime) || format(new Date(), "yyyy-MM-dd'T'HH:mm")}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </>
        )}
      </div>
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
          if (!open) {
            addReservationForm.reset(defaultUnassignedReservationFormValues);
          }
          setIsAddReservationDialogOpen(open);
        }}>
          <DialogTrigger asChild>
            <Button onClick={() => {
                 addReservationForm.reset({ ...defaultUnassignedReservationFormValues, selected_rate_id: undefined, client_payment_method: undefined });
                 setIsAddReservationDialogOpen(true);
            }}>
              <PlusCircle className="mr-2 h-4 w-4" /> Add New Reservation
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md p-1 flex flex-col max-h-[85vh]">
            <DialogHeader className="p-2 border-b">
              <DialogTitle>Create Unassigned Reservation</DialogTitle>
            </DialogHeader>
            <Form {...addReservationForm}>
              <form onSubmit={addReservationForm.handleSubmit(handleAddReservationSubmit)} className="flex flex-col flex-grow overflow-hidden bg-card rounded-md">
                 <div className="flex-grow overflow-y-auto p-1">
                    {renderReservationFormFields(addReservationForm, watchIsAdvanceReservationAdd, watchIsPaidAdd, true)}
                </div>
                <DialogFooter className="bg-card py-2 border-t px-3 sticky bottom-0 z-10">
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
          <div className="max-h-[60vh] overflow-y-auto">
            <Table>
                <TableHeader><TableRow><TableHead>Client Name</TableHead><TableHead>Rate</TableHead><TableHead>Status</TableHead><TableHead>Reserved On / For</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                {unassignedReservations.map(res => (
                    <TableRow key={res.id}>
                    <TableCell className="font-medium">{res.client_name}</TableCell>
                    <TableCell>{res.rate_name || 'N/A'}</TableCell>
                    <TableCell>{TRANSACTION_LIFECYCLE_STATUS_TEXT[res.status as keyof typeof TRANSACTION_LIFECYCLE_STATUS_TEXT] || 'Unknown'}</TableCell>
                    <TableCell>
                        {res.reserved_check_in_datetime && isValid(parseISO(res.reserved_check_in_datetime.replace(' ','T')))
                        ? `For: ${format(parseISO(res.reserved_check_in_datetime.replace(' ','T')), 'yyyy-MM-dd hh:mm aa')}`
                        : (res.created_at && isValid(parseISO(res.created_at.replace(' ','T'))) ? `Created: ${format(parseISO(res.created_at.replace(' ','T')), 'yyyy-MM-dd hh:mm aa')}`: 'N/A')}
                    </TableCell>
                    <TableCell className="text-right">
                        <div className="flex justify-end items-center space-x-2">
                            <Button variant="outline" size="sm" onClick={() => handleOpenEditReservationDialog(res)}>
                                <Edit className="mr-1 h-3 w-3" /> Edit
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => handleOpenCancelUnassignedReservationDialog(res)}>
                                <Ban className="mr-1 h-3 w-3" /> Cancel
                            </Button>
                            <Button 
                                variant="default" 
                                size="sm" 
                                onClick={() => handleOpenAssignRoomDialog(res)}
                                disabled={!res.hotel_rate_id}
                                title={!res.hotel_rate_id ? "Select a rate in 'Edit' before assigning room." : "Assign Room & Check-in"}
                            >
                                <Bed className="mr-1 h-3 w-3" /> Assign & Check-in
                            </Button>
                        </div>
                    </TableCell>
                    </TableRow>
                ))}
                </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={isEditReservationDialogOpen} onOpenChange={(open) => {
        if (!open) {
            setSelectedReservationForEdit(null);
            editReservationForm.reset();
        }
        setIsEditReservationDialogOpen(open);
      }}>
        <DialogContent className="sm:max-w-md p-1 flex flex-col max-h-[85vh]">
          <DialogHeader className="p-2 border-b">
            <DialogTitle>Edit Unassigned Reservation</DialogTitle>
            <ShadDialogDescription>Client: {selectedReservationForEdit?.client_name}</ShadDialogDescription>
          </DialogHeader>
          <Form {...editReservationForm}>
            <form onSubmit={editReservationForm.handleSubmit(handleEditReservationSubmit)} className="flex flex-col flex-grow overflow-hidden bg-card rounded-md">
               <div className="flex-grow overflow-y-auto p-1">
                 {renderReservationFormFields(editReservationForm, watchIsAdvanceReservationEdit, watchIsPaidEdit)}
              </div>
              <DialogFooter className="bg-card py-2 border-t px-3 sticky bottom-0 z-10">
                <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="animate-spin" /> : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={isAssignRoomDialogOpen && !!selectedReservationForAssignment} onOpenChange={(open) => {
        if (!open) {
          setSelectedReservationForAssignment(null);
          assignRoomForm.reset(defaultAssignRoomFormValues);
          setAvailableRooms([]);
        }
        setIsAssignRoomDialogOpen(open);
      }}>
        <DialogContent className="sm:max-w-md p-3">
          <DialogHeader className="border-b pb-2 mb-2">
            <DialogTitle>Assign Room &amp; Check-in</DialogTitle>
            {selectedReservationForAssignment && (
              <ShadDialogDescription className="text-sm">
                Client: {selectedReservationForAssignment.client_name} <br/>
                Rate: {selectedReservationForAssignment.rate_name || 'N/A'}
              </ShadDialogDescription>
            )}
          </DialogHeader>
          <Form {...assignRoomForm}>
            <form onSubmit={assignRoomForm.handleSubmit(handleAssignRoomAndCheckInSubmit)} className="space-y-4 py-2">
              <FormField control={assignRoomForm.control} name="selected_room_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Select Available Room *</FormLabel>
                  <Select onValueChange={(value) => field.onChange(value ? parseInt(value) : undefined)} value={field.value?.toString() ?? ""} disabled={isLoadingAvailableRoomsForModal || availableRooms.length === 0}>
                    <FormControl>
                      <SelectTrigger className="w-[90%]">
                        <SelectValue placeholder={isLoadingAvailableRoomsForModal ? "Loading rooms..." : availableRooms.length === 0 ? "No compatible rooms available" : "Select a room"} />
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
                <Button type="submit" disabled={isSubmitting || availableRooms.length === 0 || isLoadingAvailableRoomsForModal}>
                  {isSubmitting ? <Loader2 className="animate-spin" /> : "Confirm Check-in"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

       <AlertDialog open={isCancelReservationConfirmOpen} onOpenChange={(open) => {
          if(!open) {
            setTransactionToCancel(null);
          }
          setIsCancelReservationConfirmOpen(open);
        }}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <ShadAlertDialogTitle>Confirm Cancellation</ShadAlertDialogTitle>
            <ShadAlertDialogDescriptionAliased>
              Are you sure you want to cancel this reservation for "{transactionToCancel?.client_name}"? This action cannot be undone.
            </ShadAlertDialogDescriptionAliased>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={(e) => { e.stopPropagation(); setIsCancelReservationConfirmOpen(false); setTransactionToCancel(null); }}>No</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.stopPropagation(); handleConfirmCancelUnassignedReservation(); }} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="animate-spin" /> : "Yes, Cancel Reservation"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
