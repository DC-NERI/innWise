"use client";

import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel as RHFFormLabel, FormMessage } from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import type { HotelRoom } from '@/lib/types';
import type { UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';
import type { roomCleaningStatusAndNotesUpdateSchema } from '@/lib/schemas'; // Assuming this schema is used

type RoomCleaningStatusAndNotesUpdateData = z.infer<typeof roomCleaningStatusAndNotesUpdateSchema>;

interface CleaningNotesModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  selectedRoom: HotelRoom | null;
  form: UseFormReturn<RoomCleaningStatusAndNotesUpdateData>; // Pass the form instance
  onSubmit: (data: RoomCleaningStatusAndNotesUpdateData) => void;
  isSubmitting: boolean;
  currentCleaningStatusForModal: number | null; // To conditionally require notes
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

  // Import ROOM_CLEANING_STATUS directly or pass it as a prop if needed for more dynamic logic
  const ROOM_CLEANING_STATUS_OUT_OF_ORDER = 3; // Example, replace with imported constant

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-1 flex flex-col max-h-[85vh]">
        <DialogHeader className="p-2 border-b">
          <DialogTitle className="text-xl">
            Update Cleaning Notes: {selectedRoom.room_name} ({selectedRoom.room_code})
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex-grow flex flex-col overflow-hidden bg-card rounded-md">
            <div className="flex-grow space-y-3 p-3 overflow-y-auto"> {/* Added p-3 for better spacing */}
              <FormField
                control={form.control}
                name="cleaning_notes"
                render={({ field }) => (
                  <FormItem>
                    <RHFFormLabel>
                      Notes
                      {currentCleaningStatusForModal === ROOM_CLEANING_STATUS_OUT_OF_ORDER && ' * (Required for Out of Order)'}
                    </RHFFormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Enter cleaning notes..."
                        {...field}
                        value={field.value ?? ''}
                        rows={5} // Increased rows for more space
                        className="w-full" // Ensure textarea takes full width
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {/* The cleaning_status field is part of the form but might be hidden or read-only here if only notes are being edited */}
               <FormField
                control={form.control}
                name="cleaning_status"
                render={({ field }) => (
                  <FormItem className="sr-only"> {/* Hidden as we are only editing notes or status is pre-set */}
                    <RHFFormLabel>Cleaning Status</RHFFormLabel>
                    <FormControl>
                      <Input type="hidden" {...field} value={field.value ?? ''} />
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

// Need to import Input for the hidden field
import { Input } from "@/components/ui/input";