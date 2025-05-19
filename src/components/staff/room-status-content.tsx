
"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BedDouble, Loader2 } from "lucide-react";
import type { HotelRoom } from '@/lib/types';
import { listRoomsForBranch } from '@/actions/admin'; // Assuming this action fetches all relevant room details
import { useToast } from '@/hooks/use-toast';

interface RoomStatusContentProps {
  tenantId: number;
  branchId: number;
}

interface GroupedRooms {
  [floor: string]: HotelRoom[];
}

export default function RoomStatusContent({ tenantId, branchId }: RoomStatusContentProps) {
  const [rooms, setRooms] = useState<HotelRoom[]>([]);
  const [groupedRooms, setGroupedRooms] = useState<GroupedRooms>({});
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    async function fetchRoomsData() {
      if (!tenantId || !branchId) {
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      try {
        const fetchedRooms = await listRoomsForBranch(branchId, tenantId);
        const activeRooms = fetchedRooms.filter(room => room.status === '1');
        setRooms(activeRooms);

        const grouped = activeRooms.reduce((acc, room) => {
          const floorKey = room.floor?.toString() ?? 'Ground Floor / Other';
          if (!acc[floorKey]) {
            acc[floorKey] = [];
          }
          // Sort rooms within each floor by room_name or room_code
          acc[floorKey].push(room);
          acc[floorKey].sort((a, b) => (a.room_name || a.room_code).localeCompare(b.room_name || b.room_code));
          return acc;
        }, {} as GroupedRooms);
        
        // Sort floors (keys of the grouped object)
        const sortedFloors = Object.keys(grouped).sort((a, b) => {
            const numA = parseInt(a);
            const numB = parseInt(b);
            if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
            if (!isNaN(numA)) return -1; // Numbers first
            if (!isNaN(numB)) return 1;
            return a.localeCompare(b); // Then strings like "Ground Floor"
        });

        const sortedGroupedRooms: GroupedRooms = {};
        for (const floor of sortedFloors) {
            sortedGroupedRooms[floor] = grouped[floor];
        }
        setGroupedRooms(sortedGroupedRooms);

      } catch (error) {
        console.error("Failed to fetch rooms:", error);
        toast({
          title: "Error",
          description: "Could not fetch room statuses. Please try again.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    }

    fetchRoomsData();
  }, [tenantId, branchId, toast]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">Loading room statuses...</p>
      </div>
    );
  }

  if (!branchId) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <BedDouble className="h-6 w-6 text-primary" />
            <CardTitle>Room Status</CardTitle>
          </div>
          <CardDescription>View current room availability.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">No branch assigned or selected. Please ensure your staff account is assigned to a branch.</p>
        </CardContent>
      </Card>
    );
  }

  if (rooms.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <BedDouble className="h-6 w-6 text-primary" />
            <CardTitle>Room Status</CardTitle>
          </div>
          <CardDescription>View current room availability.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">No active rooms found for this branch.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {Object.entries(groupedRooms).map(([floor, floorRooms]) => (
        <div key={floor}>
          <h2 className="text-xl font-semibold mb-3 pb-2 border-b">
            Floor: {floor.replace('Ground Floor / Other', 'Ground Floor / Unspecified')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {floorRooms.map(room => (
              <Card key={room.id} className="shadow-md hover:shadow-lg transition-shadow duration-200">
                <CardHeader className="p-4">
                  <CardTitle className="text-lg truncate" title={room.room_name}>{room.room_name}</CardTitle>
                  <CardDescription className="text-xs">{room.room_code}</CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="flex items-center space-x-2">
                    <span className={`h-3 w-3 rounded-full ${room.is_available ? 'bg-green-500' : 'bg-red-500'}`}></span>
                    <span className={`text-sm font-medium ${room.is_available ? 'text-green-600' : 'text-red-600'}`}>
                      {room.is_available ? 'Available' : 'Occupied'}
                    </span>
                  </div>
                  {room.room_type && <p className="text-xs text-muted-foreground mt-1">Type: {room.room_type}</p>}
                  {room.bed_type && <p className="text-xs text-muted-foreground">Bed: {room.bed_type}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
