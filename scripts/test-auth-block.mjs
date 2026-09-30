#!/usr/bin/env node
// Runs the Auth check block from n8n/ff-whoami.json against a real Supabase
// (local by default) and checks every outcome. The workflow JSON itself is
// executed - Code node source, HTTP node URLs/headers, IF and Respond nodes -
// by a small interpreter below, so this tests what gets imported into n8n.
//
// Needs a Supabase project with the migrations applied - use FF's dev project,
// never production (it creates and then deletes five test logins).
//   node scripts/test-auth-block.mjs
// Reads SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY from the
// environment or the repo-root .env (gitignored).

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const file = join(root, ".env");
  const dotenv = existsSync(file)
    ? Object.fromEntries(
        readFileSync(file, "utf8")
          .split(/\r?\n/)
          .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/))
          .filter(Boolean)
          .map((m) => [m[1], m[2]]),
      )
    : {};
  const SUPABASE_URL = process.env.SUPABASE_URL || dotenv.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || dotenv.SUPABASE_ANON_KEY;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || dotenv.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (env or repo-root .env).");
  }
  return { url: SUPABASE_URL, anon: SUPABASE_ANON_KEY, service: SUPABASE_SERVICE_ROLE_KEY };
}

const env = loadEnv();
const workflow = JSON.parse(readFileSync(join(root, "n8n", "ff-whoami.json"), "utf8"));

// ---------------------------------------------------------------------------
// Minimal n8n interpreter: enough for Code, HTTP Request, IF, Respond to Webhook.
// ---------------------------------------------------------------------------
function makeContext(outputs, currentJson) {
  const $ = (name) => {
    if (!(name in outputs)) throw new Error(`node "${name}" has not run`);
    const items = outputs[name];
    return { first: () => items[0], all: () => items };
  };
  return { $, $json: currentJson };
}

function evalExpr(expr, ctx) {
  return new Function("$", "$json", `return (${expr});`)(ctx.$, ctx.$json);
}

function resolve(value, ctx) {
  if (typeof value !== "string" || !value.startsWith("=")) return value;
  const body = value.slice(1);
  const whole = body.match(/^\{\{([\s\S]*)\}\}$/);
  if (whole && !whole[1].includes("}}")) return evalExpr(whole[1], ctx);
  return body.replace(/\{\{([\s\S]*?)\}\}/g, (_, e) => String(evalExpr(e, ctx)));
}

async function runNode(node, input, outputs, config) {
  const ctx = makeContext(outputs, input?.json ?? {});
  const p = node.parameters;

  if (node.type === "n8n-nodes-base.code") {
    let code = p.jsCode;
    if (node.name === "Config") code = config; // test-specific config, same shape
    const result = new Function("$", "$json", code)(ctx.$, ctx.$json);
    return result;
  }

  if (node.type === "n8n-nodes-base.httpRequest") {
    const url = new URL(resolve(p.url, ctx));
    for (const q of p.queryParameters?.parameters ?? []) url.searchParams.set(q.name, resolve(q.value, ctx));
    const headers = {};
    for (const h of p.headerParameters?.parameters ?? []) headers[h.name] = resolve(h.value, ctx);
    if (p.authentication === "predefinedCredentialType" && p.nodeCredentialType === "supabaseApi") {
      headers.apikey = env.service;
      headers.Authorization = `Bearer ${env.service}`;
    }
    const res = await fetch(url, { method: p.method, headers });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    const full = p.options?.response?.response?.fullResponse;
    if (!res.ok && !p.options?.response?.response?.neverError) throw new Error(`HTTP ${res.status}`);
    return [{ json: full ? { statusCode: res.status, body } : body }];
  }

  if (node.type === "n8n-nodes-base.if") {
    const c = p.conditions.conditions[0];
    const pass = resolve(c.leftValue, ctx) === true;
    return { branch: pass ? 0 : 1, items: [input] };
  }

  if (node.type === "n8n-nodes-base.respondToWebhook") {
    return {
      respond: {
        status: Number(resolve(p.options.responseCode, ctx)),
        body: JSON.parse(resolve(p.responseBody, ctx)),
      },
    };
  }

  throw new Error(`unsupported node type ${node.type}`);
}

async function runWorkflow({ authorization, allowedRoles }) {
  const config = `return [{ json: { SUPABASE_URL: ${JSON.stringify(env.url)}, SUPABASE_ANON_KEY: ${JSON.stringify(
    env.anon,
  )}, ALLOWED_ROLES: ${JSON.stringify(allowedRoles)} } }];`;
  const byName = Object.fromEntries(workflow.nodes.map((n) => [n.name, n]));
  const outputs = { Webhook: [{ json: { headers: authorization ? { authorization } : {}, body: {} } }] };
  let current = "Webhook";
  let item = outputs.Webhook[0];

  for (let guard = 0; guard < 50; guard++) {
    const next = workflow.connections[current]?.main;
    if (!next) throw new Error(`workflow ended at "${current}" without responding`);
    const branch = item?.__branch ?? 0;
    const target = next[branch]?.[0]?.node;
    if (!target) throw new Error(`no connection from "${current}" branch ${branch}`);
    const result = await runNode(byName[target], item, outputs, config);
    if (result?.respond) return result.respond;
    if (result?.branch !== undefined) {
      outputs[target] = result.items;
      item = { ...result.items[0], __branch: result.branch };
    } else {
      outputs[target] = result;
      item = result[0];
    }
    current = target;
  }
  throw new Error("too many steps");
}

