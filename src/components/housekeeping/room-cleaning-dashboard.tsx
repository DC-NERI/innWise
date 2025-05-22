
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription as ShadCardDescription } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle as ShadDialogTitle, DialogFooter, DialogClose, DialogDescription as ShadDialogDescriptionAliased } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel as RHFFormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Wrench, Edit3, CheckCircle2, XCircle, Search, AlertTriangle, RefreshCw } from 'lucide-react';
import type { HotelRoom, GroupedRooms, RoomCleaningStatusUpdateData } from '@/lib/types';
import { listRoomsForBranch } from '@/actions/admin';
import { updateRoomCleaningStatus } from '@/actions/staff';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { ROOM_CLEANING_STATUS, ROOM_CLEANING_STATUS_TEXT, ROOM_CLEANING_STATUS_OPTIONS, ROOM_AVAILABILITY_STATUS_TEXT } from '@/lib/constants';
import { roomCleaningStatusAndNotesUpdateSchema } from '@/lib/schemas';

interface RoomCleaningDashboardProps {
  tenantId: number;
  branchId: number;
  staffUserId: number;
}

export default function RoomCleaningDashboard({ tenantId, branchId, staffUserId }: RoomCleaningDashboardProps) {
  const [rooms, setRooms] = useState<HotelRoom[]>([]);
  const [groupedRooms, setGroupedRooms] = useState<GroupedRooms>({});
  const [isLoading, setIsLoading] = useState(true);
  const [activeCleaningFilterTab, setActiveCleaningFilterTab] = useState<string>(ROOM_CLEANING_STATUS.DIRTY);

  const [isCleaningUpdateModalOpen, setIsCleaningUpdateModalOpen] = useState(false);
  const [selectedRoomForCleaningUpdate, setSelectedRoomForCleaningUpdate] = useState<HotelRoom | null>(null);
  const [targetCleaningStatusForModal, setTargetCleaningStatusForModal] = useState<string | null>(null);
  const [isSubmittingModal, setIsSubmittingModal] = useState(false);

  const { toast } = useToast();

  const cleaningUpdateForm = useForm<RoomCleaningStatusUpdateData>({
    resolver: zodResolver(roomCleaningStatusAndNotesUpdateSchema),
    defaultValues: {
      cleaning_status: ROOM_CLEANING_STATUS.CLEAN,
      cleaning_notes: '',
    },
  });

  const updateRoomInLocalState = useCallback((updatedRoomPartial: Partial<HotelRoom> & { id: number }) => {
    setRooms(prevRooms => {
      const newRooms = prevRooms.map(r =>
        r.id === updatedRoomPartial.id ? { ...r, ...updatedRoomPartial } : r
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
      const finalSortedGroupedRooms: GroupedRooms = {};
      for (const floor of sortedFloors) finalSortedGroupedRooms[floor] = newGrouped[floor];
      setGroupedRooms(finalSortedGroupedRooms);
      return newRooms;
    });
  }, []);

  const fetchData = useCallback(async () => {
    if (!tenantId || !branchId) {
      setRooms([]);
      setGroupedRooms({});
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const fetchedRooms = await listRoomsForBranch(branchId, tenantId);
      setRooms(fetchedRooms);

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
      const finalSortedGroupedRooms: GroupedRooms = {};
      for (const floor of sortedFloors) finalSortedGroupedRooms[floor] = grouped[floor];
      setGroupedRooms(finalSortedGroupedRooms);

    } catch (error) {
      console.error("Error fetching rooms for housekeeping:", error);
      toast({ title: "Error", description: "Could not fetch room data.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [tenantId, branchId, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getDefaultNoteForStatus = (status: string, currentNotes?: string | null): string => {
    if (status === ROOM_CLEANING_STATUS.CLEAN) return "This is ready for use.";
    if (status === ROOM_CLEANING_STATUS.DIRTY) return "Please clean the room.";
    if (status === ROOM_CLEANING_STATUS.INSPECTION) return "Please do a room inspection.";
    if (status === ROOM_CLEANING_STATUS.OUT_OF_ORDER) return selectedRoomForCleaningUpdate?.cleaning_status === status ? (currentNotes || "") : "";
    return currentNotes || "";
  };

  const handleOpenCleaningUpdateModal = (room: HotelRoom, targetStatus: string) => {
    setSelectedRoomForCleaningUpdate(room);
    setTargetCleaningStatusForModal(targetStatus);
    cleaningUpdateForm.reset({
      cleaning_status: targetStatus,
      cleaning_notes: getDefaultNoteForStatus(targetStatus, room.cleaning_notes),
    });
    setIsCleaningUpdateModalOpen(true);
  };

  const handleSaveCleaningUpdate = async (data: RoomCleaningStatusUpdateData) => {
    if (!selectedRoomForCleaningUpdate || !tenantId || !branchId || !staffUserId) {
      toast({ title: "Error", description: "Missing details to update cleaning status/notes.", variant: "destructive" });
      return;
    }
    setIsSubmittingModal(true);
    try {
      const result = await updateRoomCleaningStatus(
        selectedRoomForCleaningUpdate.id,
        tenantId,
        branchId,
        data.cleaning_status,
        data.cleaning_notes, // Pass notes to the updated action
        staffUserId
      );
      if (result.success && result.updatedRoom) {
        toast({ title: "Success", description: "Room cleaning status and notes updated." });
        updateRoomInLocalState({
            id: selectedRoomForCleaningUpdate.id,
            cleaning_status: result.updatedRoom.cleaning_status,
            cleaning_notes: result.updatedRoom.cleaning_notes,
        });
        setIsCleaningUpdateModalOpen(false);
      } else {
        toast({ title: "Update Failed", description: result.message || "Could not update status/notes.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "An unexpected error occurred saving status/notes.", variant: "destructive" });
    } finally {
      setIsSubmittingModal(false);
    }
  };

  const cleaningStatusIcons: { [key: string]: React.ReactElement } = {
    [ROOM_CLEANING_STATUS.CLEAN]: <CheckCircle2 size={16} className="text-green-500" />,
    [ROOM_CLEANING_STATUS.DIRTY]: <XCircle size={16} className="text-red-500" />,
    [ROOM_CLEANING_STATUS.INSPECTION]: <Search size={16} className="text-yellow-500" />,
    [ROOM_CLEANING_STATUS.OUT_OF_ORDER]: <AlertTriangle size={16} className="text-orange-500" />,
  };

  const cleaningStatusActionButtons = [
    { status: ROOM_CLEANING_STATUS.CLEAN, icon: <CheckCircle2 size={18} />, label: "Mark Clean", variant: "ghost" as const, className:"hover:bg-green-100 dark:hover:bg-green-700 text-green-600 dark:text-green-400" },
    { status: ROOM_CLEANING_STATUS.DIRTY, icon: <XCircle size={18} />, label: "Mark Dirty", variant: "ghost" as const, className:"hover:bg-red-100 dark:hover:bg-red-700 text-red-600 dark:text-red-400" },
    { status: ROOM_CLEANING_STATUS.INSPECTION, icon: <Search size={18} />, label: "Needs Inspection", variant: "ghost" as const, className:"hover:bg-yellow-100 dark:hover:bg-yellow-700 text-yellow-600 dark:text-yellow-400" },
    { status: ROOM_CLEANING_STATUS.OUT_OF_ORDER, icon: <AlertTriangle size={18} />, label: "Out of Order", variant: "ghost" as const, className:"hover:bg-orange-100 dark:hover:bg-orange-700 text-orange-600 dark:text-orange-400" },
  ];

  const roomCountsByCleaningStatus = useMemo(() => {
    return rooms.reduce((acc, room) => {
      if (room.status === '1') {
        const statusKey = room.cleaning_status || ROOM_CLEANING_STATUS.CLEAN;
        acc[statusKey] = (acc[statusKey] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);
  }, [rooms]);

  const filteredGroupedRooms = useMemo(() => {
    const filtered: GroupedRooms = {};
    for (const floor in groupedRooms) {
      const floorRooms = groupedRooms[floor].filter(room =>
        room.status === '1' && (room.cleaning_status || ROOM_CLEANING_STATUS.CLEAN) === activeCleaningFilterTab
      );
      if (floorRooms.length > 0) {
        filtered[floor] = floorRooms;
      }
    }
    return filtered;
  }, [groupedRooms, activeCleaningFilterTab]);


  if (isLoading && rooms.length === 0) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">Loading room data...</p>
      </div>
    );
  }
  if (!branchId && !isLoading) {
    return (
        <Card>
            <CardHeader>
                <div className="flex items-center space-x-2">
                <Wrench className="h-6 w-6 text-primary" />
                <CardTitle>Housekeeping Dashboard</CardTitle>
                </div>
                <ShadCardDescription>Manage room cleaning statuses for your assigned branch.</ShadCardDescription>
            </CardHeader>
            <CardContent>
                <p className="text-muted-foreground">No branch assigned or selected. Please ensure your account is assigned to a branch.</p>
            </CardContent>
        </Card>
    );
  }


  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
            <div>
                <div className="flex items-center space-x-2">
                    <Wrench className="h-6 w-6 text-primary" />
                    <CardTitle>Housekeeping Dashboard</CardTitle>
                </div>
                <ShadCardDescription>Manage room cleaning statuses for your assigned branch.</ShadCardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={fetchData} disabled={isLoading}>
                <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center space-x-4 mb-4 text-xs text-muted-foreground border p-2 rounded-md bg-muted/30">
          <p className="font-semibold">Legend (Click icon to update status):</p>
          {cleaningStatusActionButtons.map(btn => (
            <span key={`legend-${btn.status}`} className="flex items-center">
              {React.cloneElement(btn.icon, {size: 14, className: cn("mr-1", btn.className.replace(/hover:[^ ]+ /g, '').replace(/text-[^-]+-\d+/g, ''))})} {btn.label}
            </span>
          ))}
        </div>

        <Tabs value={activeCleaningFilterTab} onValueChange={setActiveCleaningFilterTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 md:grid-cols-4">
            {ROOM_CLEANING_STATUS_OPTIONS.map(opt => (
              <TabsTrigger key={`tab-${opt.value}`} value={opt.value}>
                {opt.label} ({roomCountsByCleaningStatus[opt.value] || 0})
              </TabsTrigger>
            ))}
          </TabsList>

          {ROOM_CLEANING_STATUS_OPTIONS.map(opt => (
            <TabsContent key={`tab-content-${opt.value}`} value={opt.value} className="mt-4">
              {Object.keys(filteredGroupedRooms).length === 0 && (
                <p className="text-muted-foreground text-center py-6">No rooms currently in '{ROOM_CLEANING_STATUS_TEXT[opt.value as keyof typeof ROOM_CLEANING_STATUS_TEXT] || opt.value}' status.</p>
              )}
              <Accordion type="multiple" defaultValue={Object.keys(filteredGroupedRooms)} className="w-full space-y-2">
                {Object.entries(filteredGroupedRooms).map(([floor, floorRooms]) => {
                  if (floorRooms.length === 0) return null;
                  return (
                    <AccordionItem value={floor} key={`cleaning-floor-${floor}-${opt.value}`} className="border bg-background rounded-md shadow-sm">
                      <AccordionTrigger className="px-4 py-3 hover:no-underline text-lg">
                        Floor: {floor.replace('Ground Floor / Other', 'Ground Floor / Unspecified')} ({floorRooms.length})
                      </AccordionTrigger>
                      <AccordionContent className="px-4 pb-4 pt-0">
                        <div className="space-y-2">
                          {floorRooms.map(room => (
                            <div key={`cleaning-room-${room.id}`} className="flex items-center justify-between p-2.5 border-b last:border-b-0 hover:bg-muted/50 rounded-sm transition-colors">
                              <div>
                                <p className="font-medium">{room.room_name} <span className="text-sm text-muted-foreground">({room.room_code})</span></p>
                                <p className="text-xs flex items-center mb-0.5 text-muted-foreground">
                                  Occupancy: <span className="font-medium ml-1 text-foreground">{ROOM_AVAILABILITY_STATUS_TEXT[room.is_available]}</span>
                                </p>
                                <p className="text-xs flex items-center text-muted-foreground">
                                  Cleaning:
                                  <span className="ml-1 mr-2 flex items-center font-medium text-foreground">
                                     {cleaningStatusIcons[room.cleaning_status || ROOM_CLEANING_STATUS.CLEAN] || <Wrench size={14} />}
                                     <span className="ml-1">{ROOM_CLEANING_STATUS_TEXT[room.cleaning_status as keyof typeof ROOM_CLEANING_STATUS_TEXT || ROOM_CLEANING_STATUS.CLEAN]}</span>
                                  </span>
                                </p>
                                {room.cleaning_notes && (
                                  <p className="text-xs text-muted-foreground italic truncate max-w-xs" title={room.cleaning_notes}>
                                    Note: {room.cleaning_notes.substring(0, 40)}{room.cleaning_notes.length > 40 ? '...' : ''}
                                  </p>
                                )}
                              </div>
                              <div className="flex space-x-1 items-center">
                                {cleaningStatusActionButtons.map(actionBtn => (
                                  <Button
                                    key={actionBtn.status}
                                    variant={actionBtn.variant}
                                    size="icon"
                                    className={cn("h-8 w-8", actionBtn.className)}
                                    onClick={() => handleOpenCleaningUpdateModal(room, actionBtn.status)}
                                    disabled={isSubmittingModal || room.is_available === 1 /* Occupied */ || room.is_available === 2 /* Reserved */}
                                    title={room.is_available === 1 || room.is_available === 2 ? `Cannot change cleaning status: Room is ${ROOM_AVAILABILITY_STATUS_TEXT[room.is_available]}` : actionBtn.label}
                                  >
                                    {isSubmittingModal && selectedRoomForCleaningUpdate?.id === room.id && targetCleaningStatusForModal === actionBtn.status ? <Loader2 className="h-4 w-4 animate-spin" /> : React.cloneElement(actionBtn.icon, { size: 16 }) }
                                  </Button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>

      {/* Cleaning Status and Notes Update Modal */}
       <Dialog open={isCleaningUpdateModalOpen} onOpenChange={(isOpen) => {
            if (!isOpen) {
                setSelectedRoomForCleaningUpdate(null);
                setTargetCleaningStatusForModal(null);
                cleaningUpdateForm.reset({
                    cleaning_status: ROOM_CLEANING_STATUS.CLEAN,
                    cleaning_notes: '',
                });
            }
             setIsCleaningUpdateModalOpen(isOpen);
        }}>
            <DialogContent className="sm:max-w-md p-4">
                <DialogHeader className="border-b pb-3 mb-3">
                    <ShadDialogTitle className="text-xl">
                        Update Cleaning: {selectedRoomForCleaningUpdate?.room_name} ({selectedRoomForCleaningUpdate?.room_code})
                    </ShadDialogTitle>
                </DialogHeader>

                <Form {...cleaningUpdateForm}>
                    <form onSubmit={cleaningUpdateForm.handleSubmit(handleSaveCleaningUpdate)} className="space-y-4 py-2">
                        <FormField
                            control={cleaningUpdateForm.control}
                            name="cleaning_status"
                            render={({ field }) => (
                                <FormItem>
                                    <RHFFormLabel>New Cleaning Status *</RHFFormLabel>
                                    <Select
                                        onValueChange={(value) => {
                                            field.onChange(value);
                                            cleaningUpdateForm.setValue('cleaning_notes', getDefaultNoteForStatus(value, selectedRoomForCleaningUpdate?.cleaning_notes), {shouldValidate: value === ROOM_CLEANING_STATUS.OUT_OF_ORDER});
                                        }}
                                        value={field.value}
                                    >
                                        <FormControl><SelectTrigger><SelectValue placeholder="Select new status" /></SelectTrigger></FormControl>
                                        <SelectContent>
                                            {ROOM_CLEANING_STATUS_OPTIONS.map(opt => (
                                                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={cleaningUpdateForm.control}
                            name="cleaning_notes"
                            render={({ field }) => (
                                <FormItem>
                                    <RHFFormLabel>
                                        Notes
                                        {cleaningUpdateForm.getValues('cleaning_status') === ROOM_CLEANING_STATUS.OUT_OF_ORDER && ' * (Required)'}
                                    </RHFFormLabel>
                                    <FormControl><Textarea placeholder="Enter notes..." {...field} value={field.value ?? ''} rows={4} className="w-full" /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <DialogFooter className="sm:justify-start pt-3">
                             <Button type="submit" disabled={isSubmittingModal}>{isSubmittingModal ? <Loader2 className="animate-spin mr-2" size={16} /> : null} Save Changes</Button>
                             <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    </Card>
  );
}
