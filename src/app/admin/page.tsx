import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, Home } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function AdminDashboardPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4 selection:bg-accent selection:text-accent-foreground">
      <Card className="w-full max-w-2xl shadow-xl">
        <CardHeader className="items-center text-center">
          <ShieldCheck className="h-16 w-16 text-primary" />
          <CardTitle className="mt-4 text-3xl font-bold">Admin Dashboard</CardTitle>
          <CardDescription>Welcome, Administrator!</CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <p className="text-muted-foreground">
            You have full access to all administrative features and system controls.
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
  title: "Admin Dashboard - InnWise",
};
