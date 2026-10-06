#!/usr/bin/env node
// FF command line for Claude Code skills and the FF team (PDF tasks 1 and 9).
// It uses the same doors as the dashboard - nothing more:
//   reads   - Supabase with the anon key + your own login, so RLS decides what you see
//   actions - n8n webhooks with your login token; n8n checks your role
//   Google Ads - read only, through the ff-gaql workflow (FF's credentials stay in Supabase/n8n)
// No service role key, no Google Ads secret, ever, on this machine.
//
// Setup: put these in .env at the repo root (gitignored) - see .env.example:
//   FF_SUPABASE_URL, FF_SUPABASE_ANON_KEY, FF_N8N_BASE_URL, FF_EMAIL, FF_PASSWORD
//
// Usage (node scripts/ff.mjs <command> ...):
//   whoami
//   clients                                   clients with their Google Ads accounts
//   get <table> [postgrest query]             e.g. get weekly_stats "client_id=eq.<id>&order=week_start.desc&limit=4"
//   rpc <function> '<json args>'              e.g. rpc dash_campaign_totals '{"p_client_id":"..","p_from":"2026-09-01","p_to":"2026-09-30"}'
//   gaql <customer_id> "<SELECT ...>" [limit] read Google Ads live (read only, search terms name-filtered)
//   call <n8n path> '<json body>'             e.g. call ff/audit '{"action":"generate","client_id":"..","customer_id":".."}'
//   case-match <check|upload> <client_id> <customer_id> <YYYY-MM> <file.csv> [--new]
//                                             upload deletes the file after Google Ads takes it
//
// Output is JSON on stdout. Errors go to stderr with exit code 1.

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const file = join(root, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const die = (msg) => {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
};
const env = (k) => process.env[k] || die(`${k} is not set. Add it to .env at the repo root (see .env.example).`);
const out = (v) => process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);

let session = null;
async function login() {
  if (session) return session;
  const url = env("FF_SUPABASE_URL").replace(/\/+$/, "");
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: env("FF_SUPABASE_ANON_KEY"), "Content-Type": "application/json" },
    body: JSON.stringify({ email: env("FF_EMAIL"), password: env("FF_PASSWORD") }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) die(`Sign-in failed: ${body.error_description || body.msg || res.status}`);
  session = { url, token: body.access_token, user: body.user };
  return session;
}

async function rest(path, { method = "GET", body } = {}) {
  const s = await login();
  const res = await fetch(`${s.url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: env("FF_SUPABASE_ANON_KEY"), Authorization: `Bearer ${s.token}`,
      "Content-Type": "application/json", Accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) die(`Supabase ${res.status}: ${(json && json.message) || text}`);
  return json;
}

async function n8n(path, body) {
  const s = await login();
  const base = env("FF_N8N_BASE_URL").replace(/\/+$/, "");
  const res = await fetch(`${base}/${path.replace(/^\/+/, "")}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.token}` },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) die(`n8n ${res.status}: ${(json && json.error) || text.slice(0, 300) || "no answer"}`);
  if (json === null) die("n8n finished without an answer. Open the workflow's last execution in n8n.");
  return json;
}

const parseJson = (s, what) => {
  try { return s ? JSON.parse(s) : {}; } catch (e) { return die(`${what} is not valid JSON: ${e.message}`); }
};

// Same rules as the dashboard (web/src/lib/caseList.ts): only these columns, no names.
const CASE_COLUMNS = ["case_date", "value", "gclid", "gbraid", "wbraid", "email", "phone", "call_time"];
function readCases(file) {
  const text = readFileSync(file, "utf8").replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const table = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (table.length < 2) die("The case list has no rows.");
  const headers = table[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const bad = headers.filter((h) => h && !CASE_COLUMNS.includes(h));
  if (bad.length) die(`Columns not allowed: ${bad.join(", ")}. Keep only ${CASE_COLUMNS.join(", ")} - no names.`);
  return table.slice(1).map((cells) => {
    const r = {};
    headers.forEach((h, i) => { const v = (cells[i] ?? "").trim(); if (h && v) r[h] = v; });
    return r;
  });
}

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case "whoami": {
    const s = await login();
    const me = await rest(`profiles?select=email,role,client_id,disabled&user_id=eq.${s.user.id}`);
    out(me[0] || { email: s.user.email, role: null });
    break;
  }
  case "clients":
    out(await rest("clients?select=id,name,process,archived_at,writes_enabled,ghl_location_id,google_sheet_id,ad_accounts(customer_id,descriptive_name,status,is_test_account,last_synced_at)&order=name"));
    break;
  case "get": {
    const [table, query = ""] = args;
    if (!table || !/^[a-z_][a-z0-9_]*$/.test(table)) die("Usage: get <table> [postgrest query]");
    out(await rest(`${table}${query ? `?${query.replace(/^\?/, "")}` : ""}`));
    break;
  }
  case "rpc": {
    const [fn, json] = args;
    if (!fn || !/^[a-z_][a-z0-9_]*$/.test(fn)) die("Usage: rpc <function> '<json args>'");
    out(await rest(`rpc/${fn}`, { method: "POST", body: parseJson(json, "args") }));
    break;
  }
  case "gaql": {
    const [customer_id, query, limit] = args;
    if (!customer_id || !query) die('Usage: gaql <customer_id> "<SELECT ...>" [limit]');
    out(await n8n("ff/gaql", { customer_id, query, ...(limit ? { limit: Number(limit) } : {}) }));
    break;
  }
  case "call": {
    const [path, json] = args;
    if (!path || !path.startsWith("ff/")) die("Usage: call <ff/...> '<json body>'");
    out(await n8n(path, parseJson(json, "body")));
    break;
  }
  case "case-match": {
    const flags = args.filter((a) => a.startsWith("--"));
    const [action, client_id, customer_id, month, file] = args.filter((a) => !a.startsWith("--"));
    if (!["check", "upload"].includes(action) || !client_id || !customer_id || !month || !file) {
      die("Usage: case-match <check|upload> <client_id> <customer_id> <YYYY-MM> <file.csv> [--new]");
    }
    const cases = readCases(file);
    const r = await n8n("ff/case-match", { action, client_id, customer_id, month, again: flags.includes("--new"), cases });
    if (action === "upload" && r.uploaded) {
      unlinkSync(file); // case lists are deleted after upload (Rob's SOP)
      r.file_deleted = true;
    }
    out(r);
    break;
  }
  default:
    die("Commands: whoami | clients | get | rpc | gaql | call | case-match  (see the top of scripts/ff.mjs)");
}
