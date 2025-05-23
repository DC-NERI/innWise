
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from "@/components/ui/label";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel as RHFFormLabel, FormMessage } from '@/components/ui/form';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from '@/hooks/use-toast';
import { Loader2, BedDouble, Building, PlusCircle, Edit, Trash2, ArchiveRestore } from 'lucide-react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { hotelRoomCreateSchema, HotelRoomCreateData, hotelRoomUpdateSchema, HotelRoomUpdateData } from '@/lib/schemas';
import type { SimpleBranch, HotelRoom, SimpleRate } from '@/lib/types';
import { getBranchesForTenantSimple, listRoomsForBranch, getRatesForBranchSimple, createRoom, updateRoom, archiveRoom } from '@/actions/admin';
import { ROOM_AVAILABILITY_STATUS, ROOM_AVAILABILITY_STATUS_TEXT, ROOM_CLEANING_STATUS, ROOM_CLEANING_STATUS_OPTIONS, ROOM_CLEANING_STATUS_TEXT, HOTEL_ENTITY_STATUS } from '@/lib/constants';

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
};

interface RoomsContentProps {
  tenantId: number;
}

export default function RoomsContent({ tenantId }: RoomsContentProps) {
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
  const [activeTab, setActiveTab] = useState("active");
  const { toast } = useToast();

  const isEditing = !!selectedRoom;

  const form = useForm<RoomFormValues>({
  });

  const fetchBranches = useCallback(async () => {
    if (!tenantId) return;
    setIsLoadingBranches(true);
    try {
      const fetchedBranches = await getBranchesForTenantSimple(tenantId);
      setBranches(fetchedBranches);
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
        hotel_rate_ids: Array.isArray(selectedRoom.hotel_rate_id) ? selectedRoom.hotel_rate_id : [],
        room_name: selectedRoom.room_name,
        room_code: selectedRoom.room_code,
        floor: selectedRoom.floor ?? undefined,
        room_type: selectedRoom.room_type ?? '',
        bed_type: selectedRoom.bed_type ?? '',
        capacity: selectedRoom.capacity ?? 2,
        is_available: selectedRoom.is_available,
        cleaning_status: selectedRoom.cleaning_status || ROOM_CLEANING_STATUS.CLEAN,
        status: selectedRoom.status || HOTEL_ENTITY_STATUS.ACTIVE,
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
    if (!selectedBranchId || !tenantId) {
      toast({ title: "Error", description: "Branch and Tenant must be selected.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await createRoom(data, tenantId, selectedBranchId);
      if (result.success && result.room) {
        toast({ title: "Success", description: "Room created." });
        setRooms(prev => [...prev, result.room!].sort((a, b) => a.room_name.localeCompare(b.room_name)));
        setIsAddDialogOpen(false);
      } else {
        toast({ title: "Creation Failed", description: result.message, variant: "destructive" });
      }
    } catch (e) { toast({ title: "Error", description: "Unexpected error during room creation.", variant: "destructive" }); }
    finally { setIsSubmitting(false); }
  };

  const handleEditSubmit = async (data: HotelRoomUpdateData) => {
    if (!selectedRoom || !selectedBranchId || !tenantId) return;
    setIsSubmitting(true);
    try {
      const result = await updateRoom(selectedRoom.id, data, tenantId, selectedBranchId);
      if (result.success && result.room) {
        toast({ title: "Success", description: "Room updated." });
        setRooms(prev => prev.map(r => r.id === result.room!.id ? result.room! : r).sort((a, b) => a.room_name.localeCompare(b.room_name)));
        setIsEditDialogOpen(false); setSelectedRoom(null);
      } else {
        toast({ title: "Update Failed", description: result.message, variant: "destructive" });
      }
    } catch (e) { toast({ title: "Error", description: "Unexpected error during room update.", variant: "destructive" }); }
    finally { setIsSubmitting(false); }
  };
  
  const handleArchive = async (room: HotelRoom) => {
     if (!tenantId || !room.branch_id) return;
    setIsSubmitting(true);
    try {
      const result = await archiveRoom(room.id, tenantId, room.branch_id);
      if (result.success) {
        toast({ title: "Success", description: `Room "${room.room_name}" archived.` });
        setRooms(prev => prev.map(r => r.id === room.id ? { ...r, status: HOTEL_ENTITY_STATUS.ARCHIVED } : r));
      } else {
        toast({ title: "Archive Failed", description: result.message, variant: "destructive" });
      }
    } catch (e) { toast({ title: "Error", description: "Unexpected error during room archiving.", variant: "destructive" }); }
    finally { setIsSubmitting(false); }
  };

  const handleRestore = async (room: HotelRoom) => {
    if (!tenantId || !room.branch_id) return;
    setIsSubmitting(true);
    const payload: HotelRoomUpdateData = {
      hotel_rate_ids: Array.isArray(room.hotel_rate_id) ? room.hotel_rate_id : [],
      room_name: room.room_name,
      room_code: room.room_code,
      floor: room.floor,
      room_type: room.room_type,
      bed_type: room.bed_type,
      capacity: room.capacity,
      is_available: room.is_available,
      cleaning_status: room.cleaning_status || ROOM_CLEANING_STATUS.CLEAN,
      status: HOTEL_ENTITY_STATUS.ACTIVE,
    };
    try {
      const result = await updateRoom(room.id, payload, tenantId, room.branch_id);
      if (result.success && result.room) {
        toast({ title: "Success", description: `Room "${room.room_name}" restored.` });
        setRooms(prev => prev.map(r => r.id === result.room!.id ? result.room! : r));
      } else {
        toast({ title: "Restore Failed", description: result.message, variant: "destructive" });
      }
    } catch (e) { toast({ title: "Error", description: "Unexpected error during room restoration.", variant: "destructive" }); }
    finally { setIsSubmitting(false); }
  };


  const filteredRooms = rooms.filter(room => room.status === (activeTab === "active" ? HOTEL_ENTITY_STATUS.ACTIVE : HOTEL_ENTITY_STATUS.ARCHIVED));

  const getRateNames = (rateIds: number[] | null): string => {
    if (!Array.isArray(rateIds) || rateIds.length === 0) return 'N/A';
    return rateIds.map(id => availableRates.find(r => r.id === id)?.name || `Rate ID: ${id}`).join(', ');
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
              <p className="text-sm text-muted-foreground">No rates available for this branch. Please add rates first.</p>
            ) : (
              <div className="space-y-2 mt-1 max-h-40 overflow-y-auto border p-2 rounded-md w-[90%]">
                {availableRates.map(rate => (
                  <FormItem key={rate.id} className="flex flex-row items-start space-x-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value?.includes(rate.id)}
                        onCheckedChange={(checked) => {
                          const currentSelectedIds = field.value || [];
                          return checked
                            ? field.onChange([...currentSelectedIds, rate.id])
                            : field.onChange(currentSelectedIds.filter(value => value !== rate.id));
                        }}
                      />
                    </FormControl>
                    <Label className="font-normal">{rate.name} (₱{rate.price.toFixed(2)})</Label>
                  </FormItem>
                ))}
              </div>
            )}
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField control={form.control} name="floor" render={({ field }) => (<FormItem><RHFFormLabel>Floor</RHFFormLabel><FormControl><Input type="number" placeholder="1" {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl><FormMessage /></FormItem>)} />
      <FormField control={form.control} name="room_type" render={({ field }) => (<FormItem><RHFFormLabel>Room Type</RHFFormLabel><FormControl><Input placeholder="Deluxe" {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl><FormMessage /></FormItem>)} />
      <FormField control={form.control} name="bed_type" render={({ field }) => (<FormItem><RHFFormLabel>Bed Type</RHFFormLabel><FormControl><Input placeholder="King" {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl><FormMessage /></FormItem>)} />
      <FormField control={form.control} name="capacity" render={({ field }) => (<FormItem><RHFFormLabel>Capacity</RHFFormLabel><FormControl><Input type="number" placeholder="2" {...field} value={field.value ?? ''} className="w-[90%]" /></FormControl><FormMessage /></FormItem>)} />
      
      <FormField control={form.control} name="is_available"
        render={({ field }) => (
          <FormItem>
            <RHFFormLabel>Availability Status *</RHFFormLabel>
            <Select onValueChange={(value) => field.onChange(parseInt(value))} value={field.value?.toString()}>
              <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder="Select availability status" /></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value={ROOM_AVAILABILITY_STATUS.AVAILABLE.toString()}>{ROOM_AVAILABILITY_STATUS_TEXT[ROOM_AVAILABILITY_STATUS.AVAILABLE]}</SelectItem>
                <SelectItem value={ROOM_AVAILABILITY_STATUS.OCCUPIED.toString()}>{ROOM_AVAILABILITY_STATUS_TEXT[ROOM_AVAILABILITY_STATUS.OCCUPIED]}</SelectItem>
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
            <Select onValueChange={(value) => field.onChange(Number(value))} value={field.value?.toString() ?? ROOM_CLEANING_STATUS.CLEAN.toString()}>
              <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder="Select cleaning status" /></SelectTrigger></FormControl>
              <SelectContent>
                {ROOM_CLEANING_STATUS_OPTIONS.map(option => (
                  <SelectItem key={option.value} value={option.value.toString()}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      {isEditing && (
        <FormField control={form.control} name="status"
          render={({ field }) => (
            <FormItem>
              <RHFFormLabel>Room Record Status *</RHFFormLabel>
              <Select onValueChange={field.onChange} value={field.value?.toString() ?? HOTEL_ENTITY_STATUS.ACTIVE}>
                <FormControl><SelectTrigger className="w-[90%]"><SelectValue placeholder="Select record status" /></SelectTrigger></FormControl>
                <SelectContent>
                    <SelectItem value={HOTEL_ENTITY_STATUS.ACTIVE}>Active</SelectItem>
                    <SelectItem value={HOTEL_ENTITY_STATUS.ARCHIVED}>Archived</SelectItem>
                </SelectContent>
              </Select><FormMessage />
            </FormItem>
          )}
        />
      )}
    </React.Fragment>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center space-x-2"><BedDouble className="h-6 w-6 text-primary" /><CardTitle>Hotel Rooms Management</CardTitle></div>
        <CardDescription>Manage hotel rooms for a selected branch.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
         <div className="flex items-end space-x-4">
            <div className="flex-grow space-y-2">
                <Label htmlFor="branch-select-trigger-rooms">Select Branch</Label>
                <Select onValueChange={(value) => setSelectedBranchId(value ? parseInt(value) : null)} value={selectedBranchId?.toString()} disabled={isLoadingBranches || branches.length === 0}>
                    <SelectTrigger id="branch-select-trigger-rooms"><SelectValue placeholder={isLoadingBranches ? "Loading branches..." : (branches.length === 0 ? "No branches available" : "Select a branch")} /></SelectTrigger>
                    <SelectContent>{branches.map(branch => (<SelectItem key={branch.id} value={branch.id.toString()}>{branch.branch_name}</SelectItem>))}</SelectContent>
                </Select>
            </div>
            <Dialog
                key={isEditing ? `edit-room-${selectedRoom?.id}` : 'add-room'}
                open={isAddDialogOpen || isEditDialogOpen}
                onOpenChange={(open) => {
                    if (!open) { setIsAddDialogOpen(false); setIsEditDialogOpen(false); setSelectedRoom(null); form.reset({ ...defaultFormValuesCreate, hotel_rate_ids: [], status: HOTEL_ENTITY_STATUS.ACTIVE, is_available: ROOM_AVAILABILITY_STATUS.AVAILABLE, cleaning_status: ROOM_CLEANING_STATUS.CLEAN }); }
                }}>
              <DialogTrigger asChild>
                <Button onClick={() => { setSelectedRoom(null); form.reset({ ...defaultFormValuesCreate, hotel_rate_ids: [], status: HOTEL_ENTITY_STATUS.ACTIVE, is_available: ROOM_AVAILABILITY_STATUS.AVAILABLE, cleaning_status: ROOM_CLEANING_STATUS.CLEAN }); setIsAddDialogOpen(true); }} disabled={!selectedBranchId || isLoadingData || availableRates.length === 0} title={availableRates.length === 0 && selectedBranchId ? "No rates available for this branch. Add rates first." : ""}>
                  <PlusCircle className="mr-2 h-4 w-4" /> Add Room
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg p-3 flex flex-col max-h-[85vh]">
                <DialogHeader><DialogTitle>{isEditing ? `Edit Room: ${selectedRoom?.room_name}` : 'Add New Room'}</DialogTitle></DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(isEditing ? (d => handleEditSubmit(d as HotelRoomUpdateData)) : (d => handleAddSubmit(d as HotelRoomCreateData)))} className="bg-card rounded-md flex flex-col flex-grow overflow-hidden">
                    <div className="flex-grow space-y-3 p-1 overflow-y-auto">{renderFormFields()}</div>
                    <DialogFooter className="bg-card py-2 border-t px-3 sticky bottom-0 z-10">
                      <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                      <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : (isEditing ? "Save Changes" : "Create Room")}</Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
        </div>

        {selectedBranchId && isLoadingData && <div className="flex justify-center items-center h-32"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2 text-muted-foreground">Loading room data...</p></div>}
        
        {selectedBranchId && !isLoadingData && (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-4"><TabsTrigger value="active">Active</TabsTrigger><TabsTrigger value="archive">Archive</TabsTrigger></TabsList>
            <TabsContent value="active">
              {filteredRooms.length === 0 && <p className="text-muted-foreground text-center py-8">No active rooms found for this branch.</p>}
              {filteredRooms.length > 0 && (
                <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Code</TableHead><TableHead>Rates</TableHead><TableHead>Floor</TableHead><TableHead>Availability</TableHead><TableHead>Cleaning</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                  <TableBody>{filteredRooms.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.room_name}</TableCell><TableCell>{r.room_code}</TableCell><TableCell className="max-w-xs truncate" title={getRateNames(r.hotel_rate_id)}>{getRateNames(r.hotel_rate_id)}</TableCell><TableCell>{r.floor ?? '-'}</TableCell>
                      <TableCell>{ROOM_AVAILABILITY_STATUS_TEXT[r.is_available as keyof typeof ROOM_AVAILABILITY_STATUS_TEXT] || 'Unknown'}</TableCell>
                      <TableCell>{ROOM_CLEANING_STATUS_TEXT[r.cleaning_status as keyof typeof ROOM_CLEANING_STATUS_TEXT || ROOM_CLEANING_STATUS.CLEAN] || 'N/A'}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button variant="outline" size="sm" onClick={() => { setSelectedRoom(r); setIsEditDialogOpen(true); setIsAddDialogOpen(false); }}><Edit className="mr-1 h-3 w-3" /> Edit</Button>
                        <AlertDialog><AlertDialogTrigger asChild><Button variant="destructive" size="sm" disabled={isSubmitting}><Trash2 className="mr-1 h-3 w-3" /> Archive</Button></AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>Confirm Archive</AlertDialogTitle><AlertDialogDescription>Are you sure you want to archive room "{r.room_name}"?</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleArchive(r)} disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : "Archive"}</AlertDialogAction></AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>))}
                  </TableBody>
                </Table>)}
            </TabsContent>
             <TabsContent value="archive">
              {filteredRooms.length === 0 && <p className="text-muted-foreground text-center py-8">No archived rooms found for this branch.</p>}
              {filteredRooms.length > 0 && (
                <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Code</TableHead><TableHead>Rates</TableHead><TableHead>Cleaning</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                  <TableBody>{filteredRooms.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.room_name}</TableCell><TableCell>{r.room_code}</TableCell><TableCell className="max-w-xs truncate" title={getRateNames(r.hotel_rate_id)}>{getRateNames(r.hotel_rate_id)}</TableCell>
                      <TableCell>{ROOM_CLEANING_STATUS_TEXT[r.cleaning_status as keyof typeof ROOM_CLEANING_STATUS_TEXT || ROOM_CLEANING_STATUS.CLEAN] || 'N/A'}</TableCell>
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
             <div className="text-center py-10 text-muted-foreground">
                <Building className="h-12 w-12 mx-auto mb-3 opacity-50" />
                Please select a branch to manage its rooms.
            </div>
        )}
         {!isLoadingBranches && branches.length === 0 && (
             <div className="text-center py-10 text-muted-foreground">
                <Building className="h-12 w-12 mx-auto mb-3 opacity-50" />
                No branches available for this tenant. Please add a branch first to manage rooms.
            </div>
        )}
      </CardContent>
    </Card>
  );
}
