
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Users as UsersIcon, LogIn } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { transactionCreateSchema, TransactionCreateData } from '@/lib/schemas';
import type { HotelRoom, SimpleRate } from '@/lib/types';
import { listAvailableRoomsForBranch, createTransactionAndOccupyRoom } from '@/actions/staff';
import { getRatesForBranchSimple } from '@/actions/admin';
import { useToast } from '@/hooks/use-toast';

interface WalkInCheckInContentProps {
  tenantId: number;
  branchId: number;
  staffUserId: number;
}

const defaultFormValues: TransactionCreateData = {
  client_name: '',
  selected_rate_id: undefined,
  client_payment_method: 'Cash',
  notes: '',
  is_advance_reservation: false, // Not typically used for direct walk-in, but schema requires it
  reserved_check_in_datetime: null, // Not used for direct walk-in
  reserved_check_out_datetime: null, // Not used for direct walk-in
};

// Type for rooms listed in the dropdown
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
    defaultValues: defaultFormValues, // Use the defined constant
  });

  // Watch the selected_room_id_placeholder_for_walkin field, but manage actual room selection via selectedRoomId state
  const watchedRoomIdForForm = useWatch({ control: form.control, name: "selected_room_id_placeholder_for_walkin" }); 

  const fetchInitialData = useCallback(async () => {
    if (!tenantId || !branchId) return;
    setIsLoadingRooms(true);
    setIsLoadingRates(true);
    try {
      const [roomsData, ratesData] = await Promise.all([
        listAvailableRoomsForBranch(tenantId, branchId),
        getRatesForBranchSimple(tenantId, branchId)
      ]);
      setAvailableRooms(roomsData.map(r => ({ id: r.id, room_name: r.room_name, room_code: r.room_code, hotel_rate_id: r.hotel_rate_id })));
      setAllBranchRates(ratesData);
    } catch (error) {
      console.error("Error fetching data for walk-in:", error);
      toast({ title: "Error", description: "Could not fetch available rooms or rates.", variant: "destructive" });
    } finally {
      setIsLoadingRooms(false);
      setIsLoadingRates(false);
    }
  }, [tenantId, branchId, toast]);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  useEffect(() => {
    if (selectedRoomId) {
      const room = availableRooms.find(r => r.id === selectedRoomId);
      if (room && room.hotel_rate_id) {
        const filteredRates = allBranchRates.filter(rate => room.hotel_rate_id!.includes(rate.id));
        setApplicableRates(filteredRates);
        // Automatically select the first applicable rate if available
        if (filteredRates.length > 0) {
            form.setValue('selected_rate_id', filteredRates[0].id);
        } else {
            form.setValue('selected_rate_id', undefined);
        }
      } else {
        setApplicableRates([]);
        form.setValue('selected_rate_id', undefined);
      }
    } else {
      setApplicableRates([]);
      form.setValue('selected_rate_id', undefined);
    }
  }, [selectedRoomId, availableRooms, allBranchRates, form]);


  const handleWalkInSubmit = async (data: TransactionCreateData) => {
    if (!selectedRoomId || !data.selected_rate_id) {
      toast({ title: "Error", description: "Please select a room and a rate.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await createTransactionAndOccupyRoom(
        data,
        tenantId,
        branchId,
        selectedRoomId,
        data.selected_rate_id,
        staffUserId
      );
      if (result.success) {
        toast({ title: "Success", description: `${data.client_name} checked in to room ${availableRooms.find(r => r.id === selectedRoomId)?.room_name}.` });
        form.reset(defaultFormValues);
        setSelectedRoomId(null); // Reset selected room
        setApplicableRates([]); // Clear applicable rates
        fetchInitialData(); // Re-fetch available rooms as one is now occupied
        // TODO: Consider a more targeted update or global state for RoomStatusContent
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
              name="selected_room_id_placeholder_for_walkin" // This is a placeholder name, not directly used for value
              render={({ field }) => ( 
                <FormItem>
                  <FormLabel>Select Available Room *</FormLabel>
                  <Select
                    onValueChange={(value) => {
                        const roomId = value ? parseInt(value) : null;
                        setSelectedRoomId(roomId);
                        field.onChange(roomId); // Update form state if needed, though primary logic uses selectedRoomId
                    }}
                    value={selectedRoomId?.toString()}
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
                  {/* No FormMessage here as it's not a direct schema field, validation is implicit by other fields */}
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
                  <FormControl><Input placeholder="John Doe" {...field} /></FormControl>
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
