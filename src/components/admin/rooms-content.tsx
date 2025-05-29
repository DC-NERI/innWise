"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription as ShadCardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from "@/components/ui/label";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose, DialogDescription } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel as RHFFormLabel, FormMessage } from '@/components/ui/form';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription as ShadAlertDialogDescriptionConfirm, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle as ShadAlertDialogTitleConfirm, AlertDialogTrigger } from "@/components/ui/alert-dialog"; // Aliased to avoid conflict
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from '@/hooks/use-toast';
import { Loader2, BedDouble, Building, PlusCircle, Edit, Trash2, ArchiveRestore, Tags } from 'lucide-react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { hotelRoomCreateSchema, HotelRoomCreateData, hotelRoomUpdateSchema, HotelRoomUpdateData } from '@/lib/schemas';
import type { SimpleBranch, HotelRoom, SimpleRate } from '@/lib/types';
import { getBranchesForTenantSimple } from '@/actions/admin/branches/getBranchesForTenantSimple';
import { listRoomsForBranch } from '@/actions/admin/rooms/listRoomsForBranch';
import { getRatesForBranchSimple } from '@/actions/admin/rates/getRatesForBranchSimple';
import { createRoom } from '@/actions/admin/rooms/createRoom';
import { updateRoom } from '@/actions/admin/rooms/updateRoom';
import { archiveRoom } from '@/actions/admin/rooms/archiveRoom';
import { ROOM_AVAILABILITY_STATUS, ROOM_AVAILABILITY_STATUS_TEXT, ROOM_CLEANING_STATUS, ROOM_CLEANING_STATUS_OPTIONS, ROOM_CLEANING_STATUS_TEXT, HOTEL_ENTITY_STATUS } from '@/lib/constants';
import { Textarea } from '@/components/ui/textarea';
import { DataTable } from '@/components/ui/data-table';
import { getRoomColumns } from "@/components/admin/rooms/room-columns";

type RoomFormValues = HotelRoomCreateData | HotelRoomUpdateData;

const defaultFormValuesCreate: HotelRoomCreateData = {
  hotel_rate_ids: [],
  room_name: '',
  room_code: '',
  floor: undefined,
  room_type: '',
  bed_type: '',
  capacity: 2,
  is_available: ROOM_AVAILABILITY_STATUS.AVAILABLE,
  cleaning_status: ROOM_CLEANING_STATUS.CLEAN,
  cleaning_notes: '',
};

interface RoomsContentProps {
  tenantId: number;
  adminUserId: number;
}

