
"use client";

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getBranchesForTenant, updateBranchDetails } from '@/actions/admin';
import type { Branch } from '@/lib/types';
import { branchUpdateSchema } from '@/lib/schemas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Edit3, Building, Save } from 'lucide-react';

type BranchUpdateFormValues = z.infer<typeof branchUpdateSchema>;

interface BranchesContentProps {
  tenantId: number;
}

export default function BranchesContent({ tenantId }: BranchesContentProps) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const { toast } = useToast();

  const form = useForm<BranchUpdateFormValues>({
    resolver: zodResolver(branchUpdateSchema),
    defaultValues: {
      branch_name: '',
      branch_code: '',
      branch_address: '',
      contact_number: '',
      email_address: '',
    },
  });

  useEffect(() => {
    async function fetchBranches() {
      setIsLoading(true);
      try {
        const fetchedBranches = await getBranchesForTenant(tenantId);
        setBranches(fetchedBranches);
      } catch (error) {
        toast({
          title: "Error",
          description: "Could not fetch branches. Please try again.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    }
    if (tenantId) {
      fetchBranches();
    }
  }, [tenantId, toast]);

  useEffect(() => {
    if (selectedBranch) {
      form.reset({
        branch_name: selectedBranch.branch_name,
        branch_code: selectedBranch.branch_code,
        branch_address: selectedBranch.branch_address || '',
        contact_number: selectedBranch.contact_number || '',
        email_address: selectedBranch.email_address || '',
      });
    }
  }, [selectedBranch, form]);

  const handleEdit = (branch: Branch) => {
    setSelectedBranch(branch);
  };

  const onSubmit = async (data: BranchUpdateFormValues) => {
    if (!selectedBranch) return;
    setIsUpdating(true);
    try {
      const result = await updateBranchDetails(selectedBranch.id, data);
      if (result.success && result.updatedBranch) {
        setBranches(branches.map(b => b.id === result.updatedBranch!.id ? result.updatedBranch! : b));
        setSelectedBranch(result.updatedBranch); 
        toast({
          title: "Success",
          description: "Branch details updated successfully.",
        });
      } else {
        toast({
          title: "Update Failed",
          description: result.message || "Could not update branch details.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "An unexpected error occurred. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">Loading branches...</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Card className="md:col-span-1">
        <CardHeader>
          <div className="flex items-center space-x-2">
            <Building className="h-6 w-6 text-primary" />
            <CardTitle>Branches</CardTitle>
          </div>
          <CardDescription>Select a branch to view or edit details.</CardDescription>
        </CardHeader>
        <CardContent>
          {branches.length === 0 ? (
            <p className="text-muted-foreground">No branches found for this tenant.</p>
          ) : (
            <ul className="space-y-2">
              {branches.map(branch => (
                <li key={branch.id}>
                  <Button
                    variant={selectedBranch?.id === branch.id ? "secondary" : "ghost"}
                    className="w-full justify-start"
                    onClick={() => handleEdit(branch)}
                  >
                    {branch.branch_name} ({branch.branch_code})
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {selectedBranch && (
        <Card className="md:col-span-2">
          <CardHeader>
             <div className="flex items-center space-x-2">
              <Edit3 className="h-6 w-6 text-primary" />
              <CardTitle>Edit Branch: {selectedBranch.branch_name}</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="branch_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Branch Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Main Branch" {...field} className="w-[90%]" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="branch_code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Branch Code</FormLabel>
                      <FormControl>
                        <Input placeholder="BRANCH-001" {...field} className="w-[90%]" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="branch_address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Branch Address</FormLabel>
                      <FormControl>
                        <Textarea placeholder="123 Hotel St, City" {...field} className="w-[90%]" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="contact_number"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Number</FormLabel>
                      <FormControl>
                        <Input placeholder="+1-555-1234" {...field} className="w-[90%]" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email_address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Address</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="branch@example.com" {...field} className="w-[90%]" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" disabled={isUpdating} className="w-full">
                  {isUpdating ? <Loader2 className="animate-spin" /> : <><Save className="mr-2 h-4 w-4" /> Update Branch</>}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      )}
       {!selectedBranch && branches.length > 0 && (
        <Card className="md:col-span-2 flex flex-col items-center justify-center h-full">
          <CardContent className="text-center">
            <Building className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Select a branch from the list to view and edit its details.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
