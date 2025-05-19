"use server";

import type { UserRole } from "@/lib/types";
import { loginSchema } from "@/lib/schemas"; // Import from new location

// Simulate a database of users
const mockUsers: Array<{ id: string; username: string; password: string; role: UserRole; lastLogIn: Date }> = [
  { id: "1", username: "admin", password: "password", role: "admin", lastLogIn: new Date() },
  { id: "2", username: "sysad", password: "password", role: "sysad", lastLogIn: new Date() },
  { id: "3", username: "staff", password: "password", role: "staff", lastLogIn: new Date() },
];

export type LoginResult = {
  success: boolean;
  message: string;
  role?: UserRole;
};

export async function loginUser(formData: FormData): Promise<LoginResult> {
  try {
    const parsedData = Object.fromEntries(formData.entries());
    const validatedFields = loginSchema.safeParse(parsedData);

    if (!validatedFields.success) {
      const errorMessages = validatedFields.error.issues.map(issue => `${issue.path.join('.') || 'field'}: ${issue.message}`).join(', ');
      return {
        message: `Invalid form data. ${errorMessages}`,
        success: false,
      };
    }

    const { username, password } = validatedFields.data;

    const user = mockUsers.find(
      (u) => u.username === username && u.password === password
    );

    if (!user) {
      return { message: "Invalid username or password.", success: false };
    }

    // Simulate updating last_log_in
    // In a real app, this would be a database update.
    // For this simulation, we find the user in our mock array and update its object.
    const userInDb = mockUsers.find(u => u.id === user.id);
    if (userInDb) {
        userInDb.lastLogIn = new Date();
        console.log(`User ${userInDb.username} (Role: ${userInDb.role}) logged in at ${userInDb.lastLogIn.toISOString()}.`);
    }

    return { message: "Login successful!", success: true, role: user.role };

  } catch (error) {
    console.error("Login error:", error);
    let errorMessage = "An unexpected error occurred during login.";
    if (error instanceof Error) {
        errorMessage = error.message;
    }
    return { message: errorMessage, success: false };
  }
}
