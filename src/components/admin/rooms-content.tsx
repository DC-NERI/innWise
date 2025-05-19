
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FormLabel, FormControl, FormItem } from '@/components/ui/form'; // For FormItem structure
import { useToast } from '@/hooks/use-toast';
import { Loader2, BedDouble, Building } from 'lucide-react';
import type { SimpleBranch, HotelRoom, SimpleRate } from '@/lib/types'; // HotelRoom and SimpleRate might be needed later
import { getBranchesForTenantSimple, listRoomsForBranch, getRatesForBranchSimple } from '@/actions/admin'; // Placeholders for now

interface RoomsContentProps {
  tenantId: number;
}

export default function RoomsContent({ tenantId }: RoomsContentProps) {
  const [branches, setBranches] = useState<SimpleBranch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(null);
  const [rooms, setRooms] = useState<HotelRoom[]>([]); // To be used later
  const [availableRates, setAvailableRates] = useState<SimpleRate[]>([]); // For room form
  const [isLoadingBranches, setIsLoadingBranches] = useState(true);
  const [isLoadingRooms, setIsLoadingRooms] = useState(false); // To be used later
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

  // Placeholder: Fetch rooms when a branch is selected
  const fetchRoomsAndRatesForBranch = useCallback(async (branchId: number) => {
    if (!tenantId) return;
    setIsLoadingRooms(true);
    try {
      // const fetchedRooms = await listRoomsForBranch(branchId, tenantId);
      // setRooms(fetchedRooms);
      // const fetchedRates = await getRatesForBranchSimple(branchId, tenantId);
      // setAvailableRates(fetchedRates);
      toast({ title: "Info", description: "Room management is not fully implemented yet."});
      setRooms([]); // Placeholder
      setAvailableRates([]); // Placeholder
    } catch (error) {
      toast({ title: "Error", description: "Could not fetch room data.", variant: "destructive" });
      setRooms([]);
      setAvailableRates([]);
    } finally {
      setIsLoadingRooms(false);
    }
  }, [tenantId, toast]);

  useEffect(() => {
    if (selectedBranchId) {
      fetchRoomsAndBranchRatesForBranch(selectedBranchId);
    } else {
      setRooms([]);
      setAvailableRates([]);
    }
  }, [selectedBranchId, fetchRoomsAndRatesForBranch]);


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
        <FormItem className="w-full md:w-1/3">
            <FormLabel>Select Branch</FormLabel>
            <Select 
                onValueChange={(value) => setSelectedBranchId(value ? parseInt(value) : null)}
                value={selectedBranchId?.toString()}
                disabled={isLoadingBranches || branches.length === 0}
            >
                <FormControl>
                    <SelectTrigger>
                        <SelectValue placeholder={isLoadingBranches ? "Loading branches..." : (branches.length === 0 ? "No branches available" : "Select a branch")} />
                    </SelectTrigger>
                </FormControl>
                <SelectContent>
                    {branches.map(branch => (
                        <SelectItem key={branch.id} value={branch.id.toString()}>{branch.branch_name}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </FormItem>

        {selectedBranchId && isLoadingRooms && (
          <div className="flex justify-center items-center h-32">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-2 text-muted-foreground">Loading rooms...</p>
          </div>
        )}

        {selectedBranchId && !isLoadingRooms && (
          <div className="mt-4">
            <p className="text-muted-foreground">Room listing and management for branch "{branches.find(b => b.id === selectedBranchId)?.branch_name}" will appear here.</p>
            {/* Placeholder for Add Room button and Table */}
            {/* 
            <Button disabled>Add Room (Coming Soon)</Button>
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

// Helper function name corrected
async function fetchRoomsAndBranchRatesForBranch(branchId: number) {
    // This function would call listRoomsForBranch and getRatesForBranchSimple
    console.log("Fetching rooms and rates for branch: ", branchId);
}
