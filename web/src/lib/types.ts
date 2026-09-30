export type AppRole = "rob_admin" | "ff_staff" | "client_viewer";

export type Profile = {
  user_id: string;
  email: string;
  role: AppRole;
  client_id: string | null;
  disabled: boolean;
};

export function isAgency(role: AppRole | null | undefined) {
  return role === "rob_admin" || role === "ff_staff";
}

export const ROLE_LABELS: Record<AppRole, string> = {
  rob_admin: "FF admin",
  ff_staff: "FF staff",
  client_viewer: "Client",
};
