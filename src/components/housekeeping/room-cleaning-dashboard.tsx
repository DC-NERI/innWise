
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription as ShadCardDescription } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle as ShadDialogTitle, DialogFooter, DialogClose, DialogDescription as ShadDialogDescription } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel as RHFFormLabel, FormMessage } from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Wrench, Edit3, CheckCircle2, XCircle, Search, AlertTriangle, RefreshCw } from 'lucide-react';
import type { HotelRoom, GroupedRooms } from '@/lib/types';
import { listRoomsForBranch } from '@/actions/admin';
import { updateRoomCleaningStatus, updateRoomCleaningNotes } from '@/actions/staff';
import { useForm } from 'react-hook-form';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { ROOM_CLEANING_STATUS, ROOM_CLEANING_STATUS_TEXT, ROOM_CLEANING_STATUS_OPTIONS, ROOM_AVAILABILITY_STATUS, ROOM_AVAILABILITY_STATUS_TEXT } from '@/lib/constants';

interface RoomCleaningDashboardProps {
  tenantId: number;
  branchId: number;
  staffUserId: number;
}

export default function RoomCleaningDashboard({ tenantId, branchId, staffUserId }: RoomCleaningDashboardProps) {
  const [rooms, setRooms] = useState<HotelRoom[]>([]);
  const [groupedRooms, setGroupedRooms] = useState<GroupedRooms>({});
  const [isLoading, setIsLoading] = useState(true);
  const [activeCleaningFilterTab, setActiveCleaningFilterTab] = useState<string>(ROOM_CLEANING_STATUS.DIRTY); // Default to "Dirty"

  const [isCleaningNotesModalOpen, setIsCleaningNotesModalOpen] = useState(false);
  const [selectedRoomForCleaningNotes, setSelectedRoomForCleaningNotes] = useState<HotelRoom | null>(null);
  const [isSubmittingNotes, setIsSubmittingNotes] = useState(false);
  const [isSubmittingStatusRoomId, setIsSubmittingStatusRoomId] = useState<number | null>(null);

  const { toast } = useToast();

  const cleaningNotesForm = useForm<{ notes: string }>({
    defaultValues: { notes: '' },
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

  const handleQuickSetCleaningStatus = async (roomId: number, newStatus: string) => {
    if (!tenantId || !branchId || !staffUserId) {
      toast({ title: "Error", description: "Missing required identifiers for action.", variant: "destructive" });
      return;
    }
    setIsSubmittingStatusRoomId(roomId);
    try {
      const result = await updateRoomCleaningStatus(roomId, tenantId, branchId, newStatus, staffUserId);
      if (result.success && result.updatedRoom) {
        toast({ title: "Success", description: `Room cleaning status set to ${ROOM_CLEANING_STATUS_TEXT[newStatus]}.` });
        updateRoomInLocalState({ id: roomId, cleaning_status: newStatus });
      } else {
        toast({ title: "Update Failed", description: result.message || "Could not update cleaning status.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "An unexpected error occurred while updating status.", variant: "destructive" });
    } finally {
      setIsSubmittingStatusRoomId(null);
    }
  };

  const handleOpenCleaningNotesModal = (room: HotelRoom) => {
    setSelectedRoomForCleaningNotes(room);
    cleaningNotesForm.reset({ notes: room.cleaning_notes || '' });
    setIsCleaningNotesModalOpen(true);
  };

  const handleSaveCleaningNotes = async (data: { notes: string }) => {
    if (!selectedRoomForCleaningNotes || !tenantId || !branchId || !staffUserId) {
      toast({ title: "Error", description: "Missing details to update cleaning notes.", variant: "destructive" });
      return;
    }
    setIsSubmittingNotes(true);
    try {
      const result = await updateRoomCleaningNotes(selectedRoomForCleaningNotes.id, data.notes, tenantId, branchId, staffUserId);
      if (result.success && result.updatedRoom) {
        toast({ title: "Success", description: "Cleaning notes updated." });
        updateRoomInLocalState({ id: selectedRoomForCleaningNotes.id, cleaning_notes: result.updatedRoom.cleaning_notes });
        setIsCleaningNotesModalOpen(false);
      } else {
        toast({ title: "Update Failed", description: result.message || "Could not update cleaning notes.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "An unexpected error occurred saving cleaning notes.", variant: "destructive" });
    } finally {
      setIsSubmittingNotes(false);
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
      if (room.status === '1') { // Only active room definitions
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
          <p className="font-semibold">Legend:</p>
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
                <p className="text-muted-foreground text-center py-6">No rooms currently in '{ROOM_CLEANING_STATUS_TEXT[opt.value]}' status.</p>
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
                                     <span className="ml-1">{ROOM_CLEANING_STATUS_TEXT[room.cleaning_status || ROOM_CLEANING_STATUS.CLEAN]}</span>
                                  </span>
                                </p>
                                {room.cleaning_notes && (
                                  <p className="text-xs text-muted-foreground italic truncate max-w-xs" title={room.cleaning_notes}>
                                    Note: {room.cleaning_notes.substring(0, 40)}{room.cleaning_notes.length > 40 ? '...' : ''}
                                  </p>
                                )}
                              </div>
                              <div className="flex space-x-1 items-center">
                                 <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-muted-foreground hover:text-primary"
                                      onClick={() => handleOpenCleaningNotesModal(room)}
                                      title="View/Edit Cleaning Notes"
                                      disabled={isSubmittingStatusRoomId === room.id}
                                  >
                                      <Edit3 className="h-4 w-4" />
                                  </Button>
                                {cleaningStatusActionButtons.map(actionBtn => (
                                  <Button
                                    key={actionBtn.status}
                                    variant={actionBtn.variant}
                                    size="icon"
                                    className={cn("h-8 w-8", actionBtn.className)}
                                    onClick={() => handleQuickSetCleaningStatus(room.id, actionBtn.status)}
                                    disabled={isSubmittingStatusRoomId === room.id || room.cleaning_status === actionBtn.status}
                                    title={actionBtn.label}
                                  >
                                    {isSubmittingStatusRoomId === room.id && room.cleaning_status !== actionBtn.status ? <Loader2 className="h-4 w-4 animate-spin" /> : React.cloneElement(actionBtn.icon, { size: 16 }) }
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

      {/* Cleaning Notes Modal */}
       <Dialog open={isCleaningNotesModalOpen} onOpenChange={(isOpen) => {
            if (!isOpen) {
                setSelectedRoomForCleaningNotes(null);
                cleaningNotesForm.reset({ notes: '' });
            }
             setIsCleaningNotesModalOpen(isOpen);
        }}>
            <DialogContent className="sm:max-w-md p-4">
                <DialogHeader className="border-b pb-3 mb-3">
                    <ShadDialogTitle className="text-xl">
                        Cleaning Notes for Room: {selectedRoomForCleaningNotes?.room_name}
                    </ShadDialogTitle>
                    <ShadDialogDescription className="text-sm text-muted-foreground">
                       Room Code: {selectedRoomForCleaningNotes?.room_code} <br/>
                       Current Status: {ROOM_CLEANING_STATUS_TEXT[selectedRoomForCleaningNotes?.cleaning_status || ROOM_CLEANING_STATUS.CLEAN]}
                    </ShadDialogDescription>
                </DialogHeader>

                <Form {...cleaningNotesForm}>
                    <form onSubmit={cleaningNotesForm.handleSubmit(handleSaveCleaningNotes)} className="space-y-4 py-2">
                        <FormField control={cleaningNotesForm.control} name="notes" render={({ field }) => (
                            <FormItem>
                                <RHFFormLabel>Note</RHFFormLabel>
                                <FormControl><Textarea placeholder="Add or update cleaning notes..." {...field} value={field.value ?? ''} rows={5} className="w-full" /></FormControl>
                                <FormMessage />
                            </FormItem>
                        )} />
                        <DialogFooter className="sm:justify-start pt-3">
                             <Button type="submit" disabled={isSubmittingNotes}>{isSubmittingNotes ? <Loader2 className="animate-spin mr-2" size={16} /> : null} Save Note</Button>
                             <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    </Card>
  );
}

    
    