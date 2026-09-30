import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Add them to web/.env.local.");
}

// Browser client: anon key + the signed-in user's JWT. RLS decides what each
// user can read. The browser only uses this for reads and for auth (sign in,
// sign out, change own password). Every other action goes to an n8n webhook
// (lib/n8n.ts) - see CLAUDE.md, data-flow rule.
export const supabase = createClient(url, anonKey);
