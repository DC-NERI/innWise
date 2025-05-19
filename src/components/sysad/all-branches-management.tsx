
"use client";

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { Loader2, PlusCircle, Network } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { branchCreateSchema, BranchCreateData } from '@/lib/schemas';
import type { Branch, Tenant } from '@/lib/types';
import { createBranchForTenant, listAllBranches, listTenants } from '@/actions/admin';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';


export default function AllBranchesManagement() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { toast } = useToast();

  const form = useForm<BranchCreateData>({
    resolver: zodResolver(branchCreateSchema),
    defaultValues: {
      tenant_id: undefined,
      branch_name: '',
      branch_code: '',
      branch_address: '',
      contact_number: '',
      email_address: '',
    },
  });

  async function fetchData() {
    setIsLoading(true);
    try {
      const [fetchedBranches, fetchedTenants] = await Promise.all([
        listAllBranches(),
        listTenants() 
      ]);
      setBranches(fetchedBranches);
      setTenants(fetchedTenants);
    } catch (error) {
      console.error("Failed to fetch branches or tenants:", error);
      toast({
        title: "Error",
        description: "Could not fetch data. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, [toast]); // Removed fetchData from dependency array

  const onSubmit = async (data: BranchCreateData) => {
    setIsSubmitting(true);
    const payload = {
      ...data,
      tenant_id: Number(data.tenant_id), 
    };
    try {
      const result = await createBranchForTenant(payload);
      if (result.success && result.branch) {
        toast({
          title: "Success",
          description: "Branch created successfully.",
        });
        form.reset();
        setIsDialogOpen(false);
        fetchData(); 
      } else {
        toast({
          title: "Creation Failed",
          description: result.message || "Could not create branch.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Failed to create branch:", error);
      toast({
        title: "Error",
        description: "An unexpected error occurred. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">Loading branches and tenants...</p>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <Network className="h-6 w-6 text-primary" />
            <CardTitle>All Branches Management</CardTitle>
          </div>
          <CardDescription>View branches across all tenants and add new ones.</CardDescription>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => {form.reset(); setIsDialogOpen(true);}}>
              <PlusCircle className="mr-2 h-4 w-4" /> Add Branch
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Add New Branch</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                <FormField
                  control={form.control}
                  name="tenant_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tenant *</FormLabel>
                      <Select 
                        onValueChange={(value) => field.onChange(Number(value))} 
                        defaultValue={field.value?.toString()}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a tenant for this branch" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {tenants.map(tenant => (
                            <SelectItem key={tenant.id} value={tenant.id.toString()}>
                              {tenant.tenant_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="branch_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Branch Name *</FormLabel>
                      <FormControl><Input placeholder="Downtown Branch" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="branch_code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Branch Code *</FormLabel>
                      <FormControl><Input placeholder="DTOWN01" {...field} /></FormControl>
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
                      <FormControl><Textarea placeholder="456 Branch Ave, City" {...field} value={field.value ?? ''} /></FormControl>
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
                      <FormControl><Input placeholder="+1-555-0200" {...field} value={field.value ?? ''} /></FormControl>
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
                      <FormControl><Input type="email" placeholder="branch@tenant.com" {...field} value={field.value ?? ''} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <DialogClose asChild>
                     <Button type="button" variant="outline" onClick={() => {form.reset(); setIsDialogOpen(false);}}>Cancel</Button>
                  </DialogClose>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? <Loader2 className="animate-spin" /> : "Create Branch"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
         {branches.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No branches found. Add one to get started!</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Branch Name</TableHead>
                <TableHead>Branch Code</TableHead>
                <TableHead>Tenant</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {branches.map(branch => (
                <TableRow key={branch.id}>
                  <TableCell className="font-medium">{branch.branch_name}</TableCell>
                  <TableCell>{branch.branch_code}</TableCell>
                  <TableCell>{branch.tenant_name || 'N/A'}</TableCell>
                  <TableCell>{branch.email_address || '-'}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" disabled>Edit</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
