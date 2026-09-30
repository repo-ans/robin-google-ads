import { supabase } from "./supabaseClient";

export class N8nError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function messageFor(status: number, serverMessage?: string) {
  if (status === 401) return "Your session has ended. Please sign in again.";
  if (status === 403) return "Your role does not allow this action.";
  if (status === 400) return serverMessage || "The request was not valid.";
  return serverMessage || `The request failed (status ${status}).`;
}

// Every dashboard action goes through here: POST to an n8n webhook with the
// user's Supabase access token. n8n checks the token and the role before doing
// anything (CLAUDE.md, webhook rules). The browser never writes business data
// to Supabase itself.
export async function callN8n<T = unknown>(path: string, body: unknown = {}): Promise<T> {
  const base = import.meta.env.VITE_N8N_BASE_URL;
  if (!base) {
    throw new N8nError(0, "The n8n address is not set (VITE_N8N_BASE_URL).");
  }

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new N8nError(401, messageFor(401));

  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new N8nError(0, "Could not reach n8n. Check the connection and try again.");
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const serverMessage =
      json && typeof json === "object" && "error" in json && typeof json.error === "string"
        ? json.error
        : undefined;
    throw new N8nError(res.status, messageFor(res.status, serverMessage));
  }

  return json as T;
}
