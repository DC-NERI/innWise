
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loginUser } from "@/actions/auth/loginUser"; // Updated import
import { logLoginAttempt } from "@/actions/auth/logLoginAttempt";
import { loginSchema } from "@/lib/schemas";
import { useToast } from "@/hooks/use-toast";

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('userRole');
      localStorage.removeItem('userTenantId');
      localStorage.removeItem('userTenantName');
      localStorage.removeItem('username');
      localStorage.removeItem('userFirstName');
      localStorage.removeItem('userLastName');
      localStorage.removeItem('userTenantBranchId');
      localStorage.removeItem('userBranchName');
      localStorage.removeItem('userId');
    }
  }, []);

  async function onSubmit(data: LoginFormValues) {
    setIsLoading(true);

    const formData = new FormData();
    formData.append("username", data.username);
    formData.append("password", data.password);

    try {
      const result = await loginUser(formData);

      if (result.success && result.role) {
        toast({
          title: "Login Successful",
          description: `Welcome ${result.firstName || result.username || ''}! Redirecting to ${result.role} dashboard...`,
        });

        if (typeof window !== 'undefined') {
            localStorage.setItem('userRole', result.role);
            if (result.tenantId) {
                localStorage.setItem('userTenantId', String(result.tenantId));
            }
            if (result.tenantName) {
                localStorage.setItem('userTenantName', result.tenantName);
            }
            if (result.username) {
                localStorage.setItem('username', result.username);
            }
            if (result.firstName) {
                localStorage.setItem('userFirstName', result.firstName);
            }
            if (result.lastName) {
                localStorage.setItem('userLastName', result.lastName);
            }
            if (result.tenantBranchId) {
                localStorage.setItem('userTenantBranchId', String(result.tenantBranchId));
            }
            if (result.branchName) {
                localStorage.setItem('userBranchName', result.branchName);
            }
             if (result.userId && typeof result.userId === 'number' && result.userId > 0) {
                localStorage.setItem('userId', String(result.userId));
            }
        }

        setTimeout(() => {
          switch (result.role) {
            case "admin":
              router.push("/admin");
              break;
            case "sysad":
              router.push("/sysad");
              break;
            case "staff":
              router.push("/staff");
              break;
            case "housekeeping":
              router.push("/housekeeping");
              break;
            default:
              toast({
                  title: "Login Warning",
                  description: "Login successful, but role is undefined or not recognized for redirection.",
                  variant: "destructive"
              });
              setIsLoading(false);
          }
        }, 1000);

      } else {
        toast({
            title: "Login Failed",
            description: result.message,
            variant: "destructive"
        });
        setIsLoading(false);
      }
    } catch (error) {
        let errorMessage = "An unexpected error occurred during login.";
        if (error instanceof Error) {
            errorMessage = error.message;
        }
        toast({
            title: "Login Error",
            description: errorMessage,
            variant: "destructive"
        });
        setIsLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md shadow-xl">
      <CardHeader className="text-center">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-16 h-16 mx-auto text-primary mb-4">
          <path d="M12.75 12.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM7.5 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM8.25 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM9.75 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM10.5 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM12.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM13.5 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM14.25 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM15.75 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM16.5 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12 6.75A5.25 5.25 0 0 0 6.75 12H6a.75.75 0 0 0 0 1.5h.75a5.25 5.25 0 0 0 10.5 0H18a.75.75 0 0 0 0-1.5h-.75A5.25 5.25 0 0 0 12 6.75ZM12 8.25a3.75 3.75 0 1 1 0 7.5 3.75 3.75 0 0 1 0-7.5Z" />
          <path fillRule="evenodd" d="M12 1.5a5.25 5.25 0 0 0-5.25 5.25v3a3 3 0 0 0-3 3v6.75a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3v-6.75a3 3 0 0 0-3-3v-3c0-2.9-2.35-5.25-5.25-5.25Zm3.75 8.25v-3a3.75 3.75 0 1 0-7.5 0v3h7.5Z" clipRule="evenodd" />
        </svg>
        <CardTitle className="text-3xl font-bold text-primary">InnWise Login</CardTitle>
        <CardDescription>
          Enter your credentials to access your dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Username</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g., admin"
                      {...field}
                      className="focus:ring-2 focus:ring-accent transition-shadow duration-200 ease-in-out"
                      aria-describedby={form.formState.errors.username ? "username-error" : undefined}
                      aria-invalid={!!form.formState.errors.username}
                    />
                  </FormControl>
                  <FormMessage id="username-error" />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="••••••••"
                      {...field}
                      className="focus:ring-2 focus:ring-accent transition-shadow duration-200 ease-in-out"
                      aria-describedby={form.formState.errors.password ? "password-error" : undefined}
                      aria-invalid={!!form.formState.errors.password}
                    />
                  </FormControl>
                  <FormMessage id="password-error" />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full bg-primary hover:bg-primary/90 text-primary-foreground" disabled={isLoading}>
              {isLoading ? <Loader2 className="animate-spin" /> : "Login"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
