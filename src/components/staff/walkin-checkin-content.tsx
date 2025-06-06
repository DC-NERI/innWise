
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Users as UsersIcon, LogIn } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { transactionCreateSchema, TransactionCreateData } from '@/lib/schemas';
import type { HotelRoom, SimpleRate } from '@/lib/types';
import { listAvailableRoomsForBranch } from '@/actions/staff/rooms/listAvailableRoomsForBranch';
import { createTransactionAndOccupyRoom } from '@/actions/staff/transactions/createTransactionAndOccupyRoom';
import { getRatesForBranchSimple } from '@/actions/admin/rates/getRatesForBranchSimple';
import { useToast } from '@/hooks/use-toast';
import { TRANSACTION_PAYMENT_STATUS } from '@/lib/constants';

interface WalkInCheckInContentProps {
  tenantId: number;
  branchId: number;
  staffUserId: number;
}

const defaultWalkInFormValues: TransactionCreateData = {
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

type AvailableRoomOption = Pick<HotelRoom, 'id' | 'room_name' | 'room_code' | 'hotel_rate_id'>;

export default function WalkInCheckInContent({ tenantId, branchId, staffUserId }: WalkInCheckInContentProps) {
  const [availableRooms, setAvailableRooms] = useState<AvailableRoomOption[]>([]);
  const [allBranchRates, setAllBranchRates] = useState<SimpleRate[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [applicableRates, setApplicableRates] = useState<SimpleRate[]>([]);
  
  const [isLoadingRooms, setIsLoadingRooms] = useState(true);
  const [isLoadingRates, setIsLoadingRates] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { toast } = useToast();

  const form = useForm<TransactionCreateData>({
    resolver: zodResolver(transactionCreateSchema),
    defaultValues: defaultWalkInFormValues,
  });

  const watchIsPaid = form.watch("is_paid");
  const watchedSelectedRoomIdFromForm = form.watch("selected_room_id_placeholder_for_walkin" as any);


  const fetchInitialData = useCallback(async () => {
    if (!tenantId || !branchId) {
      toast({ title: "Configuration Error", description: "Tenant or Branch ID not available. Cannot load Walk-in Check-in.", variant: "destructive" });
      setIsLoadingRooms(false);
      setIsLoadingRates(false);
      return;
    }
    
    let roomsDataSuccess = false;
    let ratesDataSuccess = false;

    setIsLoadingRooms(true);
    try {
      const roomsData = await listAvailableRoomsForBranch(tenantId, branchId);
      setAvailableRooms(roomsData.map(r => ({ id: r.id, room_name: r.room_name, room_code: r.room_code, hotel_rate_id: r.hotel_rate_id })));
      roomsDataSuccess = true;
    } catch (error) {
      console.error("WalkInCheckInContent: Failed to fetch available rooms", error);
      toast({ title: "Error Fetching Rooms", description: `Could not fetch available rooms. ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
    } finally {
      setIsLoadingRooms(false);
    }

    setIsLoadingRates(true);
    try {
      const ratesData = await getRatesForBranchSimple(tenantId, branchId);
      setAllBranchRates(ratesData);
      ratesDataSuccess = true;
    } catch (error) {
      console.error("WalkInCheckInContent: Failed to fetch branch rates", error);
      toast({ title: "Error Fetching Rates", description: `Could not fetch branch rates. ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
    } finally {
      setIsLoadingRates(false);
    }

    if (!roomsDataSuccess && !ratesDataSuccess) {
        // This specific toast message might not be needed if individual errors are caught above
        // toast({ title: "Error", description: "Could not fetch available rooms or rates.", variant: "destructive" });
    }

  }, [tenantId, branchId, toast]);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  useEffect(() => {
    if (selectedRoomId) {
      const room = availableRooms.find(r => r.id === selectedRoomId);
      if (room && room.hotel_rate_id && Array.isArray(room.hotel_rate_id)) {
        const filteredRates = allBranchRates.filter(rate => room.hotel_rate_id!.includes(rate.id));
        setApplicableRates(filteredRates);
        if (filteredRates.length > 0) {
            form.setValue('selected_rate_id', filteredRates[0].id, { shouldValidate: true });
        } else {
            form.setValue('selected_rate_id', undefined, { shouldValidate: true });
        }
      } else {
        setApplicableRates([]);
        form.setValue('selected_rate_id', undefined, { shouldValidate: true });
      }
    } else {
      setApplicableRates([]);
      form.setValue('selected_rate_id', undefined, { shouldValidate: true });
    }
  }, [selectedRoomId, availableRooms, allBranchRates, form]);


  const handleWalkInSubmit = async (data: TransactionCreateData) => {
    if (!selectedRoomId || !data.selected_rate_id || !staffUserId) {
      toast({ title: "Error", description: "Please select a room, a rate, and ensure staff details are available.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await createTransactionAndOccupyRoom(
        {
          ...data,
          selected_rate_id: Number(data.selected_rate_id),
          client_payment_method: typeof data.client_payment_method === "string" ? data.client_payment_method : "Cash", // Ensure it's always a string
        },
        tenantId,
        branchId,
        selectedRoomId,
        Number(data.selected_rate_id),
        staffUserId
      );
      if (result.success) {
        toast({ title: "Success", description: `${data.client_name} checked in to room ${availableRooms.find(r => r.id === selectedRoomId)?.room_name}.` });
        form.reset(defaultWalkInFormValues);
        setSelectedRoomId(null); 
        setApplicableRates([]); 
        await fetchInitialData(); // Refresh data after successful check-in
      } else {
        toast({ title: "Check-in Failed", description: result.message, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "An unexpected error occurred during check-in.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const isDataLoading = isLoadingRooms || isLoadingRates;

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <div className="flex items-center space-x-2">
          <UsersIcon className="h-6 w-6 text-primary" />
          <CardTitle>Walk-in Customer Check-in</CardTitle>
        </div>
        <CardDescription>Directly check-in a guest without a prior reservation.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleWalkInSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="selected_room_id_placeholder_for_walkin" // This is a placeholder for the form to track room selection
              render={({ field }) => ( 
                <FormItem>
                  <FormLabel>Select Available Room *</FormLabel>
                  <Select
                    onValueChange={(value) => {
                        const roomId = value ? parseInt(value) : null;
                        setSelectedRoomId(roomId);
                        field.onChange(roomId); // Update react-hook-form state if needed for validation purposes, though not directly used for data submission
                    }}
                    value={selectedRoomId?.toString()} // Bind to selectedRoomId state
                    disabled={isDataLoading || availableRooms.length === 0}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={
                          isDataLoading ? "Loading rooms..." : 
                          availableRooms.length === 0 ? "No rooms available" : "Select an available room"
                        } />
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
                  {/* No FormMessage here as this field isn't directly validated by the schema for now */}
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="selected_rate_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Select Rate *</FormLabel>
                  <Select
                    onValueChange={(value) => field.onChange(value ? parseInt(value) : undefined)}
                    value={field.value?.toString()}
                    disabled={!selectedRoomId || applicableRates.length === 0 || isDataLoading}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={
                          !selectedRoomId ? "Select a room first" :
                          applicableRates.length === 0 ? "No rates for selected room" : "Select a rate"
                        } />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {applicableRates.map(rate => (
                        <SelectItem key={rate.id} value={rate.id.toString()}>
                          {rate.name} (₱{rate.price.toFixed(2)} for {rate.hours}hr/s)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="client_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Client Name *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="John Doe"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="client_payment_method"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment Method *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? undefined} defaultValue="Cash">
                    <FormControl><SelectTrigger><SelectValue placeholder="Select payment method" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="Cash">Cash</SelectItem>
                      <SelectItem value="Card">Card</SelectItem>
                      <SelectItem value="Online Payment">Online Payment</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="is_paid"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-3 shadow-sm">
                  <FormControl>
                    <Checkbox
                      checked={field.value === TRANSACTION_PAYMENT_STATUS.PAID}
                      onCheckedChange={(checked) => {
                        field.onChange(checked ? TRANSACTION_PAYMENT_STATUS.PAID : TRANSACTION_PAYMENT_STATUS.UNPAID);
                        if (!checked) {
                          form.setValue('tender_amount_at_checkin', null, { shouldValidate: true });
                        }
                      }}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Paid upon Check-in?</FormLabel>
                  </div>
                </FormItem>
              )}
            />

            {watchIsPaid === TRANSACTION_PAYMENT_STATUS.PAID && (
              <FormField
                control={form.control}
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
                        />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (Optional)</FormLabel>
                  <FormControl><Textarea placeholder="Any special requests or notes..." {...field} value={field.value ?? ''} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button 
              type="submit" 
              className="w-full" 
              disabled={isSubmitting || !selectedRoomId || !form.getValues('selected_rate_id') || !form.getValues('client_name') || isDataLoading}
            >
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
              Check-in Guest
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
