
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MessageSquare } from "lucide-react";

export default function NotificationsContent() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center space-x-2">
          <MessageSquare className="h-6 w-6 text-primary" />
          <CardTitle>Messages & Notifications</CardTitle>
        </div>
        <CardDescription>View your messages and system notifications here.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">
          Notification system coming soon.
        </p>
      </CardContent>
    </Card>
  );
}
