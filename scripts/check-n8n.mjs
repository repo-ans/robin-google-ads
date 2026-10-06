#!/usr/bin/env node
// Static checks on every FF n8n export in /n8n. Run: node scripts/check-n8n.mjs
//
// Fails (exit 1) when:
//   - a workflow other than the four write workflows calls a Google Ads write
//     endpoint (reads allowed: googleAds:search/searchStream,
//     :generateKeywordHistoricalMetrics, geoTargetConstants:suggest)
//   - a write workflow has a Google Ads write without a validateOnly call first
//   - a webhook does not set responseMode, is not POST, or its path is not ff/...
//   - a webhook workflow is missing the Auth check block, or its copy differs
//     from the reference copy in ff-whoami.json
//   - a node uses a credential that is not one of the FF credentials
//   - an ID, URL or credential from the reference (ANS) app appears, or the old
//     Supabase secrets store is referenced
//   - a Code node looks like it logs a token or secret
//   - any workflow is exported as active

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "n8n");

// ff-case-match (PDF task 6) uploads signed cases as offline conversions - added 2026-10-05, needs Rob's OK.
const WRITE_WORKFLOWS = new Set(["ff-build-campaign", "ff-apply-campaign-action", "ff-delete-campaign", "ff-case-match"]);
const READ_ENDPOINTS = [/googleAds:search(Stream)?\b/, /:generateKeywordHistoricalMetrics\b/, /geoTargetConstants:suggest\b/, /customers:listAccessibleCustomers\b/, /oauth2\.googleapis\.com/];
// Google Ads values are entered on the dashboard and stored in Supabase
// (private.google_ads_secrets), so there are no Google credentials in n8n.
const ALLOWED_CREDENTIALS = new Set(["FF Supabase (service role)", "FF OpenAI", "FF Slack", "FF DataForSEO", "FF GHL", "FF Google Sheets"]);

const FORBIDDEN = [
  ["3534195221", "reference direct-access customer id"],
  ["1965689039", "reference client customer id"],
  ["pbeqzrpyxnglppqofeqq", "reference Supabase project"],
  ["fj3WhBV98VkK9qr3", "reference OpenAI credential id"],
  ["gW3hdy107B2DtcxQ", "reference Supabase credential id"],
  ["Manam- OpenAi", "personal OpenAI credential"],
  ["discovered.local", "placeholder discovered-client email"],
  ["ans-google-ads.netlify.app", "reference dashboard URL"],
  ["DIRECT_ACCESS_CUSTOMER_IDS", "hardcoded direct-access list (use ad_accounts.login_customer_id)"],
  ["google_ads_settings", "reference secrets table"],
  ["ff_secrets(", "old secrets function (use ff_google_ads_secrets)"],
  ["private.secrets", "old secrets table (use private.google_ads_secrets)"],
];

const AUTH_BLOCK = ["Auth: read token", "Auth: verify token", "Auth: load profile", "Auth: check role", "Auth: allowed?", "Respond: denied"];

const errors = [];
const fail = (file, msg) => errors.push(`${file}: ${msg}`);

const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
if (files.length === 0) {
  console.error("No workflow exports found in n8n/");
  process.exit(1);
}

function authSignature(workflow) {
  return JSON.stringify(
    AUTH_BLOCK.map((name) => {
      const n = workflow.nodes.find((x) => x.name === name);
      return n ? { name, type: n.type, parameters: n.parameters } : { name, missing: true };
    }),
  );
}

const reference = JSON.parse(readFileSync(join(dir, "ff-whoami.json"), "utf8"));
const referenceAuth = authSignature(reference);
const stripNotes = (raw) => raw.replace(/"notes":\s*"(?:[^"\\]|\\.)*"/g, "");

for (const file of files) {
  const raw = readFileSync(join(dir, file), "utf8");
  let wf;
  try {
    wf = JSON.parse(raw);
  } catch (e) {
    fail(file, `not valid JSON (${e.message})`);
    continue;
  }
  const name = wf.name || file.replace(/\.json$/, "");
  if (`${name}.json` !== file) fail(file, `workflow name "${name}" does not match the file name`);
  if (!name.startsWith("ff-")) fail(file, `workflow name "${name}" must start with ff-`);
  if (wf.active) fail(file, "exported as active - activate it in n8n after setting it up, not in the file");

  for (const [needle, why] of FORBIDDEN) {
    if (raw.includes(needle)) fail(file, `contains ${why} (${needle})`);
  }

  const isWrite = WRITE_WORKFLOWS.has(name);
  const urls = raw.match(/googleads\.googleapis\.com(?:[^"\\]|\\.)*/g) || [];
  for (const url of urls) {
    if (!READ_ENDPOINTS.some((re) => re.test(url)) && !isWrite) fail(file, `non-read Google Ads call: ${url.slice(0, 160)}`);
  }
  const code = stripNotes(raw);
  if (!isWrite && /:mutate\b|:remove\b|:dismiss\b|:apply\b|:upload\w*\b/.test(code)) {
    fail(file, "mentions a Google Ads write method (:mutate/:remove/:dismiss/:apply/:upload) outside notes");
  }
  if (isWrite) {
    const writes = wf.nodes.filter((n) => n.type === "n8n-nodes-base.httpRequest"
      && /googleads\.googleapis\.com/.test(String(n.parameters.url))
      && !READ_ENDPOINTS.some((re) => re.test(String(n.parameters.url))));
    const validating = writes.filter((n) => /validateOnly: true/.test(String(n.parameters.jsonBody)));
    if (!writes.length || !validating.length || validating.length * 2 !== writes.length) {
      fail(file, "every Google Ads write must be paired with a validateOnly call first");
    }
  }

  const webhooks = wf.nodes.filter((n) => n.type === "n8n-nodes-base.webhook");
  for (const w of webhooks) {
    if (!w.parameters?.responseMode) fail(file, `webhook "${w.name}" has no explicit responseMode`);
    if (w.parameters?.httpMethod !== "POST") fail(file, `webhook "${w.name}" must be POST`);
    if (!String(w.parameters?.path || "").startsWith("ff/")) fail(file, `webhook "${w.name}" path must start with ff/`);
  }
  if (webhooks.length > 0 && authSignature(wf) !== referenceAuth) {
    fail(file, "Auth check block is missing or differs from the copy in ff-whoami.json");
  }

  for (const n of wf.nodes) {
    for (const cred of Object.values(n.credentials || {})) {
      if (!ALLOWED_CREDENTIALS.has(cred.name)) fail(file, `node "${n.name}" uses credential "${cred.name}", not an FF credential`);
    }
    const jsCode = n.parameters?.jsCode || "";
    if (/^\/\/ @include /m.test(jsCode)) fail(file, `Code node "${n.name}" has an unexpanded @include - run scripts/build-n8n.mjs`);
    if (/console\.log\([^)]*(token|secret|password|apikey|refresh)/i.test(jsCode)) {
      fail(file, `Code node "${n.name}" appears to log a secret`);
    }
  }
}

if (errors.length) {
  console.error(`n8n check failed (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`n8n check passed: ${files.length} workflow(s)`);