// ---------------------------------------------------------------------------
// Fixture: users and profiles, created through the Auth Admin API and PostgREST
// with the service role (the same way ff-client-admin will do it).
// ---------------------------------------------------------------------------
const admin = { apikey: env.service, Authorization: `Bearer ${env.service}`, "Content-Type": "application/json" };
const password = "Test-password-2026";
const run = Date.now();

async function createUser(label) {
  const email = `${label}-${run}@auth-block.test`;
  const res = await fetch(`${env.url}/auth/v1/admin/users`, {
    method: "POST",
    headers: admin,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`create user ${label}: ${res.status} ${await res.text()}`);
  return { id: (await res.json()).id, email };
}

async function rest(path, method, body) {
  const res = await fetch(`${env.url}/rest/v1/${path}`, {
    method,
    headers: { ...admin, Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function signIn(email) {
  const res = await fetch(`${env.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: env.anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`sign in ${email}: ${res.status}`);
  return (await res.json()).access_token;
}

const [client] = await rest("clients", "POST", { name: "Auth Block Test Home", slug: `auth-block-${run}` });
const rob = await createUser("rob");
const staff = await createUser("staff");
const viewer = await createUser("viewer");
const disabled = await createUser("disabled");
const noProfile = await createUser("noprofile");

await rest("profiles", "POST", [
  { user_id: rob.id, email: rob.email, role: "rob_admin" },
  { user_id: staff.id, email: staff.email, role: "ff_staff" },
  { user_id: viewer.id, email: viewer.email, role: "client_viewer", client_id: client.id },
  { user_id: disabled.id, email: disabled.email, role: "client_viewer", client_id: client.id, disabled: true },
]);

const tokens = {
  rob: await signIn(rob.email),
  staff: await signIn(staff.email),
  viewer: await signIn(viewer.email),
  disabled: await signIn(disabled.email),
  noProfile: await signIn(noProfile.email),
};

const ALL = ["rob_admin", "ff_staff", "client_viewer"];
const AGENCY = ["rob_admin", "ff_staff"];
const ROB = ["rob_admin"];

const cases = [
  ["no Authorization header", { authorization: null, allowedRoles: ALL }, 401],
  ["not a bearer header", { authorization: `Basic ${tokens.rob}`, allowedRoles: ALL }, 401],
  ["forged token", { authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bad", allowedRoles: ALL }, 401],
  ["rob_admin on an all-roles webhook", { authorization: `Bearer ${tokens.rob}`, allowedRoles: ALL }, 200, "rob_admin"],
  ["rob_admin on a rob-only webhook", { authorization: `Bearer ${tokens.rob}`, allowedRoles: ROB }, 200, "rob_admin"],
  ["ff_staff on a rob-only webhook", { authorization: `Bearer ${tokens.staff}`, allowedRoles: ROB }, 403],
  ["ff_staff on an agency webhook", { authorization: `Bearer ${tokens.staff}`, allowedRoles: AGENCY }, 200, "ff_staff"],
  ["client_viewer on an agency webhook", { authorization: `Bearer ${tokens.viewer}`, allowedRoles: AGENCY }, 403],
  ["client_viewer on an all-roles webhook", { authorization: `Bearer ${tokens.viewer}`, allowedRoles: ALL }, 200, "client_viewer"],
  ["disabled login", { authorization: `Bearer ${tokens.disabled}`, allowedRoles: ALL }, 403],
  ["login with no profile", { authorization: `Bearer ${tokens.noProfile}`, allowedRoles: ALL }, 403],
];

let failed = 0;
try {
  for (const [label, input, wantStatus, wantRole] of cases) {
    const got = await runWorkflow(input);
    const ok = got.status === wantStatus && (!wantRole || got.body.role === wantRole);
    const leaked = JSON.stringify(got.body).includes("eyJ");
    if (!ok || leaked) failed++;
    console.log(
      `${ok && !leaked ? "ok  " : "FAIL"} ${label}: ${got.status}${got.body.role ? " " + got.body.role : ""}` +
        `${got.body.error ? ` (${got.body.error})` : ""}${leaked ? " - response contains a token" : ""}`,
    );
  }
  const viewerResult = await runWorkflow({ authorization: `Bearer ${tokens.viewer}`, allowedRoles: ALL });
  const clientOk = viewerResult.body.client_id === client.id;
  if (!clientOk) failed++;
  console.log(`${clientOk ? "ok  " : "FAIL"} client_viewer result carries its client_id`);
} finally {
  // Clean up: profiles cascade from auth.users.
  for (const u of [rob, staff, viewer, disabled, noProfile]) {
    await fetch(`${env.url}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: admin });
  }
  await rest(`clients?id=eq.${client.id}`, "DELETE");
}

if (failed) {
  console.error(`\n${failed} auth block check(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${cases.length + 1} auth block checks passed.`);
