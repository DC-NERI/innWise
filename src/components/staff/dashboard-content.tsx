
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription as ShadCardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Bell, Bed, Users as UserIcon, CalendarClock, CheckCircle2, Wrench, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Notification, HotelRoom, Transaction } from '@/lib/types';
import { listNotificationsForBranch } from '@/actions/staff/notifications/listNotificationsForBranch';
import { listUnassignedReservations } from '@/actions/staff/reservations/listUnassignedReservations';
import { listRoomsForBranch } from '@/actions/admin/rooms/listRoomsForBranch';
import {
    NOTIFICATION_STATUS, NOTIFICATION_STATUS_TEXT,
    TRANSACTION_IS_ACCEPTED_STATUS, TRANSACTION_IS_ACCEPTED_STATUS_TEXT,
    TRANSACTION_LIFECYCLE_STATUS, TRANSACTION_LIFECYCLE_STATUS_TEXT,
    ROOM_AVAILABILITY_STATUS, ROOM_AVAILABILITY_STATUS_TEXT,
    ROOM_CLEANING_STATUS_TEXT, ROOM_CLEANING_STATUS, HOTEL_ENTITY_STATUS
} from '@/lib/constants';
import { format, parseISO, isToday, isFuture, addHours } from 'date-fns';
import { cn } from '@/lib/utils';

interface DashboardContentProps {
  tenantId: number | null;
  branchId: number | null;
  staffUserId: number | null;
}

