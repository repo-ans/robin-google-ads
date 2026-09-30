import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { isAgency } from "../lib/types";

// Agency users land on the client list; a client login lands on its own client.
export default function HomeRedirect() {
  const { profile } = useAuth();
  if (isAgency(profile?.role)) return <Navigate to="/dashboard" replace />;
  if (profile?.client_id) return <Navigate to={`/dashboard/clients/${profile.client_id}`} replace />;
  return <Navigate to="/login" replace />;
}
