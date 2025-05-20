
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { LogIn } from "lucide-react";

// This component might be deprecated or repurposed given the new "Reservations" tab.
// For now, it remains as a placeholder if you decide to use it for other direct check-in flows.
export default function GuestCheckInContent() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center space-x-2">
          <LogIn className="h-6 w-6 text-primary" />
          <CardTitle>Direct Guest Check-in</CardTitle>
        </div>
        <CardDescription>Manage direct guest arrivals and walk-ins.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">
          This section can be used for guests checking in without a prior reservation.
          Consider integrating parts of the "Room Status" booking modal here or
          creating a dedicated form.
        </p>
      </CardContent>
    </Card>
  );
}
