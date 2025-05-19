
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from "@/components/ui/label"; // Import base Label
import { Button } from '@/components/ui/button'; // Added import for Button
import { useToast } from '@/hooks/use-toast';
import { Loader2, BedDouble, Building } from 'lucide-react';
import type { SimpleBranch, HotelRoom, SimpleRate } from '@/lib/types';
import { getBranchesForTenantSimple, listRoomsForBranch, getRatesForBranchSimple } from '@/actions/admin';

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
  const { toast } = useToast();

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

  const fetchRoomsAndBranchRatesForBranch = useCallback(async (branchId: number) => {
    if (!tenantId) return;
    setIsLoadingData(true);
    try {
      const [fetchedRooms, fetchedRates] = await Promise.all([
        listRoomsForBranch(branchId, tenantId),
        getRatesForBranchSimple(branchId, tenantId)
      ]);
      setRooms(fetchedRooms);
      setAvailableRates(fetchedRates);
      if (fetchedRooms.length === 0 && fetchedRates.length === 0 && process.env.NODE_ENV === 'development') {
        // Only show placeholder toast in dev if actual calls are made and return empty
        // For now, listRoomsForBranch is a placeholder.
        // toast({ title: "Info", description: "Room management is not fully implemented yet."});
      }
    } catch (error) {
      console.error("Error fetching room/rate data:", error);
      toast({ title: "Error", description: "Could not fetch room and rate data.", variant: "destructive" });
      setRooms([]);
      setAvailableRates([]);
    } finally {
      setIsLoadingData(false);
    }
  }, [tenantId, toast]);

  useEffect(() => {
    if (selectedBranchId) {
      fetchRoomsAndBranchRatesForBranch(selectedBranchId);
    } else {
      setRooms([]);
      setAvailableRates([]);
    }
  }, [selectedBranchId, fetchRoomsAndBranchRatesForBranch]);


  return (
    <Card>
      <CardHeader>
        <div className="flex items-center space-x-2">
          <BedDouble className="h-6 w-6 text-primary" />
          <CardTitle>Hotel Rooms Management</CardTitle>
        </div>
        <CardDescription>Manage hotel rooms for a selected branch. (Feature in development)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="w-full md:w-1/3 space-y-2">
            <Label htmlFor="branch-select-trigger-rooms">Select Branch</Label>
            <Select 
                onValueChange={(value) => setSelectedBranchId(value ? parseInt(value) : null)}
                value={selectedBranchId?.toString()}
                disabled={isLoadingBranches || branches.length === 0}
            >
                <SelectTrigger id="branch-select-trigger-rooms">
                    <SelectValue placeholder={isLoadingBranches ? "Loading branches..." : (branches.length === 0 ? "No branches available" : "Select a branch")} />
                </SelectTrigger>
                <SelectContent>
                    {branches.map(branch => (
                        <SelectItem key={branch.id} value={branch.id.toString()}>{branch.branch_name}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>

        {selectedBranchId && isLoadingData && (
          <div className="flex justify-center items-center h-32">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-2 text-muted-foreground">Loading room data...</p>
          </div>
        )}

        {selectedBranchId && !isLoadingData && (
          <div className="mt-4">
            <p className="text-muted-foreground">Room listing and management for branch "{branches.find(b => b.id === selectedBranchId)?.branch_name}" will appear here.</p>
            {/* Placeholder for Add Room button and Table */}
             <Button disabled className="mt-4">Add Room (Coming Soon)</Button>
            {rooms.length === 0 && <p className="text-muted-foreground mt-4">No rooms found for this branch yet.</p>}
            {/* 
            <Table>...</Table>
            */}
          </div>
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

// Helper function name corrected, but the actual implementation is above in fetchRoomsAndBranchRatesForBranch
// async function fetchRoomsAndBranchRatesForBranch(branchId: number) {
//     // This function would call listRoomsForBranch and getRatesForBranchSimple
//     console.log("Fetching rooms and rates for branch: ", branchId);
// }

