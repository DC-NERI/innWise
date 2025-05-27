"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription as ShadCardDescription } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, CheckCircle2, XCircle, Search, AlertTriangle, RefreshCw, Wrench, Edit3 } from 'lucide-react';
import type { HotelRoom, GroupedRooms } from '@/lib/types';
import { useForm, UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { ROOM_CLEANING_STATUS, ROOM_CLEANING_STATUS_TEXT, ROOM_CLEANING_STATUS_OPTIONS, ROOM_AVAILABILITY_STATUS, HOTEL_ENTITY_STATUS } from '@/lib/constants';
import { roomCleaningStatusAndNotesUpdateSchema, RoomCleaningStatusUpdateData } from '@/lib/schemas';
import CleaningNotesModal from './CleaningNotesModal'; // Import the new modal
import { updateRoomCleaningStatus as serverUpdateRoomCleaningStatusAction } from '@/actions/staff/rooms/updateRoomCleaningStatus';


interface CleaningStatusUpdateCardProps {
  rooms: HotelRoom[];
  groupedRooms: GroupedRooms; // This might need to be recalculated based on filtered rooms for tabs
  activeRoomsOnly: HotelRoom[]; // Pass pre-filtered active rooms
  staffUserId: number | null;
  tenantId: number | null;
  branchId: number | null;
  onStatusUpdateSuccess: (updatedRoomData: Pick<HotelRoom, 'id' | 'cleaning_status' | 'cleaning_notes'>) => void;
  fetchRoomsAndRatesData: () => void;
  isLoading: boolean;
  roomCountsByCleaningStatus: Record<number, number>;
}

const getDefaultNoteForModal = (status: number, currentNotes?: string | null): string => {
    if (status === ROOM_CLEANING_STATUS.CLEAN) return "This room is ready for use.";
    if (status === ROOM_CLEANING_STATUS.DIRTY) return "Please clean the room.";
    if (status === ROOM_CLEANING_STATUS.INSPECTION) return "Please do a room inspection.";
    if (status === ROOM_CLEANING_STATUS.OUT_OF_ORDER) {
        // If we are specifically setting to Out of Order, and it wasn't already, require new notes.
        // If it *was* Out of Order, allow editing the existing notes.
        return (currentNotes && status === ROOM_CLEANING_STATUS.OUT_OF_ORDER) ? currentNotes : "";
    }
    return currentNotes || "";
};


export default function CleaningStatusUpdateCard({
  rooms, // All rooms for the branch (active and inactive definition status)
  activeRoomsOnly, // Rooms with definition status = ACTIVE
  staffUserId,
  tenantId,
  branchId,
  onStatusUpdateSuccess, // Callback to update parent state
  fetchRoomsAndRatesData,
  isLoading,
  roomCountsByCleaningStatus,
}: CleaningStatusUpdateCardProps) {
  const [activeCleaningTab, setActiveCleaningTab] = useState<string>(String(ROOM_CLEANING_STATUS.DIRTY));
  const [roomSearchTerm, setRoomSearchTerm] = useState('');

  const [isCleaningNotesModalOpen, setIsCleaningNotesModalOpen] = useState(false);
  const [selectedRoomForCleaningNotes, setSelectedRoomForCleaningNotes] = useState<HotelRoom | null>(null);
  const [targetCleaningStatusForModal, setTargetCleaningStatusForModal] = useState<number | null>(null);
  const [isSubmittingCleaningStatus, setIsSubmittingCleaningStatus] = useState(false);

  const { toast } = useToast();

  const cleaningUpdateForm = useForm<RoomCleaningStatusUpdateData>({
    resolver: zodResolver(roomCleaningStatusAndNotesUpdateSchema),
    defaultValues: {
      cleaning_status: ROOM_CLEANING_STATUS.CLEAN,
      cleaning_notes: '',
    },
  });

  const handleOpenCleaningUpdateModal = (room: HotelRoom, targetStatus: number) => {
    if (!staffUserId) {
      toast({ title: "Action Failed", description: "User ID not found. Cannot update cleaning status.", variant: "destructive" });
      return;
    }
    setSelectedRoomForCleaningNotes(room);
    setTargetCleaningStatusForModal(targetStatus);
    cleaningUpdateForm.reset({
      cleaning_status: targetStatus,
      cleaning_notes: getDefaultNoteForModal(targetStatus, room.cleaning_notes),
    });
    setIsCleaningNotesModalOpen(true);
  };

  const handleSaveCleaningUpdateAndNotes = async (data: RoomCleaningStatusUpdateData) => {
    if (!selectedRoomForCleaningNotes || !tenantId || !branchId || !staffUserId || data.cleaning_status === null || data.cleaning_status === undefined) {
      toast({ title: "Error", description: "Missing details to update cleaning status/notes.", variant: "destructive" });
      return;
    }
    setIsSubmittingCleaningStatus(true);
    try {
      const result = await serverUpdateRoomCleaningStatusAction(
        selectedRoomForCleaningNotes.id,
        tenantId,
        branchId,
        data.cleaning_status,
        data.cleaning_notes,
        staffUserId
      );
      if (result.success && result.updatedRoom) {
        toast({ title: "Success", description: "Room cleaning status and notes updated." });
        onStatusUpdateSuccess({ // Call parent's update function
            id: selectedRoomForCleaningNotes.id,
            cleaning_status: result.updatedRoom.cleaning_status,
            cleaning_notes: result.updatedRoom.cleaning_notes,
        });
        setIsCleaningNotesModalOpen(false);
      } else {
        toast({ title: "Update Failed", description: result.message || "Could not update status/notes.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: `An unexpected error occurred. ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
    } finally {
      setIsSubmittingCleaningStatus(false);
    }
  };


  const cleaningStatusIcons: { [key: number]: React.ReactElement } = {
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
  
  const filteredRoomsForCurrentTab = React.useMemo(() => {
    return activeRoomsOnly.filter(room =>
      (room.cleaning_status || ROOM_CLEANING_STATUS.CLEAN) === Number(activeCleaningTab) &&
      (roomSearchTerm === '' ||
       room.room_name?.toLowerCase().includes(roomSearchTerm.toLowerCase()) ||
       room.room_code?.toLowerCase().includes(roomSearchTerm.toLowerCase()))
    );
  }, [activeRoomsOnly, activeCleaningTab, roomSearchTerm]);

  const groupedFilteredRooms = React.useMemo(() => {
    return filteredRoomsForCurrentTab.reduce((acc, room) => {
      const floorKey = room.floor?.toString() ?? 'Ground Floor / Other';
      if (!acc[floorKey]) acc[floorKey] = [];
      acc[floorKey].push(room);
      acc[floorKey].sort((a, b) => (a.room_code || "").localeCompare(b.room_code || ""));
      return acc;
    }, {} as GroupedRooms);
  }, [filteredRoomsForCurrentTab]);

  const sortedFloorsForTab = React.useMemo(() => {
    return Object.keys(groupedFilteredRooms).sort((a, b) => {
      const numA = parseInt(a); const numB = parseInt(b);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      if (!isNaN(numA)) return -1; if (!isNaN(numB)) return 1;
      return a.localeCompare(b);
    });
  }, [groupedFilteredRooms]);


  return (
    <>
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
            <div>
                <div className="flex items-center space-x-2">
                    <Wrench className="h-5 w-5 text-primary" />
                    <CardTitle>Housekeeping Monitoring</CardTitle>
                </div>
                <ShadCardDescription className="flex justify-between items-center">
                    <span>Quickly update the cleaning status for rooms.</span>
                </ShadCardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={fetchRoomsAndRatesData} className="ml-4" disabled={isLoading}>
              <RefreshCw className={`mr-2 h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} /> Refresh Room List
            </Button>
        </div>
      </CardHeader>
      <CardContent>
           <div className="flex items-center space-x-4 mb-4 text-xs text-muted-foreground border p-2 rounded-md bg-muted/30">
            <p className="font-semibold">Quick Update (Status & Notes):</p>
            {cleaningStatusActionButtons.map(btn => (
              <span key={`legend-${btn.status}`} className="flex items-center">
                {React.cloneElement(btn.icon, {size: 14, className: cn("mr-1", btn.className.replace(/hover:[^ ]+ /g, '').replace(/text-[^-]+-\d+/g, ''))})} {btn.label}
              </span>
            ))}
          </div>
           <div className="mb-4">
            <Input
                type="text"
                placeholder="Search by Room Name or Code..."
                value={roomSearchTerm}
                onChange={(e) => setRoomSearchTerm(e.target.value)}
                className="max-w-sm"
            />
           </div>
          <Tabs value={activeCleaningTab} onValueChange={setActiveCleaningTab} className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              {ROOM_CLEANING_STATUS_OPTIONS.map(opt => (
                <TabsTrigger key={`tab-trigger-${opt.value}`} value={String(opt.value)}> {/* Ensure value is string */}
                  {opt.label} ({roomCountsByCleaningStatus[Number(opt.value)] || 0})
                </TabsTrigger>
              ))}
            </TabsList>
            {ROOM_CLEANING_STATUS_OPTIONS.map(opt => (
              <TabsContent key={`tab-content-${opt.value}`} value={String(opt.value)} className="mt-4">
                {isLoading ? (
                    <div className="flex justify-center py-4"><Loader2 className="animate-spin text-primary"/></div>
                ) : sortedFloorsForTab.length === 0 ? (
                    <p className="text-muted-foreground text-center py-6">No rooms currently in '{opt.label}' status{roomSearchTerm ? ` matching "${roomSearchTerm}"` : ''}.</p>
                ) : (
                  Number(opt.value) === ROOM_CLEANING_STATUS.CLEAN ? ( // Accordion for Clean rooms
                    <Accordion type="multiple" defaultValue={sortedFloorsForTab} className="w-full">
                        {sortedFloorsForTab.map(floor => {
                            const floorRooms = groupedFilteredRooms[floor];
                            if (floorRooms.length === 0) return null;
                            return (
                                <AccordionItem value={floor} key={`cleaning-floor-${floor}-${opt.value}`} className="border bg-card rounded-md shadow-sm mb-2">
                                <AccordionTrigger className="px-4 py-3 hover:no-underline text-lg">Floor: {floor.replace('Ground Floor / Other', 'Ground Floor / Unspecified')} ({floorRooms.length})</AccordionTrigger>
                                <AccordionContent className="px-4 pb-4 pt-0">
                                     {/* Room list content for CLEAN tab */}
                                     {floorRooms.map(room => (
                                        <div key={`clean-room-${room.id}`} className="flex items-center justify-between p-2 border-b last:border-b-0 hover:bg-muted/50 rounded">
                                            <div>
                                                <p className="font-medium">{room.room_name} <span className="text-sm text-muted-foreground">(Room #: {room.room_code})</span></p>
                                                <p className="text-xs flex items-center mb-1">Current:
                                                    <span className="ml-1 mr-2 flex items-center">
                                                        {cleaningStatusIcons[Number(room.cleaning_status)] || <Wrench size={14} />}
                                                        <span className="ml-1">{ROOM_CLEANING_STATUS_TEXT[Number(room.cleaning_status)]}</span>
                                                    </span>
                                                </p>
                                                {room.cleaning_notes && (<p className="text-xs text-muted-foreground italic truncate max-w-xs" title={room.cleaning_notes}>Note: {room.cleaning_notes.substring(0,40)}{room.cleaning_notes.length > 40 ? '...':''}</p>)}
                                            </div>
                                            <div className="flex space-x-1 items-center justify-end">
                                                {cleaningStatusActionButtons.map(actionBtn => (
                                                    <Button key={`action-${room.id}-${actionBtn.status}`} variant={actionBtn.variant} size="icon" className={cn("h-8 w-8", actionBtn.className)}
                                                        onClick={() => handleOpenCleaningUpdateModal(room, actionBtn.status)}
                                                        disabled={isSubmittingCleaningStatus || ( (Number(room.is_available) === ROOM_AVAILABILITY_STATUS.OCCUPIED || Number(room.is_available) === ROOM_AVAILABILITY_STATUS.RESERVED) && actionBtn.status !== ROOM_CLEANING_STATUS.OUT_OF_ORDER) }
                                                        title={ ( (Number(room.is_available) === ROOM_AVAILABILITY_STATUS.OCCUPIED || Number(room.is_available) === ROOM_AVAILABILITY_STATUS.RESERVED) && actionBtn.status !== ROOM_CLEANING_STATUS.OUT_OF_ORDER) ? `Cannot change cleaning status: Room is occupied/reserved` : actionBtn.label}
                                                    >
                                                        {isSubmittingCleaningStatus && selectedRoomForCleaningNotes?.id === room.id && targetCleaningStatusForModal === actionBtn.status ? <Loader2 className="h-4 w-4 animate-spin" /> : React.cloneElement(actionBtn.icon, { size: 16 }) }
                                                    </Button>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </AccordionContent>
                                </AccordionItem>
                            );
                        })}
                    </Accordion>
                  ) : ( // Table for Dirty, Needs Inspection, Out of Order
                    <div className="max-h-[60vh] overflow-y-auto">
                        <Table>
                        <TableHeader>
                            <TableRow>
                            <TableHead>Room Name</TableHead><TableHead>Room Code</TableHead><TableHead>Floor</TableHead><TableHead>Current Notes</TableHead><TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredRoomsForCurrentTab.map(room => (
                            <TableRow key={`table-room-${room.id}`}>
                                <TableCell className="font-medium">{room.room_name}</TableCell><TableCell>{room.room_code}</TableCell><TableCell>{room.floor ?? 'N/A'}</TableCell>
                                <TableCell className="max-w-xs truncate" title={room.cleaning_notes || undefined}>{room.cleaning_notes || '-'}</TableCell>
                                <TableCell className="text-right">
                                <div className="flex space-x-1 items-center justify-end">
                                    {cleaningStatusActionButtons.map(actionBtn => (
                                    <Button key={`table-action-${room.id}-${actionBtn.status}`} variant={actionBtn.variant} size="icon" className={cn("h-8 w-8", actionBtn.className)}
                                        onClick={() => handleOpenCleaningUpdateModal(room, actionBtn.status)}
                                        disabled={isSubmittingCleaningStatus || ( (Number(room.is_available) === ROOM_AVAILABILITY_STATUS.OCCUPIED || Number(room.is_available) === ROOM_AVAILABILITY_STATUS.RESERVED) && actionBtn.status !== ROOM_CLEANING_STATUS.OUT_OF_ORDER) }
                                        title={ ( (Number(room.is_available) === ROOM_AVAILABILITY_STATUS.OCCUPIED || Number(room.is_available) === ROOM_AVAILABILITY_STATUS.RESERVED) && actionBtn.status !== ROOM_CLEANING_STATUS.OUT_OF_ORDER) ? `Cannot change cleaning status: Room is occupied/reserved` : actionBtn.label}
                                    >
                                        {isSubmittingCleaningStatus && selectedRoomForCleaningNotes?.id === room.id && targetCleaningStatusForModal === actionBtn.status ? <Loader2 className="h-4 w-4 animate-spin" /> : React.cloneElement(actionBtn.icon, { size: 16 }) }
                                    </Button>
                                    ))}
                                </div>
                                </TableCell>
                            </TableRow>
                            ))}
                        </TableBody>
                        </Table>
                    </div>
                  )
                )}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
    </Card>
    <CleaningNotesModal
        isOpen={isCleaningNotesModalOpen}
        onOpenChange={setIsCleaningNotesModalOpen}
        selectedRoom={selectedRoomForCleaningNotes}
        form={cleaningUpdateForm}
        onSubmit={handleSaveCleaningUpdateAndNotes}
        isSubmitting={isSubmittingCleaningStatus}
        currentCleaningStatusForModal={targetCleaningStatusForModal}
    />
    </>
  );
}