export default function RoomsContent({ tenantId, adminUserId }: RoomsContentProps) {
  const [branches, setBranches] = useState<SimpleBranch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(null);
  const [rooms, setRooms] = useState<HotelRoom[]>([]);
  const [availableRates, setAvailableRates] = useState<SimpleRate[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(true);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<HotelRoom | null>(null);
  const [activeTab, setActiveTab] = useState<string>(String(HOTEL_ENTITY_STATUS.ACTIVE));
  const { toast } = useToast();

  const isEditing = !!selectedRoom;

  const form = useForm<RoomFormValues>({
    // Resolver and defaultValues set dynamically in useEffect
  });

  const fetchBranches = useCallback(async () => {
    if (!tenantId) return;
    setIsLoadingBranches(true);
    try {
      const fetchedBranches = await getBranchesForTenantSimple(tenantId);
      setBranches(fetchedBranches.filter(b => String(b.status) === HOTEL_ENTITY_STATUS.ACTIVE));
    } catch (error) {
      toast({ title: "Error", description: "Could not fetch branches.", variant: "destructive" });
    } finally {
      setIsLoadingBranches(false);
    }
  }, [tenantId, toast]);

  useEffect(() => {
    fetchBranches();
  }, [fetchBranches]);

  const fetchBranchData = useCallback(async (branchId: number) => {
    if (!tenantId) return;
    setIsLoadingData(true);
    setAvailableRates([]);
    try {
      const [fetchedRooms, fetchedRates] = await Promise.all([
        listRoomsForBranch(branchId, tenantId),
        getRatesForBranchSimple(tenantId, branchId)
      ]);
      setRooms(fetchedRooms);
      setAvailableRates(fetchedRates);
    } catch (error) {
      toast({ title: "Error", description: "Could not fetch room and rate data for the branch.", variant: "destructive" });
      setRooms([]);
      setAvailableRates([]);
    } finally {
      setIsLoadingData(false);
    }
  }, [tenantId, toast]);

  useEffect(() => {
    if (selectedBranchId) {
      fetchBranchData(selectedBranchId);
    } else {
      setRooms([]);
      setAvailableRates([]);
    }
  }, [selectedBranchId, fetchBranchData]);

   useEffect(() => {
    const currentIsEditing = !!selectedRoom;
    const newResolver = zodResolver(currentIsEditing ? hotelRoomUpdateSchema : hotelRoomCreateSchema);
    let newDefaults: RoomFormValues;

    if (currentIsEditing && selectedRoom) {
      newDefaults = {
        hotel_rate_ids: Array.isArray(selectedRoom.hotel_rate_id) ? selectedRoom.hotel_rate_id.map(id => Number(id)) : [],
        room_name: selectedRoom.room_name,
        room_code: selectedRoom.room_code,
        floor: selectedRoom.floor ?? undefined,
        room_type: selectedRoom.room_type ?? '',
        bed_type: selectedRoom.bed_type ?? '',
        capacity: selectedRoom.capacity ?? 2,
        is_available: selectedRoom.is_available as typeof ROOM_AVAILABILITY_STATUS[keyof typeof ROOM_AVAILABILITY_STATUS],
        cleaning_status: (selectedRoom.cleaning_status ?? ROOM_CLEANING_STATUS.CLEAN) as typeof ROOM_CLEANING_STATUS[keyof typeof ROOM_CLEANING_STATUS],
        cleaning_notes: selectedRoom.cleaning_notes || '',
        status: [String(HOTEL_ENTITY_STATUS.ACTIVE), String(HOTEL_ENTITY_STATUS.ARCHIVED)].includes(String(selectedRoom.status))
          ? (String(selectedRoom.status) as "0" | "1")
          : HOTEL_ENTITY_STATUS.ACTIVE,
      };
    } else {
      newDefaults = {
        ...defaultFormValuesCreate,
        hotel_rate_ids: [],
        is_available: ROOM_AVAILABILITY_STATUS.AVAILABLE,
        cleaning_status: ROOM_CLEANING_STATUS.CLEAN,
        status: HOTEL_ENTITY_STATUS.ACTIVE
      };
    }
    form.reset(newDefaults, { resolver: newResolver } as any);
  }, [selectedRoom, form, isEditDialogOpen, isAddDialogOpen]);


  const handleAddSubmit = async (data: HotelRoomCreateData) => {
    if (!selectedBranchId || !tenantId || !adminUserId) {
      toast({ title: "Error", description: "Branch, Tenant, or Admin ID must be selected/available.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await createRoom(data, tenantId, selectedBranchId, adminUserId);
      if (result.success && result.room) {
        toast({ title: "Success", description: "Room created." });
        setIsAddDialogOpen(false);
        fetchBranchData(selectedBranchId);
      } else {
        toast({ title: "Creation Failed", description: result.message || "Could not create room.", variant: "destructive" });
      }
    } catch (e) { toast({ title: "Error", description: "Unexpected error during room creation.", variant: "destructive" }); }
    finally { setIsSubmitting(false); }
  };

  const handleEditSubmit = async (data: HotelRoomUpdateData) => {
    if (!selectedRoom || !selectedBranchId || !tenantId || !adminUserId) return;
    setIsSubmitting(true);
    try {
      const result = await updateRoom(selectedRoom.id, data, tenantId, selectedBranchId, adminUserId);
      if (result.success && result.room) {
        toast({ title: "Success", description: "Room updated." });
        setIsEditDialogOpen(false); setSelectedRoom(null);
        fetchBranchData(selectedBranchId);
      } else {
        toast({ title: "Update Failed", description: result.message || "Could not update room.", variant: "destructive" });
      }
    } catch (e) { toast({ title: "Error", description: "Unexpected error during room update.", variant: "destructive" }); }
    finally { setIsSubmitting(false); }
  };

  const handleArchive = async (room: HotelRoom) => {
     if (!tenantId || !room.branch_id || !adminUserId) return;
    setIsSubmitting(true);
    try {
      const result = await archiveRoom(room.id, tenantId, room.branch_id, adminUserId);
      if (result.success) {
        toast({ title: "Success", description: `Room "${room.room_name}" archived.` });
        fetchBranchData(room.branch_id);
      } else {
        toast({ title: "Archive Failed", description: result.message || "Could not archive room.", variant: "destructive" });
      }
    } catch (e) { toast({ title: "Error", description: "Unexpected error during room archiving.", variant: "destructive" }); }
    finally { setIsSubmitting(false); }
  };

  const handleRestore = async (room: HotelRoom) => {
    if (!tenantId || !room.branch_id || !adminUserId) return;
    setIsSubmitting(true);
    const payload: HotelRoomUpdateData = {
      hotel_rate_ids: Array.isArray(room.hotel_rate_id) ? room.hotel_rate_id.map(id => Number(id)) : [],
      room_name: room.room_name,
      room_code: room.room_code,
      floor: room.floor,
      room_type: room.room_type,
      bed_type: room.bed_type,
      capacity: room.capacity ?? null,
      is_available: room.is_available as typeof ROOM_AVAILABILITY_STATUS[keyof typeof ROOM_AVAILABILITY_STATUS],
      cleaning_status: (room.cleaning_status ?? ROOM_CLEANING_STATUS.CLEAN) as typeof ROOM_CLEANING_STATUS[keyof typeof ROOM_CLEANING_STATUS],
      cleaning_notes: room.cleaning_notes || '',
      status: HOTEL_ENTITY_STATUS.ACTIVE,
    };
    try {
      const result = await updateRoom(room.id, payload, tenantId, room.branch_id, adminUserId);
      if (result.success && result.room) {
        toast({ title: "Success", description: `Room "${room.room_name}" restored.` });
        fetchBranchData(room.branch_id);
      } else {
        toast({ title: "Restore Failed", description: result.message || "Could not restore room.", variant: "destructive" });
      }
    } catch (e) { toast({ title: "Error", description: "Unexpected error during room restoration.", variant: "destructive" }); }
    finally { setIsSubmitting(false); }
  };

  const filteredRooms = React.useMemo(
    () => rooms.filter(room => String(room.status) === String(activeTab)),
    [rooms, activeTab]
  );

  const extractHoursFromName = (name: string | undefined): number => {
    if (!name) return Infinity;
    const match = name.match(/(\d+)\s*hr/i);
    return match ? parseInt(match[1], 10) : Infinity;
  };

  const renderFormFields = () => (
    <React.Fragment>
      <FormField control={form.control} name="room_name" render={({ field }) => (<FormItem><RHFFormLabel>Room Name *</RHFFormLabel><FormControl><Input placeholder="Deluxe Room 101" {...field} className="w-[90%]" /></FormControl><FormMessage /></FormItem>)} />
      <FormField control={form.control} name="room_code" render={({ field }) => (<FormItem><RHFFormLabel>Room Code *</RHFFormLabel><FormControl><Input placeholder="DR101" {...field} className="w-[90%]" /></FormControl><FormMessage /></FormItem>)} />

      <Controller
        control={form.control}
        name="hotel_rate_ids"
        render={({ field }) => (
          <FormItem>
            <RHFFormLabel>Associated Rates *</RHFFormLabel>
            {availableRates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active rates available for this branch. Please add rates first.</p>
            ) : (
              <div className="space-y-2 mt-1 max-h-40 overflow-y-auto border p-2 rounded-md w-[90%]">
                {availableRates.map(rate => (
                  <FormItem key={rate.id} className="flex flex-row items-start space-x-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value?.includes(rate.id)}
                        onCheckedChange={(checked) => {
                          const currentSelectedIds = Array.isArray(field.value) ? field.value : [];
                          return checked
                            ? field.onChange([...currentSelectedIds, rate.id])
                            : field.onChange(currentSelectedIds.filter(value => value !== rate.id));
                        }}
                      />
                    </FormControl>
                    <RHFFormLabel className="font-normal">{rate.name} (₱{rate.price.toFixed(2)})</RHFFormLabel>
                  </FormItem>
                ))}
              </div>
            )}
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField control={form.control} name="floor" render={({ field }) => (<FormItem><RHFFormLabel>Floor</RHFFormLabel><FormControl><Input type="number" placeholder="1" {...field} value={field.value ?? ''} onChange={e => field.onChange(e.target.value === '' ? undefined : parseInt(e.target.value, 10))} className="w-[90%]" /></FormControl><FormMessage /></FormItem>)} />
      <FormField control={form.control} name="room_type" render={({ field }) => (<FormItem><RHFFormLabel>Room Type</RHFFormLabel><FormControl><Input placeholder="Deluxe" {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl><FormMessage /></FormItem>)} />
      <FormField control={form.control} name="bed_type" render={({ field }) => (<FormItem><RHFFormLabel>Bed Type</RHFFormLabel><FormControl><Input placeholder="King" {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl><FormMessage /></FormItem>)} />
      <FormField control={form.control} name="capacity" render={({ field }) => (<FormItem><RHFFormLabel>Capacity</RHFFormLabel><FormControl><Input type="number" placeholder="2" {...field} value={field.value ?? ''} onChange={e => field.onChange(e.target.value === '' ? undefined : parseInt(e.target.value, 10))} className="w-[90%]" /></FormControl><FormMessage /></FormItem>)} />

      <FormField control={form.control} name="is_available"
        render={({ field }) => (
          <FormItem>
            <RHFFormLabel>Availability Status *</RHFFormLabel>
            <Select onValueChange={(value) => field.onChange(Number(value))} value={String(field.value ?? ROOM_AVAILABILITY_STATUS.AVAILABLE)}>
              <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder="Select availability status" /></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value={String(ROOM_AVAILABILITY_STATUS.AVAILABLE)}>{ROOM_AVAILABILITY_STATUS_TEXT[ROOM_AVAILABILITY_STATUS.AVAILABLE]}</SelectItem>
                <SelectItem value={String(ROOM_AVAILABILITY_STATUS.OCCUPIED)}>{ROOM_AVAILABILITY_STATUS_TEXT[ROOM_AVAILABILITY_STATUS.OCCUPIED]}</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField control={form.control} name="cleaning_status"
        render={({ field }) => (
          <FormItem>
            <RHFFormLabel>Cleaning Status *</RHFFormLabel>
            <Select onValueChange={(value) => field.onChange(Number(value))} value={String(field.value ?? ROOM_CLEANING_STATUS.CLEAN)}>
              <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder="Select cleaning status" /></SelectTrigger></FormControl>
              <SelectContent>
                {ROOM_CLEANING_STATUS_OPTIONS.map(option => (
                  <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
       <FormField
        control={form.control}
        name="cleaning_notes"
        render={({ field }) => (
          <FormItem>
            <RHFFormLabel>Cleaning Notes</RHFFormLabel>
            <FormControl>
              <Textarea
                placeholder="Enter cleaning notes..."
                {...field}
                value={field.value ?? ''}
                className="w-[90%]"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {isEditing && (
        <FormField control={form.control} name="status"
          render={({ field }) => (
            <FormItem>
              <RHFFormLabel>Room Record Status *</RHFFormLabel>
              <Select onValueChange={field.onChange} value={String(field.value ?? HOTEL_ENTITY_STATUS.ACTIVE)}>
                <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder="Select record status" /></SelectTrigger></FormControl>
                <SelectContent>
                    <SelectItem value={String(HOTEL_ENTITY_STATUS.ACTIVE)}>Active</SelectItem>
                    <SelectItem value={String(HOTEL_ENTITY_STATUS.ARCHIVED)}>Archived</SelectItem>
                </SelectContent>
              </Select><FormMessage />
            </FormItem>
          )}
        />
      )}
    </React.Fragment>
  );

  if (!tenantId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Room Management</CardTitle>
          <ShadCardDescription>Tenant information is not available.</ShadCardDescription>
        </CardHeader>
        <CardContent>
          <p>Please ensure you are properly logged in and tenant information is loaded.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col md:flex-row gap-6 h-full">
      <Card className="md:w-2/5 flex flex-col h-full">
        <CardHeader>
          <div className="flex items-center space-x-2">
            <Building className="h-6 w-6 text-primary" />
            <CardTitle>Select Branch</CardTitle>
          </div>
          <ShadCardDescription>Click a branch to view its rooms and associated rates.</ShadCardDescription>
        </CardHeader>
        <CardContent className="flex-grow overflow-y-auto p-1">
          {isLoadingBranches ? (
            <div className="flex justify-center items-center h-32"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
          ) : branches.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No active branches available for this tenant.</p>
          ) : (
            <ul className="space-y-1">
              {branches.map(branch => (
                <li key={branch.id}>
                  <Button
                    variant={selectedBranchId === branch.id ? "secondary" : "ghost"}
                    className="w-full justify-start text-left h-auto py-2 px-2"
                    onClick={() => setSelectedBranchId(branch.id)}
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{branch.branch_name}</span>
                    </div>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="md:w-3/5 flex flex-col h-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
                <div className="flex items-center space-x-2">
                    <BedDouble className="h-6 w-6 text-primary" />
                    <CardTitle>
                        {selectedBranchId ? `Rooms for: ${branches.find(b=>b.id === selectedBranchId)?.branch_name || 'Branch'}` : 'Hotel Room Management'}
                    </CardTitle>
                </div>
                <ShadCardDescription>
                    {selectedBranchId ? 'Manage rooms for the selected branch.' : 'Please select a branch to view and manage its rooms.'}
                </ShadCardDescription>
            </div>
            {selectedBranchId && (
                <Dialog
                    key={isEditing ? `edit-room-${selectedRoom?.id}` : `add-room-branch-${selectedBranchId}`}
                    open={isAddDialogOpen || isEditDialogOpen}
                    onOpenChange={(open) => {
                        if (!open) {
                            setIsAddDialogOpen(false);
                            setIsEditDialogOpen(false);
                            setSelectedRoom(null);
                            form.reset({ ...defaultFormValuesCreate, hotel_rate_ids: [], status: HOTEL_ENTITY_STATUS.ACTIVE, is_available: ROOM_AVAILABILITY_STATUS.AVAILABLE, cleaning_status: ROOM_CLEANING_STATUS.CLEAN, cleaning_notes: '' });
                        }
                    }}
                >
                <DialogTrigger asChild>
                    <Button onClick={() => { setSelectedRoom(null); form.reset({ ...defaultFormValuesCreate, hotel_rate_ids: [], status: HOTEL_ENTITY_STATUS.ACTIVE, is_available: ROOM_AVAILABILITY_STATUS.AVAILABLE, cleaning_status: ROOM_CLEANING_STATUS.CLEAN, cleaning_notes: '' }); setIsAddDialogOpen(true); setIsEditDialogOpen(false); }}
                            disabled={!selectedBranchId || isLoadingData || availableRates.length === 0}
                            title={!selectedBranchId ? "Select a branch first" : (availableRates.length === 0 ? "No active rates for this branch. Add rates first before adding rooms." : "Add new room")}>
                      <PlusCircle className="mr-2 h-4 w-4" /> Add Room
                    </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-lg p-3 flex flex-col max-h-[85vh]">
                    <DialogHeader className="p-2 border-b"><DialogTitle>{isEditing ? `Edit Room: ${selectedRoom?.room_name}` : 'Add New Room'}</DialogTitle></DialogHeader>
                    <Form {...form}>
                    <form onSubmit={form.handleSubmit(isEditing ? (d => handleEditSubmit(d as HotelRoomUpdateData)) : (d => handleAddSubmit(d as HotelRoomCreateData)))} className="bg-card rounded-md flex flex-col flex-grow overflow-hidden">
                        <div className="flex-grow space-y-3 p-1 overflow-y-auto">
                        {renderFormFields()}
                        </div>
                        <DialogFooter className="bg-card py-2 border-t px-3 sticky bottom-0 z-10">
                        <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                        <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : (isEditing ? "Save Changes" : "Create Room")}</Button>
                        </DialogFooter>
                    </form>
                    </Form>
                </DialogContent>
                </Dialog>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex-grow overflow-y-auto p-1">
          {!selectedBranchId ? (
            <div className="text-center py-10 text-muted-foreground flex flex-col items-center justify-center h-full">
              <Building className="h-12 w-12 mx-auto mb-3 opacity-50" />
              Please select a branch from the left to view its rooms.
            </div>
          ) : isLoadingData ? (
            <div className="flex justify-center items-center h-32"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2 text-muted-foreground">Loading room data...</p></div>
          ) : (
            <Tabs value={String(activeTab)} onValueChange={setActiveTab}>
              <TabsList className="mb-4"><TabsTrigger value={String(HOTEL_ENTITY_STATUS.ACTIVE)}>Active ({rooms.filter(r => String(r.status) === String(HOTEL_ENTITY_STATUS.ACTIVE)).length})</TabsTrigger><TabsTrigger value={String(HOTEL_ENTITY_STATUS.ARCHIVED)}>Archive ({rooms.filter(r => String(r.status) === String(HOTEL_ENTITY_STATUS.ARCHIVED)).length})</TabsTrigger></TabsList>
              <TabsContent value={String(HOTEL_ENTITY_STATUS.ACTIVE)}>
                {filteredRooms.length === 0 && <p className="text-muted-foreground text-center py-8">No active rooms found for this branch.</p>}
                {
                filteredRooms.length > 0 && (
                  // <Table>
                  //   <TableHeader>
                  //     <TableRow>
                  //       <TableHead>Room Information</TableHead>
                  //       <TableHead>Rates</TableHead>
                  //       <TableHead>Availability</TableHead>
                  //       <TableHead>Cleaning</TableHead>
                  //       <TableHead className="text-right">Actions</TableHead>
                  //       </TableRow>
                  //       </TableHeader>
                  //   <TableBody>{filteredRooms.map(r => (
                  //     <TableRow key={r.id}>
                  //       <TableCell>
                  //         <div>
                  //           <div className="font-medium">{r.room_name}</div>
                  //           <div className="text-xs text-muted-foreground">Room Number: {r.room_code}</div>
                  //           <div className="text-xs text-muted-foreground">Floor: {r.floor ?? 'N/A'}</div>
                  //         </div>
                  //       </TableCell>
                  //       <TableCell>
                  //         {r.hotel_rate_id && r.hotel_rate_id.length > 0 ? (
                  //           <Popover>
                  //             <PopoverTrigger asChild>
                  //               <Button variant="ghost" size="icon" className="h-7 w-7">
                  //                 <Tags className="h-4 w-4" />
                  //                 <span className="sr-only">View Associated Rates</span>
                  //               </Button>
                  //             </PopoverTrigger>
                  //             <PopoverContent className="w-auto p-3 max-w-xs">
                  //               <div className="text-sm">
                  //                 <p className="font-semibold mb-1 text-popover-foreground">Associated Rates:</p>
                  //                 {(() => {
                  //                   const extractHours = (name: string | undefined): number => {
                  //                     if (!name) return Infinity;
                  //                     const match = name.match(/(\d+)\s*hr/i);
                  //                     return match ? parseInt(match[1], 10) : Infinity;
                  //                   };

                  //                   const ratesForRoom = availableRates
                  //                     .filter(ar => r.hotel_rate_id!.includes(ar.id))
                  //                     .sort((a, b) => {
                  //                       const hoursA = extractHours(a.name);
                  //                       const hoursB = extractHours(b.name);
                  //                       if (hoursA !== hoursB) {
                  //                         return hoursA - hoursB;
                  //                       }
                  //                       return a.name.localeCompare(b.name);
                  //                     });

                  //                   if (ratesForRoom.length > 0) {
                  //                     return (
                  //                       <ul className="list-disc list-inside space-y-0.5 text-popover-foreground/90">
                  //                         {ratesForRoom.map(rate => (
                  //                           <li key={rate.id}>
                  //                             {rate.name} (₱{typeof rate.price === 'number' ? rate.price.toFixed(2) : 'N/A'})
                  //                           </li>
                  //                         ))}
                  //                         {r.hotel_rate_id
                  //                           .filter(rateId => !availableRates.some(ar => ar.id === rateId))
                  //                           .map(rateId => (
                  //                             <li key={rateId} className="text-xs text-muted-foreground italic">
                  //                               Rate ID: {rateId} (Inactive/Not Found)
                  //                             </li>
                  //                           ))
                  //                         }
                  //                       </ul>
                  //                     );
                  //                   }
                  //                   return <p className="text-xs text-muted-foreground">No active rates assigned or found.</p>;
                  //                 })()}
                  //               </div>
                  //             </PopoverContent>
                  //           </Popover>
                  //         ) : (
                  //           <span className="text-xs text-muted-foreground">N/A</span>
                  //         )}
                  //       </TableCell>
                  //       <TableCell>{ROOM_AVAILABILITY_STATUS_TEXT[Number(r.is_available) as keyof typeof ROOM_AVAILABILITY_STATUS_TEXT] || 'Unknown'}</TableCell>
                  //       <TableCell>{ROOM_CLEANING_STATUS_TEXT[Number(r.cleaning_status) as keyof typeof ROOM_CLEANING_STATUS_TEXT] || 'N/A'}</TableCell>
                  //       <TableCell className="text-right space-x-2">
                  //         <Button variant="outline" size="sm" onClick={() => { setSelectedRoom(r); setIsEditDialogOpen(true); setIsAddDialogOpen(false); }}><Edit className="mr-1 h-3 w-3" /> Edit</Button>
                  //         <AlertDialog><AlertDialogTrigger asChild><Button variant="destructive" size="sm" disabled={isSubmitting}><Trash2 className="mr-1 h-3 w-3" /> Archive</Button></AlertDialogTrigger>
                  //           <AlertDialogContent>
                  //             <AlertDialogHeader><ShadAlertDialogTitleConfirm>Confirm Archive</ShadAlertDialogTitleConfirm><ShadAlertDialogDescriptionConfirm>Are you sure you want to archive room "{r.room_name}"?</ShadAlertDialogDescriptionConfirm></AlertDialogHeader>
                  //             <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleArchive(r)} disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : "Archive"}</AlertDialogAction></AlertDialogFooter>
                  //           </AlertDialogContent>
                  //         </AlertDialog>
                  //       </TableCell>
                  //     </TableRow>))}
                  //   </TableBody>
                  // </Table>
                  <DataTable
                      columns={getRoomColumns(
                        availableRates,
                        setSelectedRoom,
                        setIsEditDialogOpen,
                        setIsAddDialogOpen,
                        handleArchive,
                        isSubmitting
                      )}
                      data={filteredRooms}
                    />
                    
                  )
                }
              </TabsContent>
               <TabsContent value={String(HOTEL_ENTITY_STATUS.ARCHIVED)}>
                {filteredRooms.length === 0 && <p className="text-muted-foreground text-center py-8">No archived rooms found for this branch.</p>}
                {filteredRooms.length > 0 && (
                  <Table><TableHeader><TableRow><TableHead>Room Information</TableHead><TableHead>Rates</TableHead><TableHead>Cleaning</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                    <TableBody>{filteredRooms.map(r => (
                      <TableRow key={r.id}>
                        <TableCell>
                            <div>
                                <div className="font-medium">{r.room_name}</div>
                                <div className="text-xs text-muted-foreground">Room Number: {r.room_code}</div>
                                <div className="text-xs text-muted-foreground">Floor: {r.floor ?? 'N/A'}</div>
                            </div>
                        </TableCell>
                        <TableCell>
                          {r.hotel_rate_id && r.hotel_rate_id.length > 0 ? (
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7">
                                  <Tags className="h-4 w-4" />
                                  <span className="sr-only">View Associated Rates</span>
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-3 max-w-xs">
                                <div className="text-sm">
                                  <p className="font-semibold mb-1 text-popover-foreground">Associated Rates:</p>
                                   {(() => {
                                    const extractHours = (name: string | undefined): number => {
                                      if (!name) return Infinity;
                                      const match = name.match(/(\d+)\s*hr/i);
                                      return match ? parseInt(match[1], 10) : Infinity;
                                    };

                                    const ratesForRoom = availableRates
                                      .filter(ar => r.hotel_rate_id!.includes(ar.id))
                                      .sort((a, b) => {
                                        const hoursA = extractHours(a.name);
                                        const hoursB = extractHours(b.name);
                                        if (hoursA !== hoursB) {
                                          return hoursA - hoursB;
                                        }
                                        return a.name.localeCompare(b.name);
                                      });

                                    if (ratesForRoom.length > 0) {
                                      return (
                                        <ul className="list-disc list-inside space-y-0.5 text-popover-foreground/90">
                                          {ratesForRoom.map(rate => (
                                            <li key={rate.id}>
                                              {rate.name} (₱{typeof rate.price === 'number' ? rate.price.toFixed(2) : 'N/A'})
                                            </li>
                                          ))}
                                          {r.hotel_rate_id
                                            .filter(rateId => !availableRates.some(ar => ar.id === rateId))
                                            .map(rateId => (
                                              <li key={rateId} className="text-xs text-muted-foreground italic">
                                                Rate ID: {rateId} (Inactive/Not Found)
                                              </li>
                                            ))
                                          }
                                        </ul>
                                      );
                                    }
                                    return <p className="text-xs text-muted-foreground">No active rates assigned or found.</p>;
                                  })()}
                                </div>
                              </PopoverContent>
                            </Popover>
                          ) : (
                            <span className="text-xs text-muted-foreground">N/A</span>
                          )}
                        </TableCell>
                        <TableCell>{ROOM_CLEANING_STATUS_TEXT[Number(r.cleaning_status) as keyof typeof ROOM_CLEANING_STATUS_TEXT] || 'N/A'}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" onClick={() => handleRestore(r)} disabled={isSubmitting}><ArchiveRestore className="mr-1 h-3 w-3" /> Restore</Button>
                        </TableCell>
                      </TableRow>))}
                    </TableBody>
                  </Table>)}
              </TabsContent>
            </Tabs>
          )}
          {!selectedBranchId && !isLoadingBranches && branches.length > 0 && (
             <div className="text-center py-10 text-muted-foreground flex flex-col items-center justify-center h-full">
                <Building className="h-12 w-12 mx-auto mb-3 opacity-50" />
                Please select a branch to manage its rooms.
            </div>
        )}
         {!isLoadingBranches && branches.length === 0 && (
             <div className="text-center py-10 text-muted-foreground flex flex-col items-center justify-center h-full">
                <Building className="h-12 w-12 mx-auto mb-3 opacity-50" />
                No active branches available for this tenant. Please add a branch first to manage rooms.
            </div>
        )}
        </CardContent>
      </Card>
    </div>
  );
}

