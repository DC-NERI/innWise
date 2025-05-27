
"use client";

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose
} from "@/components/ui/dialog"; // Added this import
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel as RHFFormLabel, FormMessage } from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import type { HotelRoom } from '@/lib/types';
import type { UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';
import type { roomCleaningStatusAndNotesUpdateSchema } from '@/lib/schemas';
import { ROOM_CLEANING_STATUS } from '@/lib/constants';
import { Input } from "@/components/ui/input";

type RoomCleaningStatusAndNotesUpdateData = z.infer<typeof roomCleaningStatusAndNotesUpdateSchema>;

interface CleaningNotesModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  selectedRoom: HotelRoom | null;
  form: UseFormReturn<RoomCleaningStatusAndNotesUpdateData>;
  onSubmit: (data: RoomCleaningStatusAndNotesUpdateData) => void;
  isSubmitting: boolean;
  currentCleaningStatusForModal: number | null; // Changed from string to number to match constants
}

export default function CleaningNotesModal({
  isOpen,
  onOpenChange,
  selectedRoom,
  form,
  onSubmit,
  isSubmitting,
  currentCleaningStatusForModal
}: CleaningNotesModalProps) {
  if (!selectedRoom) return null;

  const isOutOfOrder = currentCleaningStatusForModal === ROOM_CLEANING_STATUS.OUT_OF_ORDER;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-3 flex flex-col max-h-[85vh]">
        <DialogHeader className="p-2 border-b">
          <DialogTitle className="text-xl">
            Update Cleaning Notes: {selectedRoom.room_name} ({selectedRoom.room_code})
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex-grow flex flex-col overflow-hidden bg-card rounded-md">
            <div className="flex-grow space-y-3 p-3 overflow-y-auto">
              <FormField
                control={form.control}
                name="cleaning_notes"
                render={({ field }) => (
                  <FormItem>
                    <RHFFormLabel>
                      Notes
                      {isOutOfOrder && ' * (Required for Out of Order)'}
                    </RHFFormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Enter cleaning notes..."
                        {...field}
                        value={field.value ?? ''}
                        rows={5}
                        className="w-full"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="cleaning_status"
                render={({ field }) => (
                  <FormItem className="sr-only">
                    <RHFFormLabel>Cleaning Status</RHFFormLabel>
                    <FormControl>
                      {/* Ensure value is a string if input expects string, or handle type appropriately */}
                      <Input type="hidden" {...field} value={String(field.value ?? '')} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter className="bg-card py-2 border-t px-3 sticky bottom-0 z-10">
              <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="animate-spin mr-2" size={16} /> : null} Save Notes
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
