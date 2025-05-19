import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users2, Home } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function StaffDashboardPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4 selection:bg-accent selection:text-accent-foreground">
      <Card className="w-full max-w-2xl shadow-xl">
        <CardHeader className="items-center text-center">
          <Users2 className="h-16 w-16 text-primary" />
          <CardTitle className="mt-4 text-3xl font-bold">Staff Dashboard</CardTitle>
          <CardDescription>Welcome, Staff Member!</CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <p className="text-muted-foreground">
            Access your daily tasks, operational tools, and guest information.
          </p>
          <Button asChild variant="outline" className="mt-6">
            <Link href="/">
              <Home className="mr-2 h-4 w-4" /> Go to Login
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export const metadata = {
  title: "Staff Dashboard - InnWise",
};
