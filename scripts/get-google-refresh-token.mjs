#!/usr/bin/env node
// One-time: turn FF's Google OAuth client (Client ID + Client secret) into a
// refresh token for the Google Ads API. Node only, no packages.
//
//   node scripts/get-google-refresh-token.mjs
//
// 1. Paste the Client ID and Client secret when asked (they are not saved).
// 2. A Google sign-in link is printed. Open it and sign in with the Google
//    account that has access to FF's Google Ads manager account (MCC) -
//    ideally an FF-owned account, not a personal one.
// 3. Allow access. The refresh token is printed here. Put it in the n8n
//    credential "FF Google OAuth refresh" - nowhere else.
//
// OAuth client type:
//   Desktop app      - works as is.
//   Web application  - first add http://127.0.0.1:8765 to its
//                      "Authorized redirect URIs" in Google Cloud.

import { createServer } from "node:http";
import { createInterface } from "node:readline/promises";
import { randomBytes } from "node:crypto";

const PORT = 8765;
const REDIRECT = `http://127.0.0.1:${PORT}`;
const SCOPE = "https://www.googleapis.com/auth/adwords";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const clientId = (await rl.question("Client ID: ")).trim();
const clientSecret = (await rl.question("Client secret: ")).trim();
rl.close();
if (!clientId.endsWith(".apps.googleusercontent.com") || !clientSecret) {
  console.error("That does not look like a Google OAuth Client ID and secret.");
  process.exit(1);
}

const state = randomBytes(16).toString("hex");
const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT,
  response_type: "code",
  scope: SCOPE,
  access_type: "offline", // ask for a refresh token
  prompt: "consent", // always return a refresh token, even if access was granted before
  state,
}).toString();

const code = await new Promise((resolve, reject) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url, REDIRECT);
    const error = url.searchParams.get("error");
    const got = url.searchParams.get("code");
    if (!got && !error) {
      res.writeHead(404).end();
      return;
    }
    const ok = got && url.searchParams.get("state") === state;
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(ok ? "Done. You can close this tab and go back to the terminal." : `Sign-in did not finish: ${error || "state mismatch"}`);
    server.close();
    ok ? resolve(got) : reject(new Error(error || "state mismatch"));
  });
  server.listen(PORT, "127.0.0.1", () => {
    console.log("\nOpen this link in your browser and sign in with the account that can see FF's Google Ads manager account:\n");
    console.log(authUrl.toString());
    console.log("\nWaiting for Google...");
  });
  server.on("error", reject);
});

const res = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT,
    grant_type: "authorization_code",
  }),
});
const body = await res.json();
if (!res.ok || !body.refresh_token) {
  console.error("\nGoogle did not return a refresh token:", body.error_description || body.error || JSON.stringify(body));
  process.exit(1);
}

console.log("\nRefresh token (put it only in the n8n credential 'FF Google OAuth refresh'):\n");
console.log(body.refresh_token);
console.log(`
Custom Auth JSON for that credential:
{"body": {"client_id": "${clientId}", "client_secret": "<the client secret>", "refresh_token": "<the token above>", "grant_type": "refresh_token"}}
`);
