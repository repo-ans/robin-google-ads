import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import GoogleAdsConnection from "../components/GoogleAdsConnection";

// Settings = the reference's "Google Ads API Settings" page. Same fields and
// layout; the difference is that saved values are never sent back to the
// browser (stored in Supabase private.google_ads_secrets, read only by n8n).
// Sync runs, keyword research and staff logins are on /settings/system.
export default function SettingsPage() {
  const { profile } = useAuth();

  return (
    <main className="min-h-screen bg-page px-6 py-10 text-ink">
      <div className="mx-auto max-w-3xl">
        <Link to="/dashboard" className="no-print text-sm text-ink-subtle hover:underline">
          {"<-"} Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Google Ads API Settings</h1>
        <p className="mt-1 text-ink-muted">
          Account-wide credentials used by every campaign build. n8n reads these directly from Supabase - no need to
          edit workflow files when they rotate.
        </p>

        <div className="mt-8">
          <GoogleAdsConnection isRob={profile?.role === "rob_admin"} />
        </div>

        <Link to="/settings/system" className="no-print mt-6 inline-block text-sm text-ink-subtle hover:underline">
          Sync runs, keyword research and staff logins {"->"}
        </Link>
      </div>
    </main>
  );
}
