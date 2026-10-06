import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import ProtectedRoute from "./components/ProtectedRoute";
import { PageSkeleton, TestBadge } from "./components/ui";
import LoginPage from "./pages/LoginPage";
import HomeRedirect from "./pages/HomeRedirect";
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const AccountsPage = lazy(() => import("./pages/AccountsPage"));
const ClientDetailPage = lazy(() => import("./pages/ClientDetailPage"));
const CampaignDetailPage = lazy(() => import("./pages/CampaignDetailPage"));
const UsersPage = lazy(() => import("./pages/UsersPage"));
const AuditPage = lazy(() => import("./pages/AuditPage"));
const BuilderPage = lazy(() => import("./pages/BuilderPage"));
const CaseMatchPage = lazy(() => import("./pages/CaseMatchPage"));
const AccountPage = lazy(() => import("./pages/AccountPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const GoogleCallbackPage = lazy(() => import("./pages/GoogleCallbackPage"));
const SystemPage = lazy(() => import("./pages/SystemPage"));
import NotFoundPage from "./pages/NotFoundPage";
import type { AppRole } from "./lib/types";

const AGENCY: AppRole[] = ["rob_admin", "ff_staff"];

// Route map: PLAN.md section 8. The reference's public /intake page and
// /client/:clientId magic link are gone; clients sign in like everyone else.
// These guards only decide what to show - RLS and the n8n role checks are the
// real protection.
export default function App() {
  const guard = (el: React.ReactNode, roles?: AppRole[]) => <ProtectedRoute roles={roles}>{el}</ProtectedRoute>;
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<PageSkeleton />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={guard(<HomeRedirect />)} />
          <Route path="/dashboard" element={guard(<DashboardPage />, AGENCY)} />
          <Route path="/dashboard/accounts" element={guard(<AccountsPage />, AGENCY)} />
          <Route path="/dashboard/clients/:clientId" element={guard(<ClientDetailPage />)} />
          <Route path="/dashboard/clients/:clientId/campaigns/:campaignId" element={guard(<CampaignDetailPage />)} />
          <Route path="/dashboard/clients/:clientId/users" element={guard(<UsersPage />, AGENCY)} />
          <Route path="/dashboard/clients/:clientId/audit" element={guard(<AuditPage />, AGENCY)} />
          <Route path="/dashboard/clients/:clientId/builder" element={guard(<BuilderPage />, AGENCY)} />
          <Route path="/dashboard/clients/:clientId/case-match" element={guard(<CaseMatchPage />, AGENCY)} />
          <Route path="/account" element={guard(<AccountPage />)} />
          <Route path="/settings" element={guard(<SettingsPage />, AGENCY)} />
          <Route path="/settings/system" element={guard(<SystemPage />, AGENCY)} />
          <Route path="/settings/google-callback" element={guard(<GoogleCallbackPage />, ["rob_admin"])} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </Suspense>
        <TestBadge />
      </BrowserRouter>
    </AuthProvider>
  );
}
