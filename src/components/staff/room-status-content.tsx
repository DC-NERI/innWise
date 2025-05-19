
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BedDouble } from "lucide-react";

export default function RoomStatusContent() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center space-x-2">
          <BedDouble className="h-6 w-6 text-primary" />
          <CardTitle>Room Status Management</CardTitle>
        </div>
        <CardDescription>View and update the status of hotel rooms.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">
          This section will display a list or grid of rooms, showing their current status
          (e.g., Vacant Clean, Occupied, Vacant Dirty, Out of Order). Staff will be able
          to update these statuses.
        </p>
        {/* TODO: Implement room status display grid/list and update functionality */}
      </CardContent>
    </Card>
  );
}
