"use client";

import React, { useEffect, useState, useMemo } from 'react';
import { listTickets, createTicket, getTicketById } from '@/actions/sysad/tickets/list-tickets';
import { ColumnDef } from "@tanstack/react-table";
import { Ticket, UserRole } from "@/lib/types";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import TicketDetailPanel from './tickets/ticket-details';
import { RefreshCw } from "lucide-react"; // icon for refresh

interface TicketsManagementProps {
  sysAdUserId: number | null;
}

export default function TicketsManagement({ sysAdUserId }: TicketsManagementProps) {
    // Get user details from localStorage
    const storedRole = typeof window !== "undefined" ? (localStorage.getItem('userRole') as UserRole | null) : null;
    const storedTenantId = typeof window !== "undefined" ? localStorage.getItem('userTenantId') : null;
    const storedTenantName = typeof window !== "undefined" ? localStorage.getItem('userTenantName') : null;
    const storedUsername = typeof window !== "undefined" ? localStorage.getItem('username') : null;
    const storedFirstName = typeof window !== "undefined" ? localStorage.getItem('userFirstName') : null;
    const storedLastName = typeof window !== "undefined" ? localStorage.getItem('userLastName') : null;
    const storedUserId = typeof window !== "undefined" ? localStorage.getItem('userId') : null;
    const storedBranchId = localStorage.getItem('userTenantBranchId');
    const storedBranchName = localStorage.getItem('userBranchName');

  const ticketColumns: ColumnDef<Ticket>[] = [
    // { accessorKey: "ticket_id", header: "ID" },
    { accessorKey: "ticket_code", header: "Tx #" },
    { accessorKey: "subject", header: "Subject" },
    { accessorKey: "status", header: "Status" },
    { accessorKey: "priority", header: "Priority" },
    { accessorKey: "created_at", header: "Created" },
    // {
    //   id: "actions",
    //   header: "Actions",
    //   cell: ({ row }) => (
    //     <Button size="sm" variant="outline" onClick={() => handleViewTicket(row.original.ticket_id)}>
    //       View
    //     </Button>
    //   ),
    // },
  ];

  function TicketsTable({ tickets, selectedTicketId }: { tickets: Ticket[], selectedTicketId?: number }) {
  return (
    <DataTable
      columns={ticketColumns}
      data={tickets}
      rowClassName={row =>
        row.original.ticket_id === selectedTicketId
          ? "bg-green-300" // or any highlight class you want
          : ""
      }
      onRowClick={row => handleViewTicket(row.original.ticket_id)}
    />
  );
}

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [statusFilter, setStatusFilter] = useState<string[]>(["Open", "In Progress"]);

  useEffect(() => {
    listTickets().then(setTickets);
  }, []);

  // Dummy createTicket handler (replace with your real action)
  async function handleCreateTicket(e: React.FormEvent) {
    e.preventDefault();

    // Use values from localStorage, fallback to defaults if needed
    const tenant_id = storedTenantId && !isNaN(Number(storedTenantId)) ? Number(storedTenantId) : 0;
    const branch_id = storedBranchId && !isNaN(Number(storedBranchId)) ? Number(storedBranchId) : 0;
    const user_id = storedUserId && !isNaN(Number(storedUserId)) ? Number(storedUserId) : (typeof sysAdUserId === "number" ? sysAdUserId : 0);
    const author = `${storedFirstName || "System"} ${storedLastName || "Administrator"}`;

    await createTicket({
        tenant_id,
        branch_id,
        user_id,
        subject,
        description,
        status: "Open",
        priority: "Normal",
        assigned_agent_id: null,
        author
    });

    setIsDialogOpen(false);
    setSubject("");
    setDescription("");
    listTickets().then(setTickets);
  }

  // Fetch ticket details when selected
  async function handleViewTicket(ticketId: number) {
    const ticket = await getTicketById(ticketId);
    setSelectedTicket(ticket);
  }

  // Refresh selected ticket details
  async function refreshSelectedTicket(ticketId: number) {
    const updated = await getTicketById(ticketId);
    setSelectedTicket(updated);
    // Refresh the tickets table as well
    const allTickets = await listTickets();
    setTickets(allTickets);
  }

  // Filter tickets by status and role
  const filteredTickets = tickets.filter(ticket => {
    // If staff or housekeeping, show only tickets authored by this user
    if (storedRole === "staff" || storedRole === "housekeeping") {
      return ticket.user_id === Number(storedUserId) && (statusFilter.length === 0 ? true : statusFilter.includes(ticket.status));
    }
    // If admin, show tickets in the same tenant
    if (storedRole === "admin") {
      return (
        ticket.tenant_id === Number(storedTenantId) &&
        (statusFilter.length === 0 ? true : statusFilter.includes(ticket.status))
      );
    }
    // Otherwise, show all tickets matching the status filter
    return statusFilter.length === 0 ? true : statusFilter.includes(ticket.status);
  });

  const memoTicket = useMemo(() => selectedTicket, [selectedTicket]);

  // Add a refresh handler
  const handleRefreshTickets = async () => {
    const allTickets = await listTickets();
    setTickets(allTickets);
    // Optionally, refresh selected ticket if one is open
    if (selectedTicket) {
      const updated = await getTicketById(selectedTicket.ticket_id);
      setSelectedTicket(updated);
    }
  };

  return (
    <div className="flex gap-6">
      <div className="flex-1">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-semibold">Ticket Management</h2>
          <Button
            variant="outline"
            className="flex items-center gap-2"
            onClick={handleRefreshTickets}
            title="Refresh tickets"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
        </div>
        {/* Status Filter Dropdown */}
       
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <Button className="mb-4" onClick={() => setIsDialogOpen(true)}>
            Add Ticket
          </Button>
           <div className="mb-4 flex items-center gap-2">
                <label className="font-medium">Status:</label>
                {["Open", "In Progress", "Resolved", "Cancelled"].map(status => (
                    <label key={status} className="flex items-center gap-1 text-sm">
                    <input
                        type="checkbox"
                        checked={statusFilter.includes(status)}
                        onChange={e => {
                        if (e.target.checked) {
                            setStatusFilter(prev => [...prev, status]);
                        } else {
                            setStatusFilter(prev => prev.filter(s => s !== status));
                        }
                        }}
                    />
                    {status}
                </label>
                ))}
                <button
                    className="ml-2 px-2 py-1 border rounded text-xs"
                    onClick={() => setStatusFilter(["Open", "In Progress"])}
                    type="button"
                >
                    Reset
                </button>
                </div>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Ticket</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreateTicket}>
              <div className="mb-2">
                <Input
                  placeholder="Subject"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  required
                />
              </div>
              <div className="mb-2">
                <Textarea
                  placeholder="Description"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  required
                />
              </div>
              <DialogFooter>
                <Button type="submit">Create</Button>
                <DialogClose asChild>
                  <Button type="button" variant="outline">Cancel</Button>
                </DialogClose>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <TicketsTable tickets={filteredTickets} selectedTicketId={selectedTicket?.ticket_id} />
      </div>
      {/* Ticket Details Panel */}
      {selectedTicket && (
        <TicketDetailPanel
          ticket={selectedTicket}
          onClose={() => setSelectedTicket(null)}
          onRefresh={() => refreshSelectedTicket(selectedTicket.ticket_id)}
        />
      )}
    </div>
  );

}