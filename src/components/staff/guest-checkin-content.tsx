
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { LogIn } from "lucide-react";

export default function GuestCheckInContent() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center space-x-2">
          <LogIn className="h-6 w-6 text-primary" />
          <CardTitle>Guest Check-in / Check-out</CardTitle>
        </div>
        <CardDescription>Manage guest arrivals, departures, and current stays.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">
          This section will contain forms and tools for managing guest check-ins, check-outs,
          viewing current guest lists, and assigning rooms.
        </p>
        {/* TODO: Implement check-in forms, guest list tables, etc. */}
      </CardContent>
    </Card>
  );
}