const NotificationTable = ({ notifications }: { notifications: Notification[] }) => {
  if (!notifications || notifications.length === 0) {
    return <p className="text-muted-foreground text-center py-4">No notifications in this category.</p>;
  }
  return (
    <div className="max-h-72 overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[30%]">Message</TableHead>
            <TableHead>Creator</TableHead>
            <TableHead>Notif Status</TableHead>
            <TableHead>Linked Tx Status</TableHead>
            <TableHead>Acceptance</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {notifications.map(notif => (
            <TableRow key={notif.id} className={cn(notif.status === NOTIFICATION_STATUS.UNREAD && (!notif.transaction_id || (notif.transaction_is_accepted !== null && notif.transaction_is_accepted !== TRANSACTION_IS_ACCEPTED_STATUS.PENDING)) ? "bg-primary/5 dark:bg-primary/10 font-medium" : "")}>
              <TableCell className="truncate max-w-[150px] sm:max-w-xs" title={notif.message}>{notif.message.substring(0, 50)}{notif.message.length > 50 ? '...' : ''}</TableCell>
              <TableCell>{notif.creator_username || 'System'}</TableCell>
              <TableCell>{NOTIFICATION_STATUS_TEXT[notif.status] || 'Unknown'}</TableCell>
              <TableCell>{notif.transaction_id && notif.transaction_status !== null ? (TRANSACTION_LIFECYCLE_STATUS_TEXT[Number(notif.transaction_status) as keyof typeof TRANSACTION_LIFECYCLE_STATUS_TEXT] || 'N/A') : 'N/A'}</TableCell>
              <TableCell>
                {notif.transaction_id && notif.transaction_is_accepted !== null && notif.transaction_is_accepted !== undefined
                  ? TRANSACTION_IS_ACCEPTED_STATUS_TEXT[notif.transaction_is_accepted as keyof typeof TRANSACTION_IS_ACCEPTED_STATUS_TEXT] ?? 'N/A'
                  : 'N/A'}
              </TableCell>
              <TableCell>{notif.created_at ? format(parseISO(notif.created_at.replace(' ', 'T')), 'yyyy-MM-dd hh:mm aa') : 'N/A'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

const ReservationListTable = ({ reservations, title }: { reservations: Transaction[], title: string }) => {
    if (!reservations || reservations.length === 0) {
        return <p className="text-muted-foreground text-center py-4">No {title.toLowerCase()}.</p>;
    }
    return (
        <div className="max-h-60 overflow-y-auto">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Client</TableHead>
                        <TableHead>Rate</TableHead>
                        <TableHead>Time</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {reservations.map(res => (
                        <TableRow key={`res-summary-${res.id}`}>
                            <TableCell className="font-medium">{res.client_name}</TableCell>
                            <TableCell>{res.rate_name || 'N/A'}</TableCell>
                            <TableCell>
                                {res.reserved_check_in_datetime
                                    ? format(parseISO(res.reserved_check_in_datetime.replace(' ', 'T')), 'yyyy-MM-dd hh:mm aa')
                                    : (res.created_at ? format(parseISO(res.created_at.replace(' ', 'T')), 'yyyy-MM-dd hh:mm aa') + " (Created)" : 'N/A')
                                }
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
};


export default function DashboardContent({ tenantId, branchId, staffUserId }: DashboardContentProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [rooms, setRooms] = useState<HotelRoom[]>([]);
  const [unassignedReservations, setUnassignedReservations] = useState<Transaction[]>([]);
  const [reservationsToday, setReservationsToday] = useState<Transaction[]>([]);
  const [reservationsUpcoming, setReservationsUpcoming] = useState<Transaction[]>([]);

  const [isLoadingNotifications, setIsLoadingNotifications] = useState(true);
  const [isLoadingRooms, setIsLoadingRooms] = useState(true);
  const [isLoadingReservations, setIsLoadingReservations] = useState(true);

  const [activeNotificationTab, setActiveNotificationTab] = useState("pending");
  const [activeRoomTab, setActiveRoomTab] = useState("available");

  const { toast } = useToast();

  const fetchData = useCallback(async () => {
    if (typeof tenantId !== 'number' || typeof branchId !== 'number') {
      toast({ title: "Info", description: "Tenant or Branch ID missing or invalid. Cannot fetch dashboard data.", variant: "default" });
      setIsLoadingNotifications(false);
      setIsLoadingRooms(false);
      setIsLoadingReservations(false);
      return;
    }

    // console.log(`[DashboardContent] Fetching data for tenantId: ${tenantId}, branchId: ${branchId}`);

    setIsLoadingNotifications(true);
    try {
      const notifData = await listNotificationsForBranch(tenantId, branchId);
      setNotifications(notifData.sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
    } catch (error) {
      console.error("[DashboardContent] Failed to fetch notifications:", error);
      toast({ title: "Notification Data Error", description: `Could not fetch notifications. ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
    } finally {
      setIsLoadingNotifications(false);
    }

    setIsLoadingRooms(true);
    try {
      const roomsData = await listRoomsForBranch(branchId, tenantId);
      setRooms(roomsData);
    } catch (error) {
      console.error("[DashboardContent] Failed to fetch rooms:", error);
      toast({ title: "Room Data Error", description: `Could not fetch rooms. ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
    } finally {
      setIsLoadingRooms(false);
    }

    setIsLoadingReservations(true);
    try {
      const unassignedResData = await listUnassignedReservations(tenantId, branchId);
      setUnassignedReservations(unassignedResData);
    } catch (error) {
      console.error("[DashboardContent] Failed to fetch unassigned reservations:", error);
      toast({ title: "Reservation Data Error", description: `Could not fetch unassigned reservations. ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
    } finally {
      setIsLoadingReservations(false);
    }

  }, [tenantId, branchId, toast]);

  useEffect(() => {
    if (tenantId && branchId) {
        fetchData();
    } else {
        // Set loading states to false if essential IDs are missing to prevent infinite loading indicators
        setIsLoadingNotifications(false);
        setIsLoadingRooms(false);
        setIsLoadingReservations(false);
    }
  }, [fetchData, tenantId, branchId]); // Added tenantId and branchId to ensure fetchData is called if they change from null to a value

  useEffect(() => {
    const today: Transaction[] = [];
    const upcoming: Transaction[] = [];

    unassignedReservations.forEach(res => {
        // Ensure status is a number before comparing
        const statusNum = Number(res.status);
        if (statusNum === TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE) {
            return;
        }
        if (res.reserved_check_in_datetime) {
            try {
                const checkInDate = parseISO(res.reserved_check_in_datetime.replace(' ', 'T'));
                if (isToday(checkInDate)) {
                    today.push(res);
                } else if (isFuture(checkInDate)) {
                    upcoming.push(res);
                }
            } catch (e) {
                if(res.created_at && isToday(parseISO(res.created_at.replace(' ','T')))) {
                    today.push(res);
                }
            }
        } else {
             if(res.created_at && isToday(parseISO(res.created_at.replace(' ','T')))) {
                today.push(res);
            }
        }
    });
    setReservationsToday(today.sort((a,b) => (a.reserved_check_in_datetime && b.reserved_check_in_datetime ? parseISO(a.reserved_check_in_datetime.replace(' ', 'T')).getTime() - parseISO(b.reserved_check_in_datetime.replace(' ', 'T')).getTime() : 0)));
    setReservationsUpcoming(upcoming.sort((a,b) => (a.reserved_check_in_datetime && b.reserved_check_in_datetime ? parseISO(a.reserved_check_in_datetime.replace(' ', 'T')).getTime() - parseISO(b.reserved_check_in_datetime.replace(' ', 'T')).getTime() : 0)));
  }, [unassignedReservations]);


  const filteredNotifications = notifications.filter(notif => {
    if (activeNotificationTab === "pending") {
      return notif.transaction_id && notif.transaction_is_accepted === TRANSACTION_IS_ACCEPTED_STATUS.PENDING;
    }
    if (activeNotificationTab === "accepted") {
      return notif.transaction_id && notif.transaction_is_accepted === TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED;
    }
    if (activeNotificationTab === "general") {
      return !notif.transaction_id ||
             (notif.transaction_is_accepted !== null &&
              notif.transaction_is_accepted !== TRANSACTION_IS_ACCEPTED_STATUS.PENDING &&
              notif.transaction_is_accepted !== TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED);
    }
    return false;
  });

  const activeRoomsForDashboard = rooms.filter(room => room.status === HOTEL_ENTITY_STATUS.ACTIVE);
  
  const availableCleanRooms = activeRoomsForDashboard.filter(room => room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && room.cleaning_status === ROOM_CLEANING_STATUS.CLEAN);
  const availableNotCleanRooms = activeRoomsForDashboard.filter(room => room.is_available === ROOM_AVAILABILITY_STATUS.AVAILABLE && room.cleaning_status !== ROOM_CLEANING_STATUS.CLEAN && room.cleaning_status !== ROOM_CLEANING_STATUS.OUT_OF_ORDER);
  const occupiedRooms = activeRoomsForDashboard.filter(room => room.is_available === ROOM_AVAILABILITY_STATUS.OCCUPIED);
  const reservedRooms = activeRoomsForDashboard.filter(room => room.is_available === ROOM_AVAILABILITY_STATUS.RESERVED);
  const outOfOrderRooms = activeRoomsForDashboard.filter(room => room.cleaning_status === ROOM_CLEANING_STATUS.OUT_OF_ORDER);


  const isLoading = isLoadingNotifications || isLoadingRooms || isLoadingReservations;

  if (!tenantId || !branchId) {
    return (
        <Card>
            <CardHeader><CardTitle>Dashboard Unavailable</CardTitle></CardHeader>
            <CardContent><p className="text-muted-foreground">Tenant or Branch information is not available. Please ensure you are assigned correctly.</p></CardContent>
        </Card>
    );
  }


  if (isLoading && notifications.length === 0 && rooms.length === 0 && unassignedReservations.length === 0) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="ml-3 text-muted-foreground">Loading dashboard data...</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card className="lg:col-span-2">
        <CardHeader>
          <div className="flex items-center space-x-2">
            <Bell className="h-5 w-5 text-primary" />
            <CardTitle>Notifications Overview</CardTitle>
          </div>
          <ShadCardDescription>Summary of recent notifications for your branch.</ShadCardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingNotifications ? <div className="flex justify-center py-4"><Loader2 className="animate-spin text-primary"/></div> :
          <Tabs value={activeNotificationTab} onValueChange={setActiveNotificationTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-4">
              <TabsTrigger value="pending">Pending ({notifications.filter(n => n.transaction_id && n.transaction_is_accepted === TRANSACTION_IS_ACCEPTED_STATUS.PENDING).length})</TabsTrigger>
              <TabsTrigger value="accepted">Accepted Tx ({notifications.filter(n => n.transaction_id && n.transaction_is_accepted === TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED).length})</TabsTrigger>
              <TabsTrigger value="general">General ({notifications.filter(n => !n.transaction_id || (n.transaction_is_accepted !== null && n.transaction_is_accepted !== TRANSACTION_IS_ACCEPTED_STATUS.PENDING && n.transaction_is_accepted !== TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED)).length})</TabsTrigger>
            </TabsList>
            <TabsContent value="pending">
              <NotificationTable notifications={filteredNotifications} />
            </TabsContent>
            <TabsContent value="accepted">
              <NotificationTable notifications={filteredNotifications} />
            </TabsContent>
            <TabsContent value="general">
              <NotificationTable notifications={filteredNotifications} />
            </TabsContent>
          </Tabs>
          }
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <CalendarClock className="h-5 w-5 text-primary" />
            <CardTitle>Reservations Summary</CardTitle>
          </div>
          <ShadCardDescription>Unassigned reservations awaiting room assignment.</ShadCardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingReservations ? <div className="flex justify-center py-4"><Loader2 className="animate-spin text-primary"/></div> :
          <>
            <div className="mb-4">
                <h3 className="text-md font-semibold mb-1">For Today ({reservationsToday.length})</h3>
                <ReservationListTable reservations={reservationsToday} title="Reservations for Today" />
            </div>
            <div>
                <h3 className="text-md font-semibold mb-1">Upcoming ({reservationsUpcoming.length})</h3>
                <ReservationListTable reservations={reservationsUpcoming} title="Upcoming Reservations" />
            </div>
          </>
          }
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <Bed className="h-5 w-5 text-primary" />
            <CardTitle>Room Status Overview</CardTitle>
          </div>
          <ShadCardDescription>Current status of rooms in your branch.</ShadCardDescription>
        </CardHeader>
        <CardContent>
            {isLoadingRooms ? <div className="flex justify-center py-4"><Loader2 className="animate-spin text-primary"/></div> :
            <Tabs value={activeRoomTab} onValueChange={setActiveRoomTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 mb-4">
                <TabsTrigger value="available">Available ({availableCleanRooms.length + availableNotCleanRooms.length})</TabsTrigger>
                <TabsTrigger value="occupied">Occupied ({occupiedRooms.length})</TabsTrigger>
                <TabsTrigger value="reserved">Reserved ({reservedRooms.length})</TabsTrigger>
                <TabsTrigger value="out-of-order">Out of Order ({outOfOrderRooms.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="available" className="max-h-72 overflow-y-auto">
                {(availableCleanRooms.length + availableNotCleanRooms.length) === 0 ? <p className="text-muted-foreground text-center py-4">No rooms currently available.</p> : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {availableCleanRooms.map(room => (
                      <Card key={`avail-dash-clean-${room.id}`} className="shadow-sm bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700">
                        <CardHeader className="p-2">
                          <CardTitle className="text-sm font-medium text-green-700 dark:text-green-200 truncate">{room.room_name}</CardTitle>
                          <ShadCardDescription className="text-xs text-green-600 dark:text-green-300">
                            Room #: {room.room_code} <br/>
                            <div className="flex items-center">
                                <Wrench size={12} className="inline mr-1" />
                                {ROOM_CLEANING_STATUS_TEXT[Number(room.cleaning_status) as keyof typeof ROOM_CLEANING_STATUS_TEXT]}
                            </div>
                          </ShadCardDescription>
                        </CardHeader>
                      </Card>
                    ))}
                    {availableNotCleanRooms.map(room => (
                      <Card key={`avail-dash-notclean-${room.id}`} className="shadow-sm bg-slate-100 dark:bg-slate-800/30 border-slate-300 dark:border-slate-700">
                        <CardHeader className="p-2">
                          <CardTitle className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{room.room_name}</CardTitle>
                          <ShadCardDescription className="text-xs text-slate-600 dark:text-slate-300">
                            Room #: {room.room_code} <br/>
                            <div className="flex items-center">
                                <Wrench size={12} className="inline mr-1" />
                                {ROOM_CLEANING_STATUS_TEXT[Number(room.cleaning_status) as keyof typeof ROOM_CLEANING_STATUS_TEXT]}
                            </div>
                          </ShadCardDescription>
                        </CardHeader>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>
              <TabsContent value="occupied" className="max-h-72 overflow-y-auto">
                {occupiedRooms.length === 0 ? <p className="text-muted-foreground text-center py-4">No rooms currently occupied.</p> : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {occupiedRooms.map(room => {
                      let estCheckoutDisplay = 'N/A';
                      if (room.active_transaction_check_in_time && room.active_transaction_rate_hours) {
                          try {
                              const checkInDate = parseISO(String(room.active_transaction_check_in_time).replace(' ', 'T'));
                              const estCheckoutDate = addHours(checkInDate, room.active_transaction_rate_hours);
                              estCheckoutDisplay = format(estCheckoutDate, 'yyyy-MM-dd hh:mm aa');
                          } catch (e) { /* ignore */ }
                      }
                      return (
                        <Card key={`occ-dash-${room.id}`} className="shadow-sm bg-orange-100 dark:bg-orange-900/30 border-orange-300 dark:border-orange-700">
                          <CardHeader className="p-2">
                            <CardTitle className="text-sm font-medium text-orange-700 dark:text-orange-200 truncate">{room.room_name} <span className="text-xs">({room.room_code})</span></CardTitle>
                            <ShadCardDescription className="text-xs text-orange-600 dark:text-orange-300 space-y-0.5">
                              <div className="flex items-center"><UserIcon size={12} className="mr-1"/>{room.active_transaction_client_name || 'N/A'}</div>
                              <div>In: {room.active_transaction_check_in_time ? format(parseISO(String(room.active_transaction_check_in_time).replace(' ', 'T')), 'yyyy-MM-dd hh:mm aa') : 'N/A'}</div>
                              <div>Rate: {room.active_transaction_rate_name || 'N/A'}</div>
                              <div>Est. Out: {estCheckoutDisplay}</div>
                              <div className="flex items-center">
                                <Wrench size={12} className="inline mr-1" />
                                {ROOM_CLEANING_STATUS_TEXT[Number(room.cleaning_status) as keyof typeof ROOM_CLEANING_STATUS_TEXT]}
                               </div>
                            </ShadCardDescription>
                          </CardHeader>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </TabsContent>
              <TabsContent value="reserved" className="max-h-72 overflow-y-auto">
                {reservedRooms.length === 0 ? <p className="text-muted-foreground text-center py-4">No rooms currently reserved.</p> : (
                   <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {reservedRooms.map(room => (
                      <Card key={`res-dash-${room.id}`} className="shadow-sm bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700">
                        <CardHeader className="p-2">
                           <CardTitle className="text-sm font-medium text-blue-700 dark:text-blue-200 truncate">{room.room_name} <span className="text-xs">({room.room_code})</span></CardTitle>
                           <ShadCardDescription className="text-xs text-blue-600 dark:text-blue-300 space-y-0.5">
                             {room.active_transaction_client_name && <div className="flex items-center"><UserIcon size={12} className="mr-1"/>{room.active_transaction_client_name}</div>}
                             <div>Status: {ROOM_AVAILABILITY_STATUS_TEXT[Number(room.is_available)]}</div>
                             <div>Rate: {room.active_transaction_rate_name || 'N/A'}</div>
                             <div className="flex items-center">
                                <Wrench size={12} className="inline mr-1" />
                                {ROOM_CLEANING_STATUS_TEXT[Number(room.cleaning_status) as keyof typeof ROOM_CLEANING_STATUS_TEXT]}
                              </div>
                           </ShadCardDescription>
                        </CardHeader>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>
               <TabsContent value="out-of-order" className="max-h-72 overflow-y-auto">
                {outOfOrderRooms.length === 0 ? <p className="text-muted-foreground text-center py-4">No rooms currently out of order.</p> : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {outOfOrderRooms.map(room => (
                      <Card key={`ooo-dash-${room.id}`} className="shadow-sm bg-yellow-100 dark:bg-yellow-900/30 border-yellow-300 dark:border-yellow-700">
                        <CardHeader className="p-2">
                          <CardTitle className="text-sm font-medium text-yellow-700 dark:text-yellow-200 truncate">{room.room_name} <span className="text-xs">({room.room_code})</span></CardTitle>
                          <ShadCardDescription className="text-xs text-yellow-600 dark:text-yellow-300 space-y-0.5">
                            <div>Floor: {room.floor ?? 'N/A'}</div>
                            <div className="flex items-center">
                              <AlertTriangle size={12} className="inline mr-1 text-yellow-500" />
                              {ROOM_CLEANING_STATUS_TEXT[Number(room.cleaning_status) as keyof typeof ROOM_CLEANING_STATUS_TEXT]}
                            </div>
                            {room.cleaning_notes && (
                              <p className="mt-1 text-xs italic truncate" title={room.cleaning_notes}>
                                Note: {room.cleaning_notes.substring(0, 30)}{room.cleaning_notes.length > 30 ? '...' : ''}
                              </p>
                            )}
                          </ShadCardDescription>
                        </CardHeader>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
            }
        </CardContent>
      </Card>
    </div>
  );
}

    