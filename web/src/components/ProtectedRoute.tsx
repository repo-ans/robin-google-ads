import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import type { AppRole } from "../lib/types";
import NoAccessPage from "../pages/NoAccessPage";
import { PageSkeleton } from "./ui";

// Screen-level guard only. The real protection is RLS (reads) and the n8n
// role check (actions); this just keeps people off pages they cannot use.
export default function ProtectedRoute({
  children,
  roles,
}: {
  children: ReactNode;
  roles?: AppRole[];
}) {
  const { session, profile, loading } = useAuth();

  if (loading) {
    return <PageSkeleton />;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (!profile || profile.disabled) {
    return <NoAccessPage reason={profile?.disabled ? "disabled" : "no-profile"} />;
  }

  if (roles && !roles.includes(profile.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
