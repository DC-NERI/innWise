import React, { useEffect, useState } from "react";
import { updateTicket } from "@/actions/sysad/tickets/list-tickets";
import { UserRole } from "@/lib/types"; // Make sure this import exists
import { listAllUsers } from "@/actions/admin/users/listAllUsers";
import { useToast } from '@/hooks/use-toast';

type Comment = {
  name: any;
  comment: string;
  user_id: number;
  created_at: string;
};

type Ticket = {
  tenant_id: number | null | undefined;
  user_id: number;
  assigned_agent_id: string;
  ticket_id: number;
  ticket_code?: string;
  subject: string;
  author: string;
  status: string;
  priority: string;
  description: string;
  created_at: string;
  updated_at: string;
  comments: Comment[];
};

interface TicketDetailProps {
  ticket: Ticket;
  onClose: () => void;
  onRefresh: () => void; // <-- add this
}

function formatDateTime(dateString: string) {
  const date = new Date(dateString);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// Use this function to get the current time in Asia/Manila as YYYY-MM-DD HH:mm:ss
function getManilaDateTime() {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Manila", hour12: false }).replace("T", " ");
}

export default function TicketDetailPanel({ ticket, onClose, onRefresh }: TicketDetailProps) {
  const [status, setStatus] = useState(ticket.status);
  const [priority, setPriority] = useState(ticket.priority);
  const [comment, setComment] = useState("");
  const [comments, setComments] = useState<Comment[]>(ticket.comments || []);
  const [assignedTo, setAssignedTo] = useState(ticket.assigned_agent_id ?? "");

  const { toast } = useToast();

  // Sync comments state with ticket.comments when ticket changes
  useEffect(() => {
    setComments(ticket.comments || []);
    setStatus(ticket.status);
    setPriority(ticket.priority);
    setComment("");
  }, [ticket]);

  useEffect(() => {
    setAssignedTo(ticket.assigned_agent_id ?? "");
  }, [ticket.assigned_agent_id]);

  // Get user role from localStorage
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  useEffect(() => {
    if (typeof window !== "undefined") {
      setUserRole(localStorage.getItem("userRole") as UserRole | null);
    }
  }, []);

  // Dummy list of users for assignment (replace with real data as needed)
  const [users, setUsers] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => {
    async function fetchAssignableUsers() {
      const allUsers = await listAllUsers();
      const filtered = allUsers.filter(
        user =>
          (["admin", "support"].includes(user.role) && user.tenant_id === ticket.tenant_id) ||
          user.id === ticket.user_id ||
          (["sysad"].includes(user.role)) ||
          (["support"].includes(user.role) && user.tenant_id === 0)
      );
      // Remove duplicates (in case author is also sysad/admin/support)
      const uniqueUsers = Array.from(new Map(filtered.map(u => [u.id, u])).values());
      setUsers(
        uniqueUsers.map(u => ({
          id: u.id,
          name: `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() || u.username || `User ${u.id}`,
        }))
      );
    }

    fetchAssignableUsers();
  }, [ticket.tenant_id, ticket.user_id]);


  function handleStatusChange(value: string): void {
    setStatus(value);
  }

  function handlePriorityChange(value: string): void {
    setPriority(value);
  }

  const isUnchanged =
    status === ticket.status &&
    priority === ticket.priority &&
    (assignedTo === (ticket.assigned_agent_id ?? "")) &&
    !comment.trim();

  const [isUpdating, setIsUpdating] = useState(false);

  if (!ticket) {
    return (
      <div className="w-full max-w-md bg-white border border-gray-300 rounded-lg shadow-md p-6 flex items-center justify-center min-h-[200px]">
        <span className="text-gray-500">Loading ticket details...</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full min-h-[88vh] max-w-md bg-white border border-gray-300 rounded-lg shadow-md p-4 flex flex-col">
      <div className="w-full flex justify-between items-center mb-4">
        <h4 className="text-m font-semibold break-words">
          SUBJECT : <span className=" text-gray-800">{ticket.subject}</span>
        </h4>
        <div
          onClick={e => {
            if (isUnchanged) {
              e.preventDefault();
              toast({
                title: "No changes detected",
                description: "No update will be made.",
                variant: "destructive",
              });
            }
          }}
        >
          <button
  className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-green-700 bg-gradient-to-r from-green-500 to-green-600 text-white font-semibold shadow-md hover:from-green-600 hover:to-green-700 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-green-400 focus:ring-offset-2 transition-all duration-150
    ${isUnchanged || isUpdating ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}
  `}
  onClick={async (e) => {
    if (isUnchanged) {
      return;
    }
    setIsUpdating(true);
    toast({
      title: "Updating...",
      description: "Please wait while the ticket is being updated.",
      variant: "default",
    });
    const firstName = typeof window !== "undefined" ? localStorage.getItem("userFirstName") : "";
    const lastName = typeof window !== "undefined" ? localStorage.getItem("userLastName") : "";
    const userId = typeof window !== "undefined" ? localStorage.getItem("userId") : "";

    const updatePayload: any = {
      status,
      priority,
      assigned_agent_id: assignedTo ? Number(assignedTo) : null,
    };

    let newComments = comments;
    if (comment.trim()) {
      const newComment = {
        comment,
        user_id: userId ? Number(userId) : 0,
        name: `${firstName || ""} ${lastName || ""}`.trim(),
        created_at: getManilaDateTime(),
      };
      newComments = [...comments, newComment];
      updatePayload.comments = JSON.stringify(newComments);
    }

    await updateTicket(ticket.ticket_id, updatePayload);

    if (comment.trim()) {
      setComments(newComments);
      setComment("");
    }
    if (onRefresh) {
      onRefresh();
    }
    setIsUpdating(false);
    toast({
      title: "Ticket updated!",
      description: "The ticket was updated successfully.",
      variant: "default",
    });
  }}
  type="button"
  disabled={isUnchanged || isUpdating}
>
  {isUpdating ? (
    <>
      <svg className="animate-spin h-5 w-5 mr-2 text-white" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
      Updating...
    </>
  ) : (
    <>
      <svg className="h-5 w-5 mr-2" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      Update
    </>
  )}
</button>
        </div>
      </div>

      {/* The rest of your panel */}
      <header className="flex justify-between items-start mb-4 border-b pb-3">
        <div className="flex-1">
          <p className="text-sm font-mono text-gray-500">Tx # : {ticket.ticket_code}</p>
          <p className="text-sm font-mono text-gray-500">Author : {ticket.author}</p>
          <p className="text-sm font-mono text-gray-500">
            <time dateTime={ticket.created_at}>Created: {formatDateTime(ticket.created_at)}</time>
          </p>
          <p className="text-sm font-mono text-gray-500">
            <time dateTime={ticket.updated_at}>Updated: {formatDateTime(ticket.updated_at)}</time>
          </p>
          {/* Assigned To dropdown, only for admin/sysad */}
          {(userRole === "admin" || userRole === "sysad") && (
            <div className="mt-2">
              <label htmlFor="assignedTo" className="block text-sm font-medium text-gray-700 mb-1">
                Assigned To
              </label>
                <select
                  id="assignedTo"
                  name="assignedTo"
                  className={`w-[90%] border rounded px-2 py-1 text-sm ${assignedTo === "" ? "text-gray-400" : "text-gray-800"}`}
                  value={assignedTo === "" ? "" : assignedTo}
                  onChange={e => setAssignedTo(e.target.value)}
                >
                  <option value="" className="text-gray-400">Select Assignee</option>
                  {users.map(user => (
                    <option key={user.id} value={user.id} className="text-gray-800">
                      {user.name}
                    </option>
                  ))}
                </select>
            </div>
          )}
        </div>
        <div className="flex flex-col space-y-2 items-end text-sm w-40">
          <div className="w-full">
            <label className="block font-medium text-gray-700 mb-1">Status</label>
            <select
              className="w-full border rounded px-2 py-1 text-sm text-gray-800"
              value={status}
              onChange={(e) => handleStatusChange(e.target.value)}
            >
              <option value="Open">Open</option>
              <option value="In Progress">In Progress</option>
              <option value="Resolved">Resolved</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>
          <div className="w-full">
            <label className="block font-medium text-gray-700 mb-1">Priority</label>
            <select
              className="w-full border rounded px-2 py-1 text-sm text-gray-800"
              value={priority}
              onChange={(e) => handlePriorityChange(e.target.value)}
            >
              <option value="Urgent">Urgent</option>
              <option value="High">High</option>
              <option value="Normal">Normal</option>
              <option value="Low">Low</option>
            </select>
          </div>
        </div>
      </header>

      <section className="space-y-3 text-gray-700">
        <div>
          <h4 className="font-semibold text-gray-800">Description</h4>
          <p className="whitespace-pre-line p-2 border text-sm">{ticket.description}</p>
        </div>
      </section>
        <section>
            {/* Add Comment always at the bottom */}
            <div className="mt-6">
                <label htmlFor="comment" className="block font-medium text-gray-700 mb-1">Add Comment</label>
                <textarea
                id="comment"
                name="comment"
                className="w-full border rounded px-2 py-1 text-sm text-gray-800 mb-2"
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="Enter your comment"
                rows={3}
                />
            </div>
        </section>
      {/* Comments section grows to fill available space */}
      <section className="flex-1 flex flex-col min-h-0 max-h-[43vh]">
        <h4 className="font-semibold text-gray-900 mb-2 border-b pb-1">Comments</h4>
        <ul className="flex-1 min-h-0 overflow-y-auto space-y-3 bg-gray-50 rounded border border-gray-200 p-3">
          {comments && comments.length > 0 ? (
            [...comments]
              .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
              .map((c, idx) => {
                // Get current user id from localStorage
                const myUserId = typeof window !== "undefined" ? Number(localStorage.getItem("userId")) : null;
                const isMe = c.user_id === myUserId;
                return (
                  <li
                    key={idx}
                    className={`
                      flex ${isMe ? "justify-end" : "justify-start"}
                    `}
                  >
                    <div
                      className={`
                        rounded p-2 shadow-sm max-w-[75%]
                        ${isMe ? "bg-blue-100 text-blue-900" : "bg-white text-gray-800"}
                        ${isMe ? "ml-auto" : "mr-auto"}
                      `}
                    >
                      {
                        isMe ? (
                          <span className="text-xs font-semibold text-blue-700">You</span>
                        ) : (
                          <span className="flex items-center gap-2 text-xs font-semibold text-gray-700">
                            {c.name ? c.name : <>User <span className="font-semibold">{c.user_id}</span></>}
                            <span className="text-gray-400 font-normal">
                              <time dateTime={c.created_at}>{formatDateTime(c.created_at)}</time>
                            </span>
                          </span>
                        )
                      }
                      {/* <p className="mt-1 text-xs text-gray-500">
                        By {c.name ? c.name : <>User <span className="font-semibold">{c.user_id}</span></>} at{" "}
                        <time dateTime={c.created_at}>{formatDateTime(c.created_at)}</time>
                      </p> */}
                      <p className="text-gray-800">{c.comment}</p>
                    </div>
                  </li>
                );
              })
          ) : (
            <li className="text-gray-500 italic">No comments yet.</li>
          )}
        </ul>
      </section>
    </div>
  );
}