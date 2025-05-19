export type UserRole = "admin" | "sysad" | "staff";

export interface AuthenticatedUser {
  id: string;
  username: string;
  role: UserRole;
  lastLogIn?: Date;
}
