#!/usr/bin/env node
// Builds every FF n8n workflow export from readable sources:
//   n8n/src/<workflow>/*.js - Code node bodies ("// @include shared/x.js" pulls in n8n/src/shared/x.js)
//   this file               - nodes, parameters and wiring
// Output: n8n/<workflow>.json, ready to import or paste into n8n.
//
//   node scripts/build-n8n.mjs && node scripts/check-n8n.mjs && node scripts/test-sync-code.mjs
//
// Credentials referenced (create them once in n8n, same names):
//   FF Supabase (service role)     Supabase API       - project URL + service role key
//   FF OpenAI                      OpenAI             - FF-owned API key
// Google Ads values (developer token, OAuth client id/secret, refresh token,
// MCC id) are NOT n8n credentials: Rob enters them on the dashboard Settings
// page, they are stored in Supabase private.google_ads_secrets, and each
// workflow reads them with "Get Google Ads secrets" (PLAN.md 3.5).
//   FF Slack                       Slack API          - bot token (optional)
//   FF DataForSEO                  Basic Auth         - DataForSEO API login + password
//   FF GHL OAuth                   OAuth2 API         - FF's private GHL Marketplace app, connected once as the agency
//                                                        (an agency private integration key cannot open sub-accounts)
//   FF Google Sheets               Google Sheets OAuth2 - FF Google login that can edit the client Sheets

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const n8nDir = join(root, "n8n");

const CRED = {
  supabase: { supabaseApi: { id: "", name: "FF Supabase (service role)" } },
  openai: { openAiApi: { id: "", name: "FF OpenAI" } },
  slack: { slackApi: { id: "", name: "FF Slack" } },
  dataforseo: { httpBasicAuth: { id: "", name: "FF DataForSEO" } },
  ghl: { oAuth2Api: { id: "", name: "FF GHL OAuth" } },
  sheets: { googleSheetsOAuth2Api: { id: "", name: "FF Google Sheets" } },
};
const GHL_API = "https://services.leadconnectorhq.com";
const GHL_HEADERS = { Version: "2021-07-28", Accept: "application/json" };
// "FF GHL OAuth" is FF's private GHL Marketplace app, installed by the agency on
// its sub-accounts and connected once in n8n. Sub-account calls use a location token
// made from it per client (POST /oauth/locationToken), so no client needs its
// own key. The token lives only inside the execution (these workflows keep no
// execution data).
const ghlAuthHeaders = (tokenNode) => ({
  ...GHL_HEADERS,
  Authorization: `=Bearer {{ ($('${tokenNode}').first().json.body || {}).access_token || 'missing' }}`,
});
// Two nodes: "GHL: find agency" (which agency the sub-account belongs to - so
// nobody has to find GHL's company id by hand) then the token for that sub-account.
// Callers connect into "GHL: find agency". Config GHL_COMPANY_ID is only a fallback.
function ghlLocationToken(wf, name, pos, locationExpr) {
  wf.http("GHL: find agency", [pos[0] - 110, pos[1] + 120], {
    method: "GET", cred: "ghl", url: `=${GHL_API}/locations/{{ ${locationExpr} }}`, headers: GHL_HEADERS, full: true, neverError: true,
  }, {
    onError: "continueRegularOutput",
    notes: "The agency (company) id of this sub-account, read with FF's GHL app. Used for the sub-account token below.",
  });
  wf.http(name, pos, {
    method: "POST", cred: "ghl", url: `${GHL_API}/oauth/locationToken`, headers: GHL_HEADERS,
    form: {
      companyId: "={{ ((($('GHL: find agency').first().json.body || {}).location) || {}).companyId || $('Config').first().json.GHL_COMPANY_ID }}",
      locationId: `={{ ${locationExpr} }}`,
    },
    full: true, neverError: true,
  }, {
    onError: "continueRegularOutput",
    notes: "FF GHL app (agency) -> a short-lived token for this client's sub-account. The app must be installed on the sub-account.",
  });
  wf.connect("GHL: find agency", name);
  return name;
}
const SB = "{{ $('Config').first().json.SUPABASE_URL }}";
const API_V = "{{ $('Config').first().json.GOOGLE_ADS_API_VERSION }}";
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const AGENCY = ["rob_admin", "ff_staff"];
const ALL_ROLES = ["rob_admin", "ff_staff", "client_viewer"];

// ------------------------------------------------------------------ sources
function loadCode(workflow, file) {
  // Normalize Windows line endings so "// @include" lines always match.
  const read = (rel) => readFileSync(join(n8nDir, "src", rel), "utf8").replace(/\r\n/g, "\n");
  let src = read(`${workflow}/${file}`);
  const included = new Set();
  src = src.replace(/^\/\/ @include (\S+)\n/gm, (_, rel) => {
    if (included.has(rel)) return "";
    included.add(rel);
    return `${read(rel)}\n`;
  });
  try {
    new Function("$", "$input", "$json", `return (async () => {\n${src}\n})`);
  } catch (e) {
    throw new Error(`${workflow}/${file}: ${e.message}`);
  }
  return src;
}

// ------------------------------------------------------------------ workflow builder
class Workflow {
  constructor(name) {
    this.name = name;
    this.nodes = [];
    this.connections = {};
  }
  add(node) {
    if (this.nodes.some((n) => n.name === node.name)) throw new Error(`${this.name}: duplicate node ${node.name}`);
    this.nodes.push({ id: randomUUID(), ...node });
    return node.name;
  }
  connect(from, to, output = 0, type = "main") {
    this.connections[from] ||= {};
    this.connections[from][type] ||= [];
    const outs = this.connections[from][type];
    while (outs.length <= output) outs.push([]);
    outs[output].push({ node: to, type, index: 0 });
  }
  chain(...names) {
    for (let i = 0; i < names.length - 1; i++) this.connect(names[i], names[i + 1]);
  }
  code(name, workflow, file, pos, extra = {}) {
    return this.add({ name, type: "n8n-nodes-base.code", typeVersion: 2, position: pos, parameters: { jsCode: loadCode(workflow, file) }, ...extra });
  }
  inline(name, jsCode, pos, extra = {}) {
    return this.add({ name, type: "n8n-nodes-base.code", typeVersion: 2, position: pos, parameters: { jsCode }, ...extra });
  }
  if(name, expression, pos, notes) {
    return this.add({
      name, type: "n8n-nodes-base.if", typeVersion: 2, position: pos,
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: "", typeValidation: "loose" },
          conditions: [{
            id: randomUUID(), leftValue: `={{ ${expression} }}`, rightValue: true,
            operator: { type: "boolean", operation: "true", singleValue: true },
          }],
          combinator: "and",
        },
        options: {},
      },
      ...(notes ? { notes } : {}),
    });
  }
  http(name, pos, p, extra = {}) {
    const parameters = { method: p.method || "GET", url: p.url };
    if (p.cred === "supabase") {
      parameters.authentication = "predefinedCredentialType";
      parameters.nodeCredentialType = "supabaseApi";
    } else if (p.cred === "dataforseo") {
      parameters.authentication = "genericCredentialType";
      parameters.genericAuthType = "httpBasicAuth";
    } else if (p.cred === "ghl") {
      parameters.authentication = "genericCredentialType";
      parameters.genericAuthType = "oAuth2Api";
    }
    if (p.headers) {
      parameters.sendHeaders = true;
      if (typeof p.headers === "string") {
        parameters.specifyHeaders = "json";
        parameters.jsonHeaders = p.headers;
      } else {
        parameters.headerParameters = { parameters: Object.entries(p.headers).map(([n, value]) => ({ name: n, value })) };
      }
    }
    if (p.jsonBody) {
      parameters.sendBody = true;
      parameters.specifyBody = "json";
      parameters.jsonBody = p.jsonBody;
    }
    if (p.form) {
      parameters.sendBody = true;
      parameters.contentType = "form-urlencoded";
      parameters.bodyParameters = { parameters: Object.entries(p.form).map(([n, value]) => ({ name: n, value })) };
    }
    const options = {};
    if (p.full || p.neverError || p.text) {
      options.response = { response: {
        ...(p.full ? { fullResponse: true } : {}),
        ...(p.neverError ? { neverError: true } : {}),
        ...(p.text ? { responseFormat: "text" } : {}),
      } };
    }
    if (p.batch) options.batching = { batch: { batchSize: 1, batchInterval: p.batch } };
    if (p.timeout) options.timeout = p.timeout;
    parameters.options = options;
    return this.add({
      name, type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: pos, parameters,
      ...(p.cred ? { credentials: CRED[p.cred] } : {}),
      ...extra,
    });
  }
  // Supabase REST call (service role credential).
  sb(name, pos, method, path, extra = {}, opts = {}) {
    return this.http(name, pos, {
      method, cred: "supabase", url: `=${SB}/rest/v1/${path}`,
      headers: opts.prefer ? { Prefer: opts.prefer } : undefined,
      jsonBody: opts.body, full: opts.full, neverError: opts.neverError,
    }, extra);
  }
  // Generic Supabase write driven by the item: { method, path, prefer, body }.
  sbGeneric(name, pos, base = "rest/v1/", notes) {
    return this.http(name, pos, {
      method: "={{ $json.method }}", cred: "supabase", url: `=${SB}/${base}{{ $json.path }}`,
      headers: { Prefer: "={{ $json.prefer || 'return=minimal' }}" },
      jsonBody: "={{ JSON.stringify($json.body ?? {}) }}", full: true, neverError: true,
    }, { onError: "continueRegularOutput", ...(notes ? { notes } : {}) });
  }
  // Google Ads settings saved on the dashboard (Settings page), read from
  // Supabase with the service role. Runs once per execution.
  googleSecrets(name = "Get Google Ads secrets", pos = [0, 0]) {
    return this.sb(name, pos, "POST", "rpc/ff_google_ads_secrets", {
      executeOnce: true,
      notes: "Developer token, OAuth client id/secret, refresh token and MCC id, entered by Rob on the dashboard Settings page (stored in Supabase private.google_ads_secrets - never readable by the browser).",
    }, { body: "={}" });
  }
  // Same request as the reference "Refresh Google Ads token": POST, form-urlencoded,
  // four body fields, no authentication - the values come from "Get Google Ads secrets".
  googleToken(name, pos) {
    const v = (k) => `={{ $('Get Google Ads secrets').first().json.${k} }}`;
    return this.add({
      name, type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: pos,
      parameters: {
        method: "POST", url: "https://oauth2.googleapis.com/token",
        sendBody: true, contentType: "form-urlencoded",
        bodyParameters: { parameters: [
          { name: "client_id", value: v("client_id") },
          { name: "client_secret", value: v("client_secret") },
          { name: "refresh_token", value: v("refresh_token") },
          { name: "grant_type", value: "refresh_token" },
        ] },
        options: { response: { response: { neverError: true } } },
      },
      notes: "OAuth refresh, same as the reference. Values from 'Get Google Ads secrets'. Test: Execute step - the output must contain access_token.",
    });
  }
  googleAds(name, pos, { url, body, token, login, text = false, batch, timeout = 120000, notes, extra = {} }) {
    return this.http(name, pos, {
      method: "POST", url,
      headers: `={{ JSON.stringify(Object.assign({ "Authorization": "Bearer " + ($('${token}').first().json.access_token || 'missing'), "developer-token": $('Get Google Ads secrets').first().json.developer_token || '', "Content-Type": "application/json" }, ${login} ? { "login-customer-id": ${login} } : {})) }}`,
      jsonBody: body, full: true, neverError: true, text, batch, timeout,
    }, { ...(notes ? { notes } : {}), ...extra });
  }
  respond(name, pos) {
    return this.add({
      name, type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1, position: pos,
      parameters: {
        respondWith: "json", responseBody: "={{ JSON.stringify($json.body ?? {}) }}",
        options: { responseCode: "={{ $json.status || 200 }}" },
      },
    });
  }
  aiAgent(name, pos, { text, system, schema }) {
    this.add({
      name, type: "@n8n/n8n-nodes-langchain.agent", typeVersion: 1.7, position: pos,
      parameters: { promptType: "define", text, hasOutputParser: true, options: { systemMessage: system } },
      onError: "continueRegularOutput",
      notes: "onError continueRegularOutput: a malformed model output must not stop the workflow (reference lesson). The next Code node treats it as no answer.",
    });
    const model = this.add({
      name: `${name} - OpenAI model`, type: "@n8n/n8n-nodes-langchain.lmChatOpenAi", typeVersion: 1.3,
      position: [pos[0] - 80, pos[1] + 220], credentials: CRED.openai,
      parameters: { model: { __rl: true, mode: "list", value: "gpt-5-mini" }, options: {} },
    });
    const parser = this.add({
      name: `${name} - output format`, type: "@n8n/n8n-nodes-langchain.outputParserStructured", typeVersion: 1.2,
      position: [pos[0] + 120, pos[1] + 220],
      parameters: { schemaType: "manual", inputSchema: JSON.stringify(schema, null, 2) },
    });
    this.connect(model, name, 0, "ai_languageModel");
    this.connect(parser, name, 0, "ai_outputParser");
    return name;
  }
  slack(name, pos, textExpr) {
    return this.add({
      name, type: "n8n-nodes-base.slack", typeVersion: 2.2, position: pos, credentials: CRED.slack,
      parameters: {
        select: "channel",
        channelId: { __rl: true, value: "={{ $('Config').first().json.SLACK_CHANNEL }}", mode: "name" },
        text: textExpr, otherOptions: { includeLinkToWorkflow: false },
      },
      onError: "continueRegularOutput",
      notes: "Optional. Needs the 'FF Slack' credential and SLACK_CHANNEL in Config; a Slack failure never stops the workflow.",
    });
  }
  toJSON(settings = {}) {
    const names = new Set(this.nodes.map((n) => n.name));
    for (const [from, types] of Object.entries(this.connections)) {
      if (!names.has(from)) throw new Error(`${this.name}: connection from unknown node ${from}`);
      for (const outs of Object.values(types)) for (const o of outs) for (const t of o) {
        if (!names.has(t.node)) throw new Error(`${this.name}: connection to unknown node ${t.node}`);
      }
    }
    return {
      name: this.name, nodes: this.nodes, connections: this.connections,
      settings: { executionOrder: "v1", saveDataSuccessExecution: "none", saveDataErrorExecution: "all", saveManualExecutions: true, ...settings },
      active: false, tags: [],
    };
  }
}

// ------------------------------------------------------------------ shared pieces
const whoami = JSON.parse(readFileSync(join(n8nDir, "ff-whoami.json"), "utf8"));
const AUTH_NAMES = ["Auth: read token", "Auth: verify token", "Auth: load profile", "Auth: check role", "Auth: allowed?", "Respond: denied"];

function configCode(doc, settings) {
  return `// ${doc}
// Non-secret settings. Secrets are n8n credentials (see the workflow notes);
// the Supabase service role key is only in "FF Supabase (service role)".
const SETTINGS = ${JSON.stringify(settings, null, 2)};

const src = $input.first().json || {};
return [{ json: { ...SETTINGS, body: src.body && typeof src.body === 'object' ? src.body : {} } }];
`;
}

// Webhook -> Config -> Auth check block. Returns the node to wire the allowed path from.
function webhookFront(wf, { path, doc, roles, settings = {}, y = 300 }) {
  wf.add({
    name: "Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, y], webhookId: wf.name,
    parameters: { httpMethod: "POST", path, responseMode: "responseNode", options: { allowedOrigins: "http://localhost:5173" } },
    notes: "responseMode is explicitly responseNode (reference lesson: unset means an instant 'Workflow was started'). Set allowedOrigins to the Netlify URL.",
  });
  wf.inline("Config", configCode(doc, {
    SUPABASE_URL: "https://SET-ME.supabase.co", SUPABASE_ANON_KEY: "SET-ME", ALLOWED_ROLES: roles, ...settings,
  }), [220, y], { notes: "Set SUPABASE_URL and SUPABASE_ANON_KEY after import." });
  AUTH_NAMES.forEach((name, i) => {
    const copy = JSON.parse(JSON.stringify(whoami.nodes.find((n) => n.name === name)));
    delete copy.id;
    copy.position = name === "Respond: denied" ? [440 + 4 * 220, y + 200] : [440 + i * 220, y];
    wf.add(copy);
  });
  wf.chain("Webhook", "Config", ...AUTH_NAMES.slice(0, 5));
  wf.connect("Auth: allowed?", "Respond: denied", 1);
  return "Auth: allowed?";
}

// Validate node + IF valid + generic Respond for the invalid branch.
function validated(wf, after, { workflow, file = "validate.js", name = "Validate input", pos, respondName = "Respond" }) {
  wf.code(name, workflow, file, pos);
  wf.if(`${name} ok?`, "$json.valid === true", [pos[0] + 220, pos[1]]);
  wf.connect(after, name, 0);
  wf.connect(name, `${name} ok?`);
  if (!wf.nodes.some((n) => n.name === respondName)) wf.respond(respondName, [pos[0] + 440, pos[1] + 260]);
  wf.connect(`${name} ok?`, respondName, 1);
  return `${name} ok?`;
}

const uuidOrZero = (expr) => `{{ /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(${expr} || '')) ? ${expr} : '${ZERO_UUID}' }}`;
const customerOrZero = (expr) => `{{ /^[0-9]{10}$/.test(String(${expr} || '').replace(/-/g, '')) ? String(${expr}).replace(/-/g, '') : '0000000000' }}`;
const P = (col, row) => [col * 220, row * 200];

const STYLE = "Write in a calm, plain, respectful tone - these are funeral homes and cremation providers. Use plain hyphens (-), never long dashes, and no emoji. Never write personal names of families or of people who have died; if the text you were given contains [name], keep it as [name]. Only use the numbers you were given; never invent data.";
const ACTION_RULES = `proposed_action must be null UNLESS one of exactly these three changes is clearly wanted:
- "update_daily_budget": set the daily budget to a specific amount in the account currency. daily_budget is required and must be a plain number. If no amount is clear, ask a short clarifying question and leave proposed_action null.
- "pause_campaign": pause the campaign.
- "resume_campaign": resume a paused campaign.
For pause_campaign and resume_campaign set daily_budget to null. Always add a one-sentence reason. Never say a change has been made - say it is ready for Rob to confirm (only Rob can apply changes). Anything else (targeting, keywords, ad copy, questions) gets proposed_action: null and a normal answer.`;
const ACTION_SCHEMA = {
  type: ["object", "null"],
  properties: {
    action_type: { type: "string", enum: ["update_daily_budget", "pause_campaign", "resume_campaign"] },
    daily_budget: { type: ["number", "null"] },
    reason: { type: "string" },
  },
  required: ["action_type", "daily_budget", "reason"],
};

// ================================================================== ff-sync
function buildSync() {
  const W = "ff-sync";
  const wf = new Workflow(W);
  wf.add({
    name: "Schedule: daily 06:00", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: P(0, 0),
    parameters: { rule: { interval: [{ triggerAtHour: 6 }] } },
    notes: "Daily sync, 30-day window, in the workflow time zone (Workflow settings > Timezone).",
  });
  wf.add({
    name: "Schedule: weekly Sunday 07:00", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: P(0, 1),
    parameters: { rule: { interval: [{ field: "weeks", triggerAtDay: [0], triggerAtHour: 7 }] } },
    notes: "Weekly 90-day reconcile: conversions keep arriving for up to 90 days after the click.",
  });
  wf.inline("Trigger: daily", "return [{ json: { ff_trigger: 'schedule', mode: 'daily' } }];", P(1, 0));
  wf.inline("Trigger: weekly", "return [{ json: { ff_trigger: 'schedule_weekly', mode: 'weekly' } }];", P(1, 1));
  wf.add({
    name: "Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2, position: P(0, 2), webhookId: "ff-sync-now",
    parameters: { httpMethod: "POST", path: "ff/sync-now", responseMode: "responseNode", options: { allowedOrigins: "http://localhost:5173" } },
    notes: "Sync Now. responseMode responseNode: the Auth check block answers 401/403, otherwise 'Respond: accepted' answers 202 and the sync carries on.",
  });
  wf.code("Config", W, "config.js", P(2, 1), { notes: "Set SUPABASE_URL and SUPABASE_ANON_KEY (and SLACK_CHANNEL if wanted) after import. The MCC id is entered on the dashboard Settings page." });
  wf.if("Manual run?", "$('Config').first().json.trigger === 'manual'", P(3, 1));
  AUTH_NAMES.forEach((name, i) => {
    const copy = JSON.parse(JSON.stringify(whoami.nodes.find((n) => n.name === name)));
    delete copy.id;
    copy.position = name === "Respond: denied" ? P(8, 3) : P(4 + i, 2);
    wf.add(copy);
  });
  wf.add({
    name: "Respond: accepted", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1, position: P(9, 2),
    parameters: {
      respondWith: "json",
      responseBody: "={{ JSON.stringify({ status: 'started', message: 'Sync started. The dashboard updates when it finishes.' }) }}",
      options: { responseCode: 202 },
    },
  });

  wf.sb("Start sync run", P(10, 1), "POST", "sync_runs", {}, {
    prefer: "return=representation",
    body: "={{ JSON.stringify({ trigger: $('Config').first().json.trigger, requested_by: $('Config').first().json.trigger === 'manual' ? $('Auth: check role').first().json.user.user_id : null }) }}",
  });
  wf.googleSecrets("Get Google Ads secrets", P(10, 0));
  wf.googleToken("Refresh Google token", P(11, 1));
  wf.googleAds("Get MCC accounts", P(12, 1), {
    url: `=https://googleads.googleapis.com/${API_V}/customers/{{ $('Get Google Ads secrets').first().json.mcc_id || '0000000000' }}/googleAds:searchStream`,
    body: "={{ JSON.stringify({ query: \"SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.status, customer_client.manager, customer_client.level, customer_client.test_account FROM customer_client WHERE customer_client.manager = false\" }) }}",
    token: "Refresh Google token", login: "$('Get Google Ads secrets').first().json.mcc_id", text: true,
    notes: "Asks the MCC which client accounts it manages. Read only.",
  });
  wf.code("Build account upserts", W, "build-account-upserts.js", P(13, 1));
  wf.sb("Upsert accounts", P(14, 1), "POST", "ad_accounts?on_conflict=customer_id",
    { notes: "Upsert on customer_id. client_id is never sent, so assignments by FF staff are kept. New accounts land as Unassigned." },
    { prefer: "resolution=merge-duplicates,return=minimal", body: "={{ JSON.stringify($json.rows) }}", full: true, neverError: true });
  wf.sb("Create clients for new accounts", P(14, 0), "POST", "rpc/ff_auto_create_clients",
    { executeOnce: true, notes: "Every Google Ads account is a client: an account with no client gets one, named after the account (closed accounts are archived)." },
    { body: "={}", full: true, neverError: true });
  wf.sb("Get accounts to sync", P(15, 1), "GET",
    "ad_accounts?select=customer_id,login_customer_id,time_zone,first_synced_at,clients(towns,own_brand_terms,competitor_terms)&sync_enabled=eq.true&is_manager=eq.false&or=(status.is.null,status.eq.ENABLED)&order=customer_id{{ $('Config').first().json.only_customer_id ? '&customer_id=eq.' + $('Config').first().json.only_customer_id : '' }}",
    { alwaysOutputData: true, notes: "alwaysOutputData: an empty table must not halt the workflow (reference lesson)." });
  wf.code("Prepare account list", W, "prepare-accounts.js", P(16, 1));
  wf.if("Any accounts?", "!$json.none", P(17, 1));
  wf.add({
    name: "Loop over accounts", type: "n8n-nodes-base.splitInBatches", typeVersion: 3, position: P(18, 1),
    parameters: { batchSize: 1, options: {} },
    notes: "One account per pass, so $('Loop over accounts').first() is always the current account. One account failing does not stop the others.",
  });

  // Loop body
  wf.googleToken("Account: refresh token", P(18, 3));
  wf.code("Account: build queries", W, "build-queries.js", P(19, 3));
  wf.googleAds("Google Ads search", P(20, 3), {
    url: `=https://googleads.googleapis.com/${API_V}/customers/{{ $json.customer_id }}/googleAds:searchStream`,
    body: "={{ JSON.stringify({ query: $json.gaql }) }}", token: "Account: refresh token", login: "$json.login_customer_id",
    text: true, batch: 250, timeout: 300000,
    notes: "One searchStream call per query, 250 ms apart. Text response so n8n does not split the JSON array. Read only.",
    extra: { onError: "continueRegularOutput" },
  });
  wf.code("Map and plan writes", W, "map-and-plan.js", P(21, 3), {
    notes: "Maps rows, applies the search term name filter, merges duplicate keys, chunks upserts. Matches responses to queries with itemMatching().",
  });
  wf.sb("Write rows", P(22, 3), "POST", "{{ $json.table }}?on_conflict={{ $json.on_conflict }}",
    { onError: "continueRegularOutput", notes: "PostgREST upsert on the natural key (replaces the reference's delete-then-create)." },
    { prefer: "resolution=merge-duplicates,return=minimal", body: "={{ JSON.stringify($json.rows) }}", full: true, neverError: true });
  wf.code("Finish account", W, "finish-account.js", P(23, 3));
  wf.sbGeneric("Account cleanup", P(24, 3), "rest/v1/", "Soft-remove (removed_at), recommendation open/expired, the account's sync result, last_synced_at.");

  // After the loop
  wf.sb("Load run results", P(18, 5), "GET", "sync_run_accounts?select=customer_id,status&sync_run_id=eq.{{ $('Start sync run').first().json.id }}",
    { alwaysOutputData: true, executeOnce: true });
  wf.code("Summarize run", W, "summarize-run.js", P(19, 5), { executeOnce: true });
  wf.sb("Close sync run", P(20, 5), "PATCH", "sync_runs?id=eq.{{ $json.sync_run_id }}", {},
    { prefer: "return=minimal", body: "={{ JSON.stringify($json.patch) }}", full: true, neverError: true });
  wf.sb("Get missing geo names", P(21, 5), "POST", "rpc/ff_missing_geo_targets", { alwaysOutputData: true, executeOnce: true },
    { body: "={{ JSON.stringify({ p_limit: 500 }) }}" });
  wf.code("Build geo query", W, "build-geo-query.js", P(22, 5), { executeOnce: true });
  wf.if("Geo lookup needed?", "!$json.skip", P(23, 5));
  wf.googleToken("Refresh token (geo)", P(24, 4));
  wf.googleAds("Search geo names", P(25, 4), {
    url: `=https://googleads.googleapis.com/${API_V}/customers/{{ $('Build geo query').first().json.customer_id }}/googleAds:searchStream`,
    body: "={{ JSON.stringify({ query: $('Build geo query').first().json.gaql }) }}",
    token: "Refresh token (geo)", login: "$('Build geo query').first().json.login_customer_id", text: true,
  });
  wf.code("Map geo names", W, "map-geo.js", P(26, 4));
  wf.sb("Upsert geo names", P(27, 4), "POST", "geo_targets?on_conflict=geo_target_constant", {},
    { prefer: "resolution=merge-duplicates,return=minimal", body: "={{ JSON.stringify($json.rows) }}", full: true, neverError: true });
  wf.add({ name: "After geo", type: "n8n-nodes-base.noOp", typeVersion: 1, position: P(28, 5), parameters: {} });

  // Slack note
  wf.sb("Get alerts", P(29, 5), "POST", "rpc/ff_sync_alerts", { alwaysOutputData: true, executeOnce: true },
    { body: "={{ JSON.stringify({ p_sync_run_id: $('Start sync run').first().json.id }) }}" });
  wf.code("Build Slack note", W, "build-slack.js", P(30, 5), { executeOnce: true });
  wf.if("Send Slack note?", "!$json.skip", P(31, 5));
  wf.slack("Send Slack note", P(32, 5), "={{ $json.text }}");

  // Proactive AI suggestions (reference sync-metrics "Suggest")
  wf.sb("Get suggestion candidates", P(29, 7), "POST", "rpc/ff_suggestion_candidates", { alwaysOutputData: true, executeOnce: true },
    { body: "={{ JSON.stringify({ p_sync_run_id: $('Start sync run').first().json.id }) }}" });
  wf.code("Prepare suggestion inputs", W, "prepare-suggestion-inputs.js", P(30, 7));
  wf.if("Anything to review?", "!$json.skip", P(31, 7));
  wf.aiAgent("Suggest (AI Agent)", P(32, 7), {
    text: "=Campaign: {{ $json.campaign_name }} (status {{ $json.status }}, daily budget {{ $json.daily_budget }} {{ $json.currency }}).\nLatest day ({{ $json.last_day }}): cost {{ $json.day_cost }} {{ $json.currency }}, {{ $json.day_clicks }} clicks, {{ $json.day_conversions }} conversions.\nLast 30 days: cost {{ $json.cost_30d }} {{ $json.currency }}, {{ $json.clicks_30d }} clicks, {{ $json.conversions_30d }} conversions (value {{ $json.conv_value_30d }}), search impression share {{ $json.search_is_30d }}, lost to budget {{ $json.budget_lost_is_30d }}.\nOpen Google recommendations: {{ $json.recommendations }}",
    system: `You review one Google Ads campaign for Funeral Futurist (FF), an agency for funeral homes and cremation providers, right after the daily data sync. Nobody asked a question. Decide whether there is a genuinely useful, specific suggestion worth posting in the campaign's assistant thread now - for example real spend with no conversions, a budget that clearly limits a campaign that converts, or a Google recommendation with real impact. Be conservative: set should_post to false unless something clearly stands out. A missed suggestion is far better than noise FF starts ignoring.\n\n${STYLE}\n\n${ACTION_RULES}`,
    schema: {
      type: "object",
      properties: { should_post: { type: "boolean" }, message: { type: "string" }, proposed_action: ACTION_SCHEMA },
      required: ["should_post", "message", "proposed_action"],
    },
  });
  wf.code("Prepare suggestions", W, "prepare-suggestions.js", P(33, 7));
  wf.if("Post suggestions?", "$json.count > 0", P(34, 7));
  wf.sb("Post suggestions", P(35, 7), "POST", "campaign_chat_messages", {},
    { prefer: "return=minimal", body: "={{ JSON.stringify($json.rows) }}", full: true, neverError: true });

  // Wiring
  wf.chain("Schedule: daily 06:00", "Trigger: daily", "Config");
  wf.chain("Schedule: weekly Sunday 07:00", "Trigger: weekly", "Config");
  wf.connect("Webhook", "Config");
  wf.connect("Config", "Manual run?");
  wf.connect("Manual run?", "Auth: read token", 0);
  wf.connect("Manual run?", "Start sync run", 1);
  wf.chain(...AUTH_NAMES.slice(0, 5));
  wf.connect("Auth: allowed?", "Respond: accepted", 0);
  wf.connect("Auth: allowed?", "Respond: denied", 1);
  wf.connect("Respond: accepted", "Start sync run");
  wf.chain("Start sync run", "Get Google Ads secrets", "Refresh Google token", "Get MCC accounts", "Build account upserts", "Upsert accounts",
    "Create clients for new accounts", "Get accounts to sync", "Prepare account list", "Any accounts?");
  wf.connect("Any accounts?", "Loop over accounts", 0);
  wf.connect("Any accounts?", "Load run results", 1);
  wf.connect("Loop over accounts", "Load run results", 0);
  wf.connect("Loop over accounts", "Account: refresh token", 1);
  wf.chain("Account: refresh token", "Account: build queries", "Google Ads search", "Map and plan writes", "Write rows",
    "Finish account", "Account cleanup", "Loop over accounts");
  wf.chain("Load run results", "Summarize run", "Close sync run", "Get missing geo names", "Build geo query", "Geo lookup needed?");
  wf.connect("Geo lookup needed?", "Refresh token (geo)", 0);
  wf.connect("Geo lookup needed?", "After geo", 1);
  wf.chain("Refresh token (geo)", "Search geo names", "Map geo names", "Upsert geo names", "After geo");
  wf.connect("After geo", "Get alerts");
  wf.connect("After geo", "Get suggestion candidates");

  // PDF task 6: on the first business day of the month, remind Rob that last
  // month's case lists are due (Slack, scheduled daily run only).
  wf.sb("Get clients (case lists)", P(29, 8), "GET", "clients?select=name&archived_at=is.null&order=name", { alwaysOutputData: true, executeOnce: true });
  wf.code("Case list reminder", "ff-sync", "case-list-reminder.js", P(30, 8), { executeOnce: true });
  wf.if("Send case list reminder?", "!$json.skip", P(31, 8));
  wf.slack("Send case list reminder", P(32, 8), "={{ $json.text }}");
  wf.connect("After geo", "Get clients (case lists)");
  wf.chain("Get clients (case lists)", "Case list reminder", "Send case list reminder?");
  wf.connect("Send case list reminder?", "Send case list reminder", 0);
  wf.chain("Get alerts", "Build Slack note", "Send Slack note?");
  wf.connect("Send Slack note?", "Send Slack note", 0);
  wf.chain("Get suggestion candidates", "Prepare suggestion inputs", "Anything to review?");
  wf.connect("Anything to review?", "Suggest (AI Agent)", 0);
  wf.chain("Suggest (AI Agent)", "Prepare suggestions", "Post suggestions?");
  wf.connect("Post suggestions?", "Post suggestions", 0);
  return wf.toJSON();
}

// ================================================================== ff-geo-target-suggest
function buildGeo() {
  const W = "ff-geo-target-suggest";
  const wf = new Workflow(W);
  const allowed = webhookFront(wf, {
    path: "ff/geo-target-suggest", roles: AGENCY, settings: { GOOGLE_ADS_API_VERSION: "v25" },
    doc: "ff-geo-target-suggest: location autocomplete for the campaign builder (reference geo-target-suggest). Read only.",
  });
  const ok = validated(wf, allowed, { workflow: W, pos: P(8, 1) });
  wf.googleSecrets("Get Google Ads secrets", P(10, 0));
  wf.googleToken("Refresh Google token", P(10, 1));
  wf.googleAds("Suggest locations", P(11, 1), {
    url: `=https://googleads.googleapis.com/${API_V}/geoTargetConstants:suggest`,
    body: "={{ JSON.stringify(Object.assign({ locationNames: { names: [$('Validate input').first().json.query] }, locale: 'en' }, $('Validate input').first().json.country ? { countryCode: $('Validate input').first().json.country } : {})) }}",
    token: "Refresh Google token", login: "null",
    notes: "geoTargetConstants:suggest is global - no customer id and no login-customer-id.",
  });
  wf.code("Format suggestions", W, "format.js", P(12, 1));
  wf.connect(ok, "Get Google Ads secrets", 0);
  wf.chain("Get Google Ads secrets", "Refresh Google token", "Suggest locations", "Format suggestions", "Respond");
  return wf.toJSON();
}

// ================================================================== ff-campaign-chat
function buildChat() {
  const W = "ff-campaign-chat";
  const wf = new Workflow(W);
  const allowed = webhookFront(wf, {
    path: "ff/campaign-chat", roles: AGENCY,
    doc: "ff-campaign-chat: the Campaign Assistant (reference campaign-chat), plus reset / delete / dismiss so the dashboard never writes chat rows itself.",
  });
  const ok = validated(wf, allowed, { workflow: W, pos: P(8, 1) });
  wf.sb("Get campaign", P(10, 1), "GET", "campaigns?id=eq.{{ $json.campaign_row_id }}&select=customer_id,campaign_id,name,removed_at", { alwaysOutputData: true });
  wf.code("Route", W, "route.js", P(11, 1));
  wf.if("Send message?", "$json.route === 'send'", P(12, 1));
  wf.if("Chat write?", "$json.route === 'write'", P(13, 3));
  wf.sbGeneric("Chat write", P(14, 3));
  wf.inline("Write result", "const r = $input.first().json || {};\nconst ok = r.statusCode >= 200 && r.statusCode < 300;\nreturn [{ json: ok ? { status: 200, body: { ok: true } } : { status: 502, body: { error: 'The change could not be saved.' } } }];", P(15, 3));

  wf.sb("Save user message", P(13, 0), "POST", "campaign_chat_messages", {}, {
    prefer: "return=minimal",
    body: "={{ JSON.stringify({ customer_id: $json.customer_id, campaign_id: $json.campaign_id, role: 'user', content: $json.content, author_id: $json.author_id }) }}",
  });
  wf.sb("Get chat context", P(14, 0), "POST", "rpc/ff_chat_context", {},
    { body: "={{ JSON.stringify({ p_customer_id: $('Route').first().json.customer_id, p_campaign_id: $('Route').first().json.campaign_id }) }}" });
  wf.code("Build AI context", W, "build-context.js", P(15, 0));
  wf.aiAgent("Chat (AI Agent)", P(16, 0), {
    text: "=Campaign: {{ $json.campaignText }}\n{{ $json.perfText }}\n\nLast 7 days:\n{{ $json.last7Text }}\n\nOpen Google recommendations:\n{{ $json.recommendationsText }}\n\nTop search terms (last 30 days):\n{{ $json.searchTermsText }}\n\nKeywords: {{ $json.keywordsText }}\n\nRecent conversation:\n{{ $json.historyText }}\n\nFF staff's new message:\n{{ $json.userMessage }}",
    system: `You are the Campaign Assistant inside Funeral Futurist's (FF) Google Ads dashboard. FF manages Google Ads for funeral homes and cremation providers. You are talking to FF staff, not the end client: be direct and specific, cite the real numbers given, and give concrete next steps. The SOP: Search campaigns only, phrase/exact keywords only, presence-only location targeting, calls of 90 seconds or more and preplanning forms are the conversions that matter.\n\n${STYLE}\n\n${ACTION_RULES}`,
    schema: { type: "object", properties: { reply: { type: "string" }, proposed_action: ACTION_SCHEMA }, required: ["reply", "proposed_action"] },
  });
  wf.code("Prepare assistant message", W, "prepare-reply.js", P(17, 0));
  wf.sb("Save assistant message", P(18, 0), "POST", "campaign_chat_messages", {},
    { prefer: "return=representation", body: "={{ JSON.stringify($json) }}" });
  wf.inline("Chat reply", "return [{ json: { status: 200, body: { message: $input.first().json } } }];", P(19, 0));

  wf.connect(ok, "Get campaign", 0);
  wf.chain("Get campaign", "Route", "Send message?");
  wf.connect("Send message?", "Save user message", 0);
  wf.connect("Send message?", "Chat write?", 1);
  wf.connect("Chat write?", "Chat write", 0);
  wf.connect("Chat write?", "Respond", 1);
  wf.chain("Chat write", "Write result", "Respond");
  wf.chain("Save user message", "Get chat context", "Build AI context", "Chat (AI Agent)", "Prepare assistant message",
    "Save assistant message", "Chat reply", "Respond");
  return wf.toJSON();
}

// ================================================================== ff-client-message
function buildClientMessage() {
  const W = "ff-client-message";
  const wf = new Workflow(W);
  const allowed = webhookFront(wf, {
    path: "ff/client-message", roles: ALL_ROLES, settings: { SLACK_CHANNEL: "" },
    doc: "ff-client-message: a client (or FF on their behalf) posts a suggestion; AI drafts a reply for FF to review (reference client-message-to-draft).",
  });
  wf.sb("Get campaign", P(8, 1), "GET",
    `campaigns?id=eq.${uuidOrZero("$('Config').first().json.body.campaign_row_id")}&select=customer_id,campaign_id,name,ad_accounts(client_id)`,
    { alwaysOutputData: true });
  wf.connect(allowed, "Get campaign", 0);
  const ok = validated(wf, "Get campaign", { workflow: W, pos: P(9, 1) });
  wf.sb("Save message", P(11, 1), "POST", "client_messages", {},
    { prefer: "return=representation", body: "={{ JSON.stringify($json.row) }}" });
  wf.sb("Get message context", P(12, 1), "POST", "rpc/ff_message_context", {},
    { body: "={{ JSON.stringify({ p_client_id: $json.client_id, p_customer_id: $json.customer_id, p_campaign_id: $json.campaign_id }) }}" });
  wf.code("Build AI context", W, "build-context.js", P(13, 1));
  wf.aiAgent("Draft reply (AI Agent)", P(14, 1), {
    text: "=Client: {{ $json.clientName }}.\n{{ $json.campaignText }}\n\nClient's message:\n{{ $json.clientMessage }}",
    system: `You draft a reply from Funeral Futurist (FF), a Google Ads agency, to a message a funeral home or cremation client sent in the FF dashboard. FF staff will read and edit the draft before anything is sent. Be warm, brief and clear; do not promise anything; if the client asks for a change, say FF is reviewing it, not that it is done.\n\n${STYLE}\n\n${ACTION_RULES}`,
    schema: { type: "object", properties: { reply: { type: "string" }, proposed_action: ACTION_SCHEMA }, required: ["reply", "proposed_action"] },
  });
  wf.code("Prepare draft", W, "prepare-draft.js", P(15, 1));
  wf.sb("Save draft", P(16, 1), "POST", "message_drafts?on_conflict=message_id", {},
    { prefer: "resolution=merge-duplicates,return=minimal", body: "={{ JSON.stringify($json) }}" });
  wf.sb("Mark drafted", P(17, 1), "PATCH", "client_messages?id=eq.{{ $('Save message').first().json.id }}", {},
    { prefer: "return=minimal", body: "={{ JSON.stringify({ status: 'drafted' }) }}" });
  wf.inline("Message result", "return [{ json: { status: 200, body: { ok: true, id: $('Save message').first().json.id } } }];", P(18, 1));
  wf.if("Tell FF on Slack?", "Boolean($('Config').first().json.SLACK_CHANNEL)", P(20, 1));
  wf.slack("Notify FF", P(21, 1), "=New client suggestion - please review it in the dashboard (Client Suggestions).");

  wf.connect(ok, "Save message", 0);
  wf.chain("Save message", "Get message context", "Build AI context", "Draft reply (AI Agent)", "Prepare draft",
    "Save draft", "Mark drafted", "Message result", "Respond", "Tell FF on Slack?");
  wf.connect("Tell FF on Slack?", "Notify FF", 0);
  return wf.toJSON();
}

// ================================================================== ff-send-reply
function buildSendReply() {
  const W = "ff-send-reply";
  const wf = new Workflow(W);
  const allowed = webhookFront(wf, {
    path: "ff/send-reply", roles: AGENCY,
    doc: "ff-send-reply: FF sends the (edited) reply to a client suggestion (reference send-reply). Proposed changes are applied separately by Rob.",
  });
  wf.sb("Get message", P(8, 1), "GET",
    `client_messages?id=eq.${uuidOrZero("$('Config').first().json.body.message_id")}&select=id,client_id,customer_id,campaign_id,direction,status`,
    { alwaysOutputData: true });
  wf.connect(allowed, "Get message", 0);
  const ok = validated(wf, "Get message", { workflow: W, pos: P(9, 1) });
  wf.sb("Post reply", P(11, 1), "POST", "client_messages", {},
    { prefer: "return=representation", body: "={{ JSON.stringify($json.row) }}" });
  wf.sb("Mark answered", P(12, 1), "PATCH", "client_messages?id=eq.{{ $('Validate input').first().json.inbound_id }}", {},
    { prefer: "return=minimal", body: "={{ JSON.stringify({ status: 'answered' }) }}" });
  wf.inline("Reply result", "return [{ json: { status: 200, body: { ok: true, reply: $('Post reply').first().json } } }];", P(13, 1));
  wf.connect(ok, "Post reply", 0);
  wf.chain("Post reply", "Mark answered", "Reply result", "Respond");
  return wf.toJSON();
}

// ------------------------------------------------------------------ write workflows share this tail
function writeTail(wf, { records, recordsFile, workflow, pos }) {
  wf.code(records, workflow, recordsFile, pos);
  wf.sbGeneric("Save records", [pos[0] + 220, pos[1]], "rest/v1/", "write_log, plus the Supabase follow-up for a successful change.");
  wf.inline("Result", `return [{ json: $('${records}').first().json.respond }];`, [pos[0] + 440, pos[1]], { executeOnce: true });
  if (!wf.nodes.some((n) => n.name === "Respond")) wf.respond("Respond", [pos[0] + 660, pos[1]]);
  wf.chain(records, "Save records", "Result", "Respond");
}

const gadsCheck = (node, alsoOk = "") =>
  `${readFileSync(join(n8nDir, "src", "shared", "gads.js"), "utf8")}\nconst r = $input.first().json || {};\nconst already = ${alsoOk ? `JSON.stringify(r).includes('${alsoOk}')` : "false"};\nreturn [{ json: { ok: already || !gadsError(r), error: gadsError(r) } }];\n// checks: ${node}`;

// ================================================================== ff-apply-campaign-action
function buildApply() {
  const W = "ff-apply-campaign-action";
  const wf = new Workflow(W);
  const allowed = webhookFront(wf, {
    path: "ff/apply-campaign-action", roles: ["rob_admin"], settings: { GOOGLE_ADS_API_VERSION: "v25" },
    doc: "ff-apply-campaign-action: Confirm & Apply for a proposed budget / pause / resume (reference apply-campaign-action), adding negative keywords from the Search Terms tab (campaign or FF Universal Negatives list), and call tracking setup (90s call conversions, call reporting, account call asset). rob_admin only; test account or writes_enabled; validateOnly first; every attempt logged in write_log.",
  });
  const ok = validated(wf, allowed, { workflow: W, pos: P(8, 1) });
  wf.sb("Get action context", P(10, 1), "POST", "rpc/ff_action_context", {},
    { body: "={{ JSON.stringify({ p_source: $json.source, p_source_id: $json.source_id, p_customer_id: $json.customer_id || null }) }}" });
  wf.code("Plan change", W, "plan.js", P(11, 1));
  wf.if("Allowed?", "$json.ok === true", P(12, 1));
  wf.googleSecrets("Get Google Ads secrets", P(13, -1));
  wf.googleToken("Refresh Google token", P(13, 0));
  const mutateUrl = `=https://googleads.googleapis.com/${API_V}/customers/{{ $('Plan change').first().json.customer_id }}/{{ $('Plan change').first().json.url_suffix }}`;
  wf.googleAds("Validate change", P(14, 0), {
    url: mutateUrl, token: "Refresh Google token", login: "$('Plan change').first().json.login_customer_id",
    body: "={{ JSON.stringify(Object.assign({}, $('Plan change').first().json.mutate_body, { validateOnly: true })) }}",
    notes: "validateOnly: Google checks the change without making it.",
  });
  wf.inline("Check validation", gadsCheck("Validate change"), P(15, 0));
  wf.if("Valid?", "$json.ok === true", P(16, 0));
  wf.googleAds("Apply change", P(17, 0), {
    url: mutateUrl, token: "Refresh Google token", login: "$('Plan change').first().json.login_customer_id",
    body: "={{ JSON.stringify($('Plan change').first().json.mutate_body) }}",
    notes: "The real change. Only reached after the guards and a clean validateOnly call.",
  });
  writeTail(wf, { records: "Plan records", recordsFile: "records.js", workflow: W, pos: P(18, 1) });

  // Call tracking setup (source "tracking"): step A = account settings and the
  // 90-second call conversion actions (one item per request), step B = the
  // account-level call asset, built from step A's answer. Each step: validateOnly first.
  const plan = "$('Plan change').first().json";
  wf.if("Which change?", `${plan}.source === 'tracking'`, P(13, 2));
  wf.if("Tracking: step A?", `${plan}.tracking.requests_a.length > 0`, P(14, 3));
  wf.inline("Tracking: requests", `return ${plan}.tracking.requests_a.map((r) => ({ json: r }));`, P(15, 3), { executeOnce: true });
  const trackUrl = `=https://googleads.googleapis.com/${API_V}/customers/{{ $('Plan change').first().json.customer_id }}{{ $json.url_suffix }}`;
  wf.googleAds("Validate tracking", P(16, 3), {
    url: trackUrl, token: "Refresh Google token", login: "$('Plan change').first().json.login_customer_id",
    body: "={{ JSON.stringify(Object.assign({}, $json.body, { validateOnly: true })) }}",
    notes: "validateOnly for step A: account settings, then the call conversion actions. One call per item.",
  });
  wf.inline("Check tracking", `${readFileSync(join(n8nDir, "src", "shared", "gads.js"), "utf8")}\nconst errors = $input.all().map((i) => gadsError(i.json)).filter(Boolean);\nreturn [{ json: { ok: errors.length === 0, error: errors.join(' | ') || null } }];`, P(17, 3));
  wf.if("Tracking valid?", "$json.ok === true", P(18, 3));
  wf.inline("Tracking: real requests", `return $('Tracking: requests').all().map((i) => ({ json: i.json }));`, P(19, 3), { executeOnce: true });
  wf.googleAds("Apply tracking", P(20, 3), {
    url: trackUrl, token: "Refresh Google token", login: "$('Plan change').first().json.login_customer_id",
    body: "={{ JSON.stringify($json.body) }}",
    notes: "Step A for real, after a clean validateOnly.",
  });
  wf.code("Plan call asset", W, "plan-asset.js", P(21, 4), { executeOnce: true });
  wf.if("Call asset needed?", "$json.need === true", P(22, 4));
  const assetUrl = `=https://googleads.googleapis.com/${API_V}/customers/{{ $('Plan change').first().json.customer_id }}/googleAds:mutate`;
  wf.googleAds("Validate call asset", P(23, 4), {
    url: assetUrl, token: "Refresh Google token", login: "$('Plan change').first().json.login_customer_id",
    body: "={{ JSON.stringify(Object.assign({}, $json.body, { validateOnly: true })) }}",
    notes: "validateOnly for step B: the account-level call asset.",
  });
  wf.inline("Check call asset", gadsCheck("Validate call asset"), P(24, 4));
  wf.if("Call asset valid?", "$json.ok === true", P(25, 4));
  wf.googleAds("Apply call asset", P(26, 4), {
    url: assetUrl, token: "Refresh Google token", login: "$('Plan change').first().json.login_customer_id",
    body: "={{ JSON.stringify($('Plan call asset').first().json.body) }}",
    notes: "Step B for real: call asset on the whole account (every campaign, also future ones).",
  });

  wf.connect(ok, "Get action context", 0);
  wf.chain("Get action context", "Plan change", "Allowed?");
  wf.connect("Allowed?", "Get Google Ads secrets", 0);
  wf.connect("Allowed?", "Plan records", 1);
  wf.chain("Get Google Ads secrets", "Refresh Google token", "Which change?");
  wf.connect("Which change?", "Tracking: step A?", 0);
  wf.connect("Which change?", "Validate change", 1);
  wf.connect("Tracking: step A?", "Tracking: requests", 0);
  wf.connect("Tracking: step A?", "Plan call asset", 1);
  wf.chain("Tracking: requests", "Validate tracking", "Check tracking", "Tracking valid?");
  wf.connect("Tracking valid?", "Tracking: real requests", 0);
  wf.connect("Tracking valid?", "Plan records", 1);
  wf.chain("Tracking: real requests", "Apply tracking", "Plan call asset", "Call asset needed?");
  wf.connect("Call asset needed?", "Validate call asset", 0);
  wf.connect("Call asset needed?", "Plan records", 1);
  wf.chain("Validate call asset", "Check call asset", "Call asset valid?");
  wf.connect("Call asset valid?", "Apply call asset", 0);
  wf.connect("Call asset valid?", "Plan records", 1);
  wf.connect("Apply call asset", "Plan records");
  wf.chain("Validate change", "Check validation", "Valid?");
  wf.connect("Valid?", "Apply change", 0);
  wf.connect("Valid?", "Plan records", 1);
  wf.connect("Apply change", "Plan records");
  return wf.toJSON();
}

// ================================================================== ff-delete-campaign
function buildDelete() {
  const W = "ff-delete-campaign";
  const wf = new Workflow(W);
  const allowed = webhookFront(wf, {
    path: "ff/delete-campaign", roles: ["rob_admin"], settings: { GOOGLE_ADS_API_VERSION: "v25" },
    doc: "ff-delete-campaign: remove a campaign in Google Ads (reference delete-campaign). rob_admin only; test account or writes_enabled; validateOnly first; history kept (soft remove).",
  });
  wf.sb("Get campaign", P(8, 1), "GET",
    `campaigns?id=eq.${uuidOrZero("$('Config').first().json.body.campaign_row_id")}&select=customer_id,campaign_id,name,status,removed_at,ad_accounts(login_customer_id,is_test_account,clients(writes_enabled))`,
    { alwaysOutputData: true });
  wf.code("Plan removal", W, "plan.js", P(9, 1));
  wf.if("Allowed?", "$json.ok === true", P(10, 1));
  wf.googleSecrets("Get Google Ads secrets", P(11, -1));
  wf.googleToken("Refresh Google token", P(11, 0));
  const url = `=https://googleads.googleapis.com/${API_V}/customers/{{ $('Plan removal').first().json.customer_id }}/campaigns:mutate`;
  wf.googleAds("Validate removal", P(12, 0), {
    url, token: "Refresh Google token", login: "$('Plan removal').first().json.login_customer_id",
    body: "={{ JSON.stringify(Object.assign({}, $('Plan removal').first().json.mutate_body, { validateOnly: true })) }}",
  });
  wf.inline("Check validation", gadsCheck("Validate removal", "OPERATION_NOT_PERMITTED_FOR_REMOVED_RESOURCE"), P(13, 0));
  wf.if("Valid?", "$json.ok === true", P(14, 0));
  wf.googleAds("Remove campaign", P(15, 0), {
    url, token: "Refresh Google token", login: "$('Plan removal').first().json.login_customer_id",
    body: "={{ JSON.stringify($('Plan removal').first().json.mutate_body) }}",
    notes: "Google never hard-deletes: status becomes REMOVED. Already removed counts as done (reference lesson).",
  });
  writeTail(wf, { records: "Plan records", recordsFile: "records.js", workflow: W, pos: P(16, 1) });
  wf.connect(allowed, "Get campaign", 0);
  wf.chain("Get campaign", "Plan removal", "Allowed?");
  wf.connect("Allowed?", "Get Google Ads secrets", 0);
  wf.connect("Allowed?", "Plan records", 1);
  wf.chain("Get Google Ads secrets", "Refresh Google token", "Validate removal", "Check validation", "Valid?");
  wf.connect("Valid?", "Remove campaign", 0);
  wf.connect("Valid?", "Plan records", 1);
  wf.connect("Remove campaign", "Plan records");
  return wf.toJSON();
}

// ================================================================== ff-build-campaign
const FF_NEGATIVES = [
  // obituaries
  ["obituary", "BROAD"], ["obituaries", "BROAD"], ["obits", "BROAD"], ["condolences", "BROAD"], ["service times", "PHRASE"],
  // jobs
  ["careers", "BROAD"], ["jobs", "BROAD"], ["job", "BROAD"], ["salary", "BROAD"], ["hiring", "BROAD"],
  ["mortuary school", "PHRASE"], ["mortuary science", "PHRASE"], ["embalmer training", "PHRASE"],
  // products
  ["urns", "BROAD"], ["jewelry", "BROAD"], ["flowers", "BROAD"], ["caskets for sale", "PHRASE"],
  // writing
  ["poems", "BROAD"], ["poem", "BROAD"], ["eulogy", "BROAD"], ["eulogies", "BROAD"], ["quotes", "BROAD"], ["readings", "BROAD"],
  // free
  ["free", "BROAD"], ["body donation", "PHRASE"],
].map(([text, match_type]) => ({ text, match_type }));

function buildBuild() {
  const W = "ff-build-campaign";
  const wf = new Workflow(W);
  const allowed = webhookFront(wf, {
    path: "ff/build-campaign", roles: AGENCY,
    settings: { GOOGLE_ADS_API_VERSION: "v25", NEGATIVE_LIST_NAME: "FF - Funeral universal negatives", NEGATIVE_LIST: FF_NEGATIVES },
    doc: "ff-build-campaign: FF staff save campaign drafts; Rob builds them (reference build-campaign). Built PAUSED, search only, presence only, phrase/exact keywords, one atomic mutate, validateOnly first, logged in write_log. Competitor/client names for negatives come from the client record.",
  });
  wf.sb("Get account", P(8, 1), "GET",
    `ad_accounts?customer_id=eq.${customerOrZero("$('Config').first().json.body.customer_id")}&select=customer_id,client_id,is_test_account`,
    { alwaysOutputData: true });
  wf.connect(allowed, "Get account", 0);
  const ok = validated(wf, "Get account", { workflow: W, file: "route.js", name: "Route", pos: P(9, 1) });
  wf.if("Build now?", "$json.route === 'build'", P(11, 1));
  // draft writes
  wf.sbGeneric("Draft write", P(12, 3));
  wf.inline("Draft result", "const r = $input.first().json || {};\nconst route = $('Route').first().json;\nconst ok = r.statusCode >= 200 && r.statusCode < 300;\nconst row = Array.isArray(r.body) ? r.body[0] : null;\nif (!ok) return [{ json: { status: 502, body: { error: (r.body && r.body.message) || 'The draft could not be saved.' } } }];\nif (route.method !== 'DELETE' && !row) return [{ json: { status: 409, body: { error: 'This draft is already built or being built.' } } }];\nreturn [{ json: { status: 200, body: { ok: true, build: row, issues: route.issues || [] } } }];", P(13, 3));
  // build
  wf.sb("Get build context", P(12, 0), "POST", "rpc/ff_build_context", {}, { body: "={{ JSON.stringify({ p_build_id: $json.build_id }) }}" });
  wf.code("Plan build", W, "plan-build.js", P(13, 0));
  wf.if("Allowed?", "$json.ok === true", P(14, 0));
  wf.sb("Mark building", P(15, -1), "PATCH", "campaign_builds?id=eq.{{ $json.build_id }}", {},
    { prefer: "return=minimal", body: "={{ JSON.stringify({ status: 'building', error: null }) }}" });
  wf.googleSecrets("Get Google Ads secrets", P(16, -2));
  wf.googleToken("Refresh Google token", P(16, -1));
  wf.googleAds("Find FF negative list", P(17, -1), {
    url: `=https://googleads.googleapis.com/${API_V}/customers/{{ $('Plan build').first().json.customer_id }}/googleAds:searchStream`,
    body: "={{ JSON.stringify({ query: \"SELECT shared_set.resource_name, shared_set.name FROM shared_set WHERE shared_set.type = 'NEGATIVE_KEYWORDS' AND shared_set.status = 'ENABLED' AND shared_set.name IN ('\" + $('Config').first().json.NEGATIVE_LIST_NAME + \"', 'FF Universal Negatives')\" }) }}",
    token: "Refresh Google token", login: "$('Plan build').first().json.login_customer_id", text: true,
    notes: "Reuse the account's blocked-words list if it exists (new or old name).",
  });
  wf.sb("Get blocked words", P(17, -2), "GET", "universal_negatives?select=text,match_type,theme&order=theme,text",
    { alwaysOutputData: true, executeOnce: true, notes: "The FF blocked-words list (Supabase universal_negatives), used when the account has no list yet." });
  wf.code("Build operations", W, "build-operations.js", P(18, -1));
  const url = `=https://googleads.googleapis.com/${API_V}/customers/{{ $('Plan build').first().json.customer_id }}/googleAds:mutate`;
  wf.googleAds("Validate build", P(19, -1), {
    url, token: "Refresh Google token", login: "$('Plan build').first().json.login_customer_id",
    body: "={{ JSON.stringify(Object.assign({}, $('Build operations').first().json.body, { validateOnly: true })) }}",
    notes: "validateOnly: Google checks the whole build without creating anything.",
  });
  wf.inline("Check validation", gadsCheck("Validate build"), P(20, -1));
  wf.if("Valid?", "$json.ok === true", P(21, -1));
  wf.googleAds("Create campaign", P(22, -1), {
    url, token: "Refresh Google token", login: "$('Plan build').first().json.login_customer_id",
    body: "={{ JSON.stringify($('Build operations').first().json.body) }}",
    notes: "One atomic GoogleAdsService.Mutate: all or nothing. Everything PAUSED.",
  });
  writeTail(wf, { records: "Plan records", recordsFile: "records.js", workflow: W, pos: P(23, 1) });

  wf.connect(ok, "Build now?", 0);
  wf.connect("Build now?", "Get build context", 0);
  wf.connect("Build now?", "Draft write", 1);
  wf.chain("Draft write", "Draft result", "Respond");
  wf.chain("Get build context", "Plan build", "Allowed?");
  wf.connect("Allowed?", "Mark building", 0);
  wf.connect("Allowed?", "Plan records", 1);
  wf.chain("Mark building", "Get Google Ads secrets", "Refresh Google token", "Find FF negative list", "Get blocked words", "Build operations", "Validate build", "Check validation", "Valid?");
  wf.connect("Valid?", "Create campaign", 0);
  wf.connect("Valid?", "Plan records", 1);
  wf.connect("Create campaign", "Plan records");
  return wf.toJSON();
}

// ================================================================== ff-client-admin
function buildClientAdmin() {
  const W = "ff-client-admin";
  const wf = new Workflow(W);
  const allowed = webhookFront(wf, {
    path: "ff/client-admin", roles: AGENCY,
    doc: "ff-client-admin: clients, account assignment and logins (Supabase Auth Admin API). FF staff manage client logins; only Rob manages staff logins and the Google Ads write switch.",
  });
  wf.sb("Load target login", P(8, 1), "GET",
    `profiles?user_id=eq.${uuidOrZero("$('Config').first().json.body.user_id")}&select=user_id,email,role,client_id,disabled`,
    { alwaysOutputData: true });
  wf.connect(allowed, "Load target login", 0);
  const ok = validated(wf, "Load target login", { workflow: W, file: "plan.js", name: "Plan", pos: P(9, 1) });
  wf.if("Create login?", "$json.kind === 'create_login'", P(11, 1));
  // generic requests
  wf.sbGeneric("Run requests", P(12, 3), "", "Auth Admin API (auth/v1/admin/users) and PostgREST, both with the service role credential. One request at a time, in order (a new client row before its Google Ads account link).");
  wf.nodes.find((n) => n.name === "Run requests").parameters.options.batching = { batch: { batchSize: 1, batchInterval: 0 } };
  wf.code("Summarize", W, "summarize.js", P(13, 3));
  // create login
  wf.http("Create auth user", P(12, 0), {
    method: "POST", cred: "supabase", url: `=${SB}/auth/v1/admin/users`,
    jsonBody: "={{ JSON.stringify({ email: $json.email, password: $json.password, email_confirm: true }) }}", full: true, neverError: true,
  }, { notes: "Supabase Auth Admin API. The password is not stored anywhere else and is never returned." });
  wf.code("Check user", W, "check-user.js", P(13, 0));
  wf.if("User created?", "$json.ok === true", P(14, 0));
  wf.sb("Save profile", P(15, -1), "POST", "profiles", {}, {
    prefer: "return=minimal", full: true, neverError: true,
    body: "={{ JSON.stringify({ user_id: $('Check user').first().json.user_id, email: $('Plan').first().json.email, role: $('Plan').first().json.role, client_id: $('Plan').first().json.client_id, created_by: $('Auth: check role').first().json.user.user_id }) }}",
  });
  wf.code("Check profile", W, "check-profile.js", P(16, -1));
  wf.if("Profile saved?", "$json.ok === true", P(17, -1));
  wf.http("Remove auth user", P(18, 0), {
    method: "DELETE", cred: "supabase", url: `=${SB}/auth/v1/admin/users/{{ $json.user_id }}`, full: true, neverError: true,
  }, { notes: "Undo: no login may exist without a profile (role)." });
  wf.inline("Profile failed", "return [{ json: $('Check profile').first().json }];", P(19, 0));

  wf.connect(ok, "Create login?", 0);
  wf.connect("Create login?", "Create auth user", 0);
  wf.connect("Create login?", "Run requests", 1);
  wf.chain("Run requests", "Summarize", "Respond");
  wf.chain("Create auth user", "Check user", "User created?");
  wf.connect("User created?", "Save profile", 0);
  wf.connect("User created?", "Respond", 1);
  wf.chain("Save profile", "Check profile", "Profile saved?");
  wf.connect("Profile saved?", "Respond", 0);
  wf.connect("Profile saved?", "Remove auth user", 1);
  wf.chain("Remove auth user", "Profile failed", "Respond");
  // Passwords pass through this workflow: keep no execution data at all.
  return wf.toJSON({ saveDataErrorExecution: "none", saveManualExecutions: false });
}

// ================================================================== ff-review-actions
function buildReview() {
  const W = "ff-review-actions";
  const wf = new Workflow(W);
  const allowed = webhookFront(wf, {
    path: "ff/review-actions", roles: AGENCY,
    doc: "ff-review-actions: weekly search term triage (keep / block / ask Rob) and hiding Google recommendations on the dashboard. Supabase only - nothing changes in Google Ads.",
  });
  const ok = validated(wf, allowed, { workflow: W, pos: P(8, 1) });
  wf.sb("Get search term", P(10, 1), "GET",
    "search_term_daily?customer_id=eq.{{ $json.customer_id || '0000000000' }}&campaign_id=eq.{{ $json.campaign_id || '0' }}&term_hash=eq.{{ $json.term_hash || 'none' }}&select=search_term&limit=1",
    { alwaysOutputData: true });
  wf.code("Plan", W, "plan.js", P(11, 1));
  wf.if("Plan ok?", "$json.valid === true", P(12, 1));
  wf.sbGeneric("Save", P(13, 1));
  wf.inline("Save result", "const r = $input.first().json || {};\nconst ok = r.statusCode >= 200 && r.statusCode < 300;\nreturn [{ json: ok ? { status: 200, body: { ok: true, row: Array.isArray(r.body) ? r.body[0] ?? null : null } } : { status: 502, body: { error: (r.body && r.body.message) || 'Could not save.' } } }];", P(14, 1));
  wf.connect(ok, "Get search term", 0);
  wf.chain("Get search term", "Plan", "Plan ok?");
  wf.connect("Plan ok?", "Save", 0);
  wf.connect("Plan ok?", "Respond", 1);
  wf.chain("Save", "Save result", "Respond");
  return wf.toJSON();
}


// ================================================================== ff-case-match
// PDF task 6: monthly case match. The no-name case list comes from the
// dashboard, is matched by Google Ads (click ids, hashed email/phone, call
// details), and is never stored: this workflow keeps no execution data at all,
// and only counts go to case_match_runs. A Google Ads write workflow:
// validateOnly first, upload Rob only, test account or writes_enabled, logged.
function buildCaseMatch() {
  const W = "ff-case-match";
  const wf = new Workflow(W);
  const allowed = webhookFront(wf, {
    path: "ff/case-match", roles: AGENCY, settings: { GOOGLE_ADS_API_VERSION: "v25", GHL_COMPANY_ID: "SET-ME" },
    doc: "ff-case-match: monthly case match - check (FF staff or Rob, validateOnly) or upload (Rob) signed cases as offline conversions, from a no-name list or straight from the client's GHL won opportunities. Case lists are never stored; counts only.",
  });
  const ok = validated(wf, allowed, { workflow: W, pos: P(8, 1) });

  // source "ghl": read the month's won opportunities and their contacts from the
  // client's GHL sub-account (FF's one agency key -> a token per sub-account).
  wf.if("From GHL?", "$('Validate input').first().json.source === 'ghl'", P(9, 3));
  wf.sb("Get client GHL", P(10, 4), "GET", `clients?id=eq.${uuidOrZero("$('Validate input').first().json.client_id")}&select=ghl_location_id`, { alwaysOutputData: true });
  ghlLocationToken(wf, "GHL: location token", P(11, 4), "$('Get client GHL').first().json.ghl_location_id || 'none'");
  const loc = "{{ $('Get client GHL').first().json.ghl_location_id }}";
  wf.http("GHL: contact fields", P(12, 4), {
    method: "GET", url: `=${GHL_API}/locations/${loc}/customFields?model=contact`, headers: ghlAuthHeaders("GHL: location token"), full: true, neverError: true,
  }, { onError: "continueRegularOutput" });
  wf.http("GHL: won opportunities", P(13, 4), {
    method: "GET", url: `=${GHL_API}/opportunities/search?location_id=${loc}&status=won&limit=100`, headers: ghlAuthHeaders("GHL: location token"), full: true, neverError: true,
  }, { onError: "continueRegularOutput", notes: "Won = signed. Only ids, dates and values are used from the answer." });
  wf.code("GHL: won in month", W, "ghl-won.js", P(14, 4));
  wf.if("Won cases?", "!$json.none", P(15, 4));
  wf.http("GHL: get contacts", P(16, 5), {
    method: "GET", url: `=${GHL_API}/contacts/{{ $json.contact_id }}`, headers: ghlAuthHeaders("GHL: location token"), full: true, neverError: true, batch: 150,
  }, { onError: "continueRegularOutput", notes: "Phone, email and click ids of each signed family - kept only in this execution (no execution data is saved)." });
  wf.code("GHL: build cases", W, "ghl-cases.js", P(17, 4), { executeOnce: true });

  wf.sb("Get case match context", P(10, 1), "POST", "rpc/ff_case_match_context", {},
    { body: "={{ JSON.stringify({ p_client_id: $('Validate input').first().json.client_id, p_customer_id: $('Validate input').first().json.customer_id }) }}", });
  wf.sb("Get earlier uploads", P(11, 1), "GET",
    `case_match_runs?select=id,created_at&client_id=eq.${uuidOrZero("$('Validate input').first().json.client_id")}&month=eq.{{ $('Validate input').first().json.month }}-01&validate_only=eq.false&status=in.(ok,partial)&order=created_at.desc`,
    { alwaysOutputData: true, executeOnce: true });
  wf.code("Plan uploads", W, "plan.js", P(12, 1), { executeOnce: true });
  wf.if("Allowed?", "$json.ok === true", P(13, 1));
  wf.googleSecrets("Get Google Ads secrets", P(14, -1));
  wf.googleToken("Refresh Google token", P(14, 0));
  wf.inline("Upload requests", "const p = $('Plan uploads').first().json;\nreturn p.uploads.map((u) => ({ json: { kind: u.kind, url_suffix: u.url_suffix, sent: u.sent, body: u.body } }));", P(15, 0), { executeOnce: true });
  const url = `=https://googleads.googleapis.com/${API_V}/customers/{{ $('Plan uploads').first().json.customer_id }}{{ $json.url_suffix }}`;
  wf.googleAds("Check upload", P(16, 0), {
    url, token: "Refresh Google token", login: "$('Plan uploads').first().json.login_customer_id",
    body: "={{ JSON.stringify(Object.assign({}, $json.body, { validateOnly: true })) }}",
    notes: "validateOnly: Google checks every case without recording anything. One call per upload kind (click, call).",
  });
  wf.code("Check validation", W, "check.js", P(17, 0));
  wf.if("Upload now?", "$json.go === true", P(18, 0));
  wf.inline("Real upload requests", "return $('Upload requests').all().map((i) => ({ json: i.json }));", P(19, -1), { executeOnce: true });
  wf.googleAds("Upload conversions", P(20, -1), {
    url, token: "Refresh Google token", login: "$('Plan uploads').first().json.login_customer_id",
    body: "={{ JSON.stringify($json.body) }}",
    notes: "The real upload. Only reached for action upload (Rob), after the guards and a clean validateOnly call.",
  });
  wf.code("Case match records", W, "records.js", P(21, 1), { executeOnce: true });
  wf.sbGeneric("Save records", P(22, 1), "rest/v1/", "case_match_runs (counts only) and write_log (summaries only).");
  wf.inline("Result", "return [{ json: $('Case match records').first().json.respond }];", P(23, 1), { executeOnce: true });
  if (!wf.nodes.some((n) => n.name === "Respond")) wf.respond("Respond", P(24, 1));

  wf.connect(ok, "From GHL?", 0);
  wf.connect("From GHL?", "Get client GHL", 0);
  wf.connect("From GHL?", "Get case match context", 1);
  wf.chain("Get client GHL", "GHL: find agency");
  wf.chain("GHL: location token", "GHL: contact fields", "GHL: won opportunities", "GHL: won in month", "Won cases?");
  wf.connect("Won cases?", "GHL: get contacts", 0);
  wf.connect("Won cases?", "GHL: build cases", 1);
  wf.chain("GHL: get contacts", "GHL: build cases", "Get case match context");
  wf.chain("Get case match context", "Get earlier uploads", "Plan uploads", "Allowed?");
  wf.connect("Allowed?", "Get Google Ads secrets", 0);
  wf.connect("Allowed?", "Case match records", 1);
  wf.chain("Get Google Ads secrets", "Refresh Google token", "Upload requests", "Check upload", "Check validation", "Upload now?");
  wf.connect("Upload now?", "Real upload requests", 0);
  wf.connect("Upload now?", "Case match records", 1);
  wf.chain("Real upload requests", "Upload conversions", "Case match records", "Save records", "Result", "Respond");
  // The case list is personal data: keep nothing, not even failed executions.
  return wf.toJSON({ saveDataSuccessExecution: "none", saveDataErrorExecution: "none", saveManualExecutions: false, saveExecutionProgress: false });
}


// ================================================================== ff-gaql
// PDF task 1: Claude Code (scripts/ff.mjs gaql) and the FF team read Google Ads
// live with FF's credentials, without any secret on a laptop. Read only:
// googleAds:searchStream is the only Google Ads call. Search terms are
// name-filtered before they are returned; nothing is kept (no execution data).
function buildGaql() {
  const W = "ff-gaql";
  const wf = new Workflow(W);
  const allowed = webhookFront(wf, {
    path: "ff/gaql", roles: AGENCY, settings: { GOOGLE_ADS_API_VERSION: "v25" },
    doc: "ff-gaql: one read-only GAQL query against an FF Google Ads account (for Claude Code skills and FF staff). Read only.",
  });
  const ok = validated(wf, allowed, { workflow: W, pos: P(8, 1) });
  wf.sb("Get account", P(10, 1), "GET",
    `ad_accounts?customer_id=eq.${customerOrZero("$json.customer_id")}&select=customer_id,login_customer_id,descriptive_name,clients(towns,own_brand_terms,competitor_terms)`,
    { alwaysOutputData: true });
  wf.inline("Check account", "const a = $input.first().json || {};\nreturn [{ json: a.customer_id ? { ok: true } : { ok: false, status: 404, body: { error: 'That account is not in the dashboard. Run a sync first.' } } }];", P(11, 1));
  wf.if("Account ok?", "$json.ok === true", P(12, 1));
  wf.googleSecrets("Get Google Ads secrets", P(13, 0));
  wf.googleToken("Refresh Google token", P(14, 0));
  wf.googleAds("Run query", P(15, 0), {
    url: `=https://googleads.googleapis.com/${API_V}/customers/{{ $('Validate input').first().json.customer_id }}/googleAds:searchStream`,
    body: "={{ JSON.stringify({ query: $('Validate input').first().json.query }) }}",
    token: "Refresh Google token", login: "$('Get account').first().json.login_customer_id", text: true, timeout: 120000,
    notes: "Read only. Text response so n8n does not split the JSON array.",
  });
  wf.code("Shape result", W, "shape.js", P(16, 0));
  wf.connect(ok, "Get account", 0);
  wf.chain("Get account", "Check account", "Account ok?");
  wf.connect("Account ok?", "Get Google Ads secrets", 0);
  wf.connect("Account ok?", "Respond", 1);
  wf.chain("Get Google Ads secrets", "Refresh Google token", "Run query", "Shape result", "Respond");
  // Answers can hold raw search terms before the filter: keep no execution data.
  return wf.toJSON({ saveDataSuccessExecution: "none", saveDataErrorExecution: "none", saveManualExecutions: false });
}


// ================================================================== ff-search-triage
// PDF task 5, weekly part: sort new search terms into keep / block / ask Rob.
// FF blocked words and the client's own / competitor names first (rules), then
// the AI for the rest; unclear answers go to Rob. Decisions only - adding a
// negative keyword in Google Ads stays Rob's click (Search Terms tab).
function buildSearchTriage() {
  const W = "ff-search-triage";
  const wf = new Workflow(W);
  wf.add({
    name: "Schedule: daily 07:30", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: P(0, 0),
    parameters: { rule: { interval: [{ triggerAtHour: 7, triggerAtMinute: 30 }] } },
    notes: "Every day at 07:30, after the 06:00 sync: new search terms of the last 7 days (a decision is never changed once made). Workflow settings > Timezone: FF's time zone.",
  });
  wf.add({
    name: "Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2, position: P(0, 2), webhookId: "ff-search-triage",
    parameters: { httpMethod: "POST", path: "ff/search-triage", responseMode: "responseNode", options: { allowedOrigins: "http://localhost:5173" } },
    notes: "\"Sort new searches\" on the dashboard. Answers 202 at once; the sorting carries on.",
  });
  wf.code("Config", W, "config.js", P(1, 1), { notes: "Set SUPABASE_URL and SUPABASE_ANON_KEY after import." });
  wf.if("Manual run?", "$('Config').first().json.trigger === 'manual'", P(2, 1));
  AUTH_NAMES.forEach((name, i) => {
    const copy = JSON.parse(JSON.stringify(whoami.nodes.find((n) => n.name === name)));
    delete copy.id;
    copy.position = name === "Respond: denied" ? P(7, 3) : P(3 + i, 2);
    wf.add(copy);
  });
  wf.add({
    name: "Respond: accepted", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1, position: P(8, 2),
    parameters: {
      respondWith: "json",
      responseBody: "={{ JSON.stringify({ status: 'started', message: 'Sorting new searches. The Search Terms tabs show the decisions in a minute or two.' }) }}",
      options: { responseCode: 202 },
    },
  });
  wf.sb("Get blocked words", P(9, 1), "GET", "universal_negatives?select=text,match_type,theme", { alwaysOutputData: true, executeOnce: true });
  wf.sb("Get candidates", P(10, 1), "POST", "rpc/ff_triage_candidates", { alwaysOutputData: true, executeOnce: true },
    { body: "={{ JSON.stringify({ p_days: $('Config').first().json.days, p_client_id: $('Config').first().json.only_client_id }) }}" });
  wf.code("Rule triage", W, "rules.js", P(11, 1), { executeOnce: true });
  wf.inline("AI batches", "const b = $('Rule triage').first().json.ai_batches || [];\nreturn b.length ? b.map((x) => ({ json: x })) : [{ json: { skip: true } }];", P(12, 1), { executeOnce: true });
  wf.if("Anything for the AI?", "!$json.skip", P(13, 1));
  wf.aiAgent("Sort (AI Agent)", P(14, 0), {
    text: "=Business: {{ $json.process }}, {{ $json.client_name }}. Towns served: {{ $json.towns }}. Campaign: {{ $json.campaign_name }}.\nSearch terms from the last week (number, term, clicks, conversions):\n{{ $json.list }}",
    system: `You sort Google Ads search terms for Funeral Futurist (FF), an agency for funeral homes and cremation providers. For every numbered term decide:
- "keep": the person could be looking to arrange a funeral, cremation, burial or preplanning, or to contact this business, in or near the towns served.
- "block": clearly never a customer - obituaries and death notices, jobs and schools, products to buy (urns, jewelry, flowers, caskets), writing help (poems, eulogies, quotes), etiquette, free services or body donation, other states or far-away places, pets (unless the business is a pet crematory), research with no wish to hire anyone.
- "ask_rob": anything you are not sure about, or a term that had conversions but you would block.
Answer every number exactly once. theme is one or two plain words (for example obituaries, jobs, products, location, pricing, preplanning). ${STYLE}`,
    schema: {
      type: "object",
      properties: {
        decisions: {
          type: "array",
          items: {
            type: "object",
            properties: { n: { type: "integer" }, decision: { type: "string", enum: ["keep", "block", "ask_rob"] }, theme: { type: "string" } },
            required: ["n", "decision", "theme"],
          },
        },
      },
      required: ["decisions"],
    },
  });
  wf.code("Save rows", W, "save-rows.js", P(15, 1), { executeOnce: true });
  wf.if("Anything to save?", "$json.total > 0", P(16, 1));
  wf.sb("Save triage", P(17, 0), "POST", "search_term_triage?on_conflict=customer_id,campaign_id,term_hash",
    { notes: "ignore-duplicates: a decision already made (by a person or earlier) is never overwritten." },
    { prefer: "resolution=ignore-duplicates,return=minimal", body: "={{ JSON.stringify($json.rows) }}", full: true, neverError: true });

  wf.chain("Schedule: daily 07:30", "Config");
  wf.chain("Webhook", "Config", "Manual run?");
  wf.connect("Manual run?", "Auth: read token", 0);
  wf.connect("Manual run?", "Get blocked words", 1);
  wf.chain(...AUTH_NAMES.slice(0, 5));
  wf.connect("Auth: allowed?", "Respond: accepted", 0);
  wf.connect("Auth: allowed?", "Respond: denied", 1);
  wf.chain("Respond: accepted", "Get blocked words", "Get candidates", "Rule triage", "AI batches", "Anything for the AI?");
  wf.connect("Anything for the AI?", "Sort (AI Agent)", 0);
  wf.connect("Anything for the AI?", "Save rows", 1);
  wf.chain("Sort (AI Agent)", "Save rows", "Anything to save?");
  wf.connect("Anything to save?", "Save triage", 0);
  return wf.toJSON();
}


// ================================================================== ff-website-check
// Tasks 3 and 7 for every client: reads the client's public pages (website and
// ad landing pages) and records what is there - our script and its settings, the
// Google tag, a GHL / lead form, online checkout, the site platform. No login to
// any website; only yes/no answers, tag ids and a count are kept.
function buildWebsiteCheck() {
  const W = "ff-website-check";
  const wf = new Workflow(W);
  wf.add({
    name: "Schedule: daily 06:45", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: P(0, 0),
    parameters: { rule: { interval: [{ triggerAtHour: 6, triggerAtMinute: 45 }] } },
    notes: "Every client, every day after the 06:00 sync. Workflow settings > Timezone: FF's time zone.",
  });
  wf.add({
    name: "Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2, position: P(0, 2), webhookId: "ff-website-check",
    parameters: { httpMethod: "POST", path: "ff/website-check", responseMode: "responseNode", options: { allowedOrigins: "http://localhost:5173" } },
    notes: "\"Check website\" on the client page. Answers 202 at once; the check carries on.",
  });
  wf.code("Config", W, "config.js", P(1, 1), { notes: "Set SUPABASE_URL and SUPABASE_ANON_KEY after import. Pick the FF GHL OAuth credential on the GHL nodes." });
  wf.if("Manual run?", "$('Config').first().json.trigger === 'manual'", P(2, 1));
  AUTH_NAMES.forEach((name, i) => {
    const copy = JSON.parse(JSON.stringify(whoami.nodes.find((n) => n.name === name)));
    delete copy.id;
    copy.position = name === "Respond: denied" ? P(7, 3) : P(3 + i, 2);
    wf.add(copy);
  });
  wf.add({
    name: "Respond: accepted", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1, position: P(8, 2),
    parameters: {
      respondWith: "json",
      responseBody: "={{ JSON.stringify({ status: 'started', message: 'Checking. The client page updates in a minute.' }) }}",
      options: { responseCode: 202 },
    },
  });
  wf.sb("Get pages to check", P(9, 1), "POST", "rpc/ff_website_targets", { alwaysOutputData: true, executeOnce: true },
    { body: "={{ JSON.stringify({ p_client_id: $('Config').first().json.only_client_id }) }}" });
  wf.code("Pages", W, "pages.js", P(10, 1), { executeOnce: true });
  wf.if("Any pages?", "!$json.none", P(11, 1));
  wf.http("Fetch page", P(12, 0), {
    method: "GET", url: "={{ $json.url }}",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; FF-website-check/1.0)", Accept: "text/html" },
    full: true, neverError: true, text: true, batch: 400, timeout: 20000,
  }, { onError: "continueRegularOutput", notes: "Public page only, no login. One request at a time." });
  wf.code("Read pages", W, "read-pages.js", P(13, 0), { executeOnce: true });
  wf.sb("Save checks", P(14, 0), "POST", "website_checks?on_conflict=client_id,url", {},
    { prefer: "resolution=merge-duplicates,return=minimal", body: "={{ JSON.stringify($json.rows) }}", full: true, neverError: true });

  // What the system can fill in by itself (no buttons): client type from online
  // payment, website from the ads, phone from the call asset, GHL sub-account.
  wf.sb("Apply findings", P(15, 1), "POST", "rpc/ff_apply_website_findings",
    { executeOnce: true, notes: "Client type (online payment found = online cremation, unless set by hand), website and phone when empty." },
    { body: "={{ JSON.stringify({ p_client_id: $('Config').first().json.only_client_id }) }}", full: true, neverError: true });
  wf.sb("Clients without GHL", P(16, 1), "POST", "rpc/ff_clients_without_ghl", { alwaysOutputData: true, executeOnce: true }, { body: "={}" });
  wf.sb("Linked GHL sub-accounts", P(17, 1), "GET", "clients?select=ghl_location_id&ghl_location_id=not.is.null&order=updated_at.desc", { alwaysOutputData: true, executeOnce: true });
  wf.http("GHL: agency", P(18, 1), {
    method: "GET", cred: "ghl", headers: GHL_HEADERS, full: true, neverError: true,
    url: `=${GHL_API}/locations/{{ $('Linked GHL sub-accounts').first().json.ghl_location_id || 'none' }}`,
  }, { onError: "continueRegularOutput", executeOnce: true, notes: "FF's GHL agency id, read from a client already linked (Config GHL_COMPANY_ID is the fallback)." });
  wf.http("GHL: list sub-accounts", P(19, 1), {
    method: "GET", cred: "ghl", headers: GHL_HEADERS, full: true, neverError: true,
    url: `=${GHL_API}/locations/search?companyId={{ encodeURIComponent(((($('GHL: agency').first().json.body || {}).location) || {}).companyId || $('Config').first().json.GHL_COMPANY_ID) }}&skip=0&limit=1000`,
  }, { onError: "continueRegularOutput", executeOnce: true, notes: "FF's GHL sub-accounts (name, website, phone) to link clients by themselves." });
  wf.code("Match GHL", W, "match-ghl.js", P(20, 1), { executeOnce: true });
  wf.sbGeneric("Save GHL links", P(21, 1), "rest/v1/", "Links a client to its GHL sub-account when the match is unambiguous.");

  wf.chain("Schedule: daily 06:45", "Config");
  wf.chain("Webhook", "Config", "Manual run?");
  wf.connect("Manual run?", "Auth: read token", 0);
  wf.connect("Manual run?", "Get pages to check", 1);
  wf.chain(...AUTH_NAMES.slice(0, 5));
  wf.connect("Auth: allowed?", "Respond: accepted", 0);
  wf.connect("Auth: allowed?", "Respond: denied", 1);
  wf.chain("Respond: accepted", "Get pages to check", "Pages", "Any pages?");
  wf.connect("Any pages?", "Fetch page", 0);
  wf.connect("Any pages?", "Apply findings", 1);
  wf.chain("Fetch page", "Read pages", "Save checks", "Apply findings", "Clients without GHL", "Linked GHL sub-accounts", "GHL: agency", "GHL: list sub-accounts", "Match GHL", "Save GHL links");
  return wf.toJSON();
}

// ================================================================== ff-audit
function buildAudit() {
  const W = "ff-audit";
  const wf = new Workflow(W);
  const allowed = webhookFront(wf, {
    path: "ff/audit", roles: AGENCY,
    doc: "ff-audit: read-only audit of one account from synced data (campaigns, settings, tracking, 90 days of search terms, negatives, issues). Rob marks it reviewed.",
  });
  const ok = validated(wf, allowed, { workflow: W, pos: P(8, 1) });
  wf.if("Generate?", "$json.action === 'generate'", P(10, 1));
  wf.sb("Get account", P(11, 0), "GET", "ad_accounts?customer_id=eq.{{ $json.customer_id }}&select=customer_id,client_id,descriptive_name,clients(name)", { alwaysOutputData: true });
  wf.inline("Check account", "const a = $input.first().json || {};\nconst v = $('Validate input').first().json;\nreturn [{ json: a.client_id === v.client_id ? { ok: true } : { ok: false, status: 404, body: { error: 'That account does not belong to this client.' } } }];", P(12, 0));
  wf.if("Account ok?", "$json.ok === true", P(13, 0));
  wf.sb("Get audit data", P(14, -1), "POST", "rpc/ff_audit_data", { notes: "Full response + never error: a database failure becomes a plain message for the dashboard instead of a silent stop." },
    { body: "={{ JSON.stringify({ p_customer_id: $('Validate input').first().json.customer_id }) }}", full: true, neverError: true });
  wf.code("Write audit", W, "write-audit.js", P(15, -1));
  wf.if("Audit written?", "$json.ok === true", P(16, -1));
  wf.sb("Save audit", P(17, -2), "POST", "audits", {}, { prefer: "return=representation", body: "={{ JSON.stringify($json.row) }}", full: true, neverError: true });
  wf.inline("Audit result", "const r = $input.first().json || {};\nconst row = Array.isArray(r.body) ? r.body[0] : r.body;\nif (!(r.statusCode >= 200 && r.statusCode < 300) || !row || !row.id) {\n  const msg = (r.body && (r.body.message || r.body.details)) || 'status ' + r.statusCode;\n  return [{ json: { status: 500, body: { error: 'The audit was written but could not be saved: ' + String(msg).slice(0, 200) } } }];\n}\nreturn [{ json: { status: 200, body: { ok: true, id: row.id, summary: row.summary } } }];", P(18, -2));
  wf.sb("Mark reviewed", P(11, 2), "PATCH", "audits?id=eq.{{ $json.audit_id }}&status=eq.draft", { alwaysOutputData: true }, {
    prefer: "return=representation",
    body: "={{ JSON.stringify({ status: 'reviewed_by_rob', reviewed_by: $('Auth: check role').first().json.user.user_id, reviewed_at: new Date().toISOString() }) }}",
  });
  wf.inline("Review result", "const row = $input.first().json || {};\nreturn [{ json: row.id ? { status: 200, body: { ok: true } } : { status: 409, body: { error: 'Audit not found or already reviewed.' } } }];", P(12, 2), { executeOnce: true });

  wf.connect(ok, "Generate?", 0);
  wf.connect("Generate?", "Get account", 0);
  wf.connect("Generate?", "Mark reviewed", 1);
  wf.chain("Get account", "Check account", "Account ok?");
  wf.connect("Account ok?", "Get audit data", 0);
  wf.connect("Account ok?", "Respond", 1);
  wf.chain("Get audit data", "Write audit", "Audit written?");
  wf.connect("Audit written?", "Save audit", 0);
  wf.connect("Audit written?", "Respond", 1);
  wf.chain("Save audit", "Audit result", "Respond");
  wf.chain("Mark reviewed", "Review result", "Respond");
  return wf.toJSON();
}

// ================================================================== ff-dataforseo
function buildDataForSEO() {
  const W = "ff-dataforseo";
  const wf = new Workflow(W);
  wf.add({
    name: "Schedule: weekly Monday 05:00", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: P(0, 0),
    parameters: { rule: { interval: [{ field: "weeks", triggerAtDay: [1], triggerAtHour: 5 }] } },
  });
  wf.add({
    name: "Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2, position: P(0, 2), webhookId: "ff-keyword-research",
    parameters: { httpMethod: "POST", path: "ff/keyword-research", responseMode: "responseNode", options: { allowedOrigins: "http://localhost:5173" } },
    notes: "Refresh keyword data from the dashboard. Answers 202 at once; the research carries on.",
  });
  wf.code("Config", W, "config.js", P(1, 1), { notes: "Set SUPABASE_URL and SUPABASE_ANON_KEY after import." });
  wf.if("Manual run?", "$('Config').first().json.trigger === 'manual'", P(2, 1));
  AUTH_NAMES.forEach((name, i) => {
    const copy = JSON.parse(JSON.stringify(whoami.nodes.find((n) => n.name === name)));
    delete copy.id;
    copy.position = name === "Respond: denied" ? P(7, 3) : P(3 + i, 2);
    wf.add(copy);
  });
  wf.add({
    name: "Respond: accepted", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1, position: P(8, 2),
    parameters: { respondWith: "json", responseBody: "={{ JSON.stringify({ status: 'started' }) }}", options: { responseCode: 202 } },
  });
  wf.googleSecrets("Get Google Ads secrets", P(9, 0));
  wf.sb("Get research targets", P(9, 1), "POST", "rpc/ff_keyword_research_targets", { alwaysOutputData: true },
    { body: "={{ JSON.stringify({ p_client_id: $('Config').first().json.only_client_id }) }}" });
  wf.code("Prepare targets", W, "prepare-targets.js", P(10, 1));
  wf.if("Anything to research?", "!$json.none", P(11, 1));
  wf.add({ name: "Loop over clients", type: "n8n-nodes-base.splitInBatches", typeVersion: 3, position: P(12, 1), parameters: { batchSize: 1, options: {} } });
  wf.googleToken("Refresh Google token", P(12, 3));
  wf.code("Build requests", W, "build-requests.js", P(13, 3));
  wf.http("DataForSEO search volume", P(14, 3), {
    method: "POST", cred: "dataforseo", url: "https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live",
    jsonBody: "={{ JSON.stringify($json.dataforseo_body) }}", full: true, neverError: true, timeout: 120000,
  }, { notes: "Volume, CPC and competition for up to 1000 of our keywords, negatives and search terms." });
  wf.googleAds("Google keyword metrics", P(15, 3), {
    url: `=https://googleads.googleapis.com/${API_V}/customers/{{ $('Build requests').first().json.customer_id }}:generateKeywordHistoricalMetrics`,
    body: "={{ JSON.stringify($('Build requests').first().json.google_body) }}",
    token: "Refresh Google token", login: "$('Build requests').first().json.login_customer_id",
    notes: "Google Keyword Planner historical metrics. Read only (not a mutate).",
  });
  wf.code("Related seeds", W, "related-seeds.js", P(16, 3));
  wf.http("DataForSEO related keywords", P(17, 3), {
    method: "POST", cred: "dataforseo", url: "https://api.dataforseo.com/v3/dataforseo_labs/google/related_keywords/live",
    jsonBody: "={{ JSON.stringify($json.body) }}", full: true, neverError: true, batch: 500, timeout: 120000,
  });
  wf.code("Map results", W, "map-results.js", P(18, 3));
  wf.sb("Upsert keyword data", P(19, 3), "POST", "keyword_volume?on_conflict=source,keyword_norm,geo_target,language,fetched_month", {},
    { prefer: "resolution=merge-duplicates,return=minimal", body: "={{ JSON.stringify($json.rows) }}", full: true, neverError: true });
  wf.add({ name: "Done", type: "n8n-nodes-base.noOp", typeVersion: 1, position: P(13, 1), parameters: {} });

  wf.connect("Schedule: weekly Monday 05:00", "Config");
  wf.connect("Webhook", "Config");
  wf.connect("Config", "Manual run?");
  wf.connect("Manual run?", "Auth: read token", 0);
  wf.connect("Manual run?", "Get Google Ads secrets", 1);
  wf.chain(...AUTH_NAMES.slice(0, 5));
  wf.connect("Auth: allowed?", "Respond: accepted", 0);
  wf.connect("Auth: allowed?", "Respond: denied", 1);
  wf.connect("Respond: accepted", "Get Google Ads secrets");
  wf.chain("Get Google Ads secrets", "Get research targets", "Prepare targets", "Anything to research?");
  wf.connect("Anything to research?", "Loop over clients", 0);
  wf.connect("Anything to research?", "Done", 1);
  wf.connect("Loop over clients", "Done", 0);
  wf.connect("Loop over clients", "Refresh Google token", 1);
  wf.chain("Refresh Google token", "Build requests", "DataForSEO search volume", "Google keyword metrics", "Related seeds",
    "DataForSEO related keywords", "Map results", "Upsert keyword data", "Loop over clients");
  return wf.toJSON();
}

// ================================================================== ff-google-ads-settings
function buildGoogleAdsSettings() {
  const W = "ff-google-ads-settings";
  const wf = new Workflow(W);
  const allowed = webhookFront(wf, {
    path: "ff/google-ads-settings", roles: AGENCY, settings: { GOOGLE_ADS_API_VERSION: "v25" },
    doc: "ff-google-ads-settings: the Google Ads API connection from the dashboard Settings page. Rob saves values and connects with Google; FF staff can test. Values go to Supabase private.google_ads_secrets and are never sent back to the browser.",
  });
  const ok = validated(wf, allowed, { workflow: W, pos: P(8, 1) });
  wf.if("Save?", "$json.action === 'save'", P(10, 1));
  wf.sb("Save settings", P(11, 0), "POST", "rpc/ff_set_google_ads_secrets", {},
    { full: true, neverError: true, body: "={{ JSON.stringify({ p_values: $json.values, p_user: $('Auth: check role').first().json.user.user_id }) }}" });
  wf.code("Save result", W, "save-result.js", P(12, 0));
  wf.googleSecrets("Get Google Ads secrets", P(11, 2));
  wf.if("Connect with Google?", "$('Validate input').first().json.action === 'exchange_code'", P(12, 2));
  wf.add({
    name: "Exchange code", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: P(13, 1),
    parameters: {
      method: "POST", url: "https://oauth2.googleapis.com/token",
      sendBody: true, contentType: "form-urlencoded",
      bodyParameters: { parameters: [
        { name: "code", value: "={{ $('Validate input').first().json.code }}" },
        { name: "client_id", value: "={{ $('Get Google Ads secrets').first().json.client_id }}" },
        { name: "client_secret", value: "={{ $('Get Google Ads secrets').first().json.client_secret }}" },
        { name: "redirect_uri", value: "={{ $('Validate input').first().json.redirect_uri }}" },
        { name: "grant_type", value: "authorization_code" },
      ] },
      options: { response: { response: { fullResponse: true, neverError: true } } },
    },
    notes: "Google sign-in code -> refresh token. This workflow keeps no execution data.",
  });
  wf.code("Check exchange", W, "check-exchange.js", P(14, 1));
  wf.if("Got refresh token?", "$json.ok === true", P(15, 1));
  wf.sb("Save refresh token", P(16, 0), "POST", "rpc/ff_set_google_ads_secrets", {},
    { full: true, neverError: true, body: "={{ JSON.stringify({ p_values: { refresh_token: $('Check exchange').first().json.refresh_token }, p_user: $('Auth: check role').first().json.user.user_id }) }}" });
  wf.code("Connect result", W, "connect-result.js", P(17, 0));
  wf.googleToken("Refresh Google token", P(13, 3));
  wf.http("List accessible accounts", P(14, 3), {
    method: "GET", url: `=https://googleads.googleapis.com/${API_V}/customers:listAccessibleCustomers`,
    headers: "={{ JSON.stringify({ \"Authorization\": \"Bearer \" + ($('Refresh Google token').first().json.access_token || 'missing'), \"developer-token\": $('Get Google Ads secrets').first().json.developer_token || '' }) }}",
    full: true, neverError: true,
  }, { notes: "Read only: which Google Ads accounts this login can reach." });
  wf.code("Test result", W, "test-result.js", P(15, 3));

  wf.connect(ok, "Save?", 0);
  wf.connect("Save?", "Save settings", 0);
  wf.connect("Save?", "Get Google Ads secrets", 1);
  wf.chain("Save settings", "Save result", "Respond");
  wf.chain("Get Google Ads secrets", "Connect with Google?");
  wf.connect("Connect with Google?", "Exchange code", 0);
  wf.connect("Connect with Google?", "Refresh Google token", 1);
  wf.chain("Exchange code", "Check exchange", "Got refresh token?");
  wf.connect("Got refresh token?", "Save refresh token", 0);
  wf.connect("Got refresh token?", "Respond", 1);
  wf.chain("Save refresh token", "Connect result", "Respond");
  wf.chain("Refresh Google token", "List accessible accounts", "Test result", "Respond");
  // Tokens and sign-in codes pass through here: keep no execution data at all.
  return wf.toJSON({ saveDataErrorExecution: "none", saveManualExecutions: false });
}

// ================================================================== ff-weekly-report
function buildWeeklyReport() {
  const W = "ff-weekly-report";
  const wf = new Workflow(W);
  wf.add({
    name: "Schedule: weekly Monday 08:00", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: P(0, 0),
    parameters: { rule: { interval: [{ field: "weeks", triggerAtDay: [1], triggerAtHour: 8 }] } },
    notes: "Monday 08:00, after the 06:00 sync, for last week (Monday to Sunday). Workflow settings > Timezone: FF's time zone.",
  });
  wf.add({
    name: "Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2, position: P(0, 2), webhookId: "ff-weekly-report",
    parameters: { httpMethod: "POST", path: "ff/weekly-report", responseMode: "responseNode", options: { allowedOrigins: "http://localhost:5173" } },
    notes: "Run the weekly report from the dashboard. Answers 202 at once; the report carries on. No Slack note unless the body has slack: true.",
  });
  wf.code("Config", W, "config.js", P(1, 1), { notes: "Set SUPABASE_URL, SUPABASE_ANON_KEY, SLACK_CHANNEL and DASHBOARD_URL after import." });
  wf.if("Manual run?", "$('Config').first().json.trigger === 'manual'", P(2, 1));
  AUTH_NAMES.forEach((name, i) => {
    const copy = JSON.parse(JSON.stringify(whoami.nodes.find((n) => n.name === name)));
    delete copy.id;
    copy.position = name === "Respond: denied" ? P(7, 3) : P(3 + i, 2);
    wf.add(copy);
  });
  wf.add({
    name: "Respond: accepted", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1, position: P(8, 2),
    parameters: {
      respondWith: "json",
      responseBody: "={{ JSON.stringify({ status: 'started', message: 'Weekly report started for the week of ' + $('Config').first().json.week_start + '. It appears on the client page when it finishes.' }) }}",
      options: { responseCode: 202 },
    },
  });
  wf.sb("Get report numbers", P(9, 1), "POST", "rpc/ff_weekly_report", { alwaysOutputData: true, executeOnce: true },
    { body: "={{ JSON.stringify({ p_week_start: $('Config').first().json.week_start, p_client_id: $('Config').first().json.only_client_id }) }}" });
  wf.code("Prepare clients", W, "prepare-clients.js", P(10, 1));
  wf.if("Any clients?", "!$json.none", P(11, 1));
  wf.add({
    name: "Loop over clients", type: "n8n-nodes-base.splitInBatches", typeVersion: 3, position: P(12, 1), parameters: { batchSize: 1, options: {} },
    notes: "One client per pass, so $('Loop over clients').first() is always the current client. One client failing does not stop the others.",
  });
  wf.if("GHL set up?", "Boolean($json.ghl_location_id)", P(12, 3));
  ghlLocationToken(wf, "GHL: location token", P(13, 2), "$('Loop over clients').first().json.ghl_location_id");
  wf.http("GHL: count Google Ads leads", P(14, 2), {
    method: "POST", url: `${GHL_API}/contacts/search`, headers: ghlAuthHeaders("GHL: location token"),
    jsonBody: "={{ JSON.stringify({ locationId: $('Loop over clients').first().json.ghl_location_id, page: 1, pageLimit: 1, filters: [{ field: 'tags', operator: 'contains', value: [$('Config').first().json.GHL_GOOGLE_ADS_TAG] }, { field: 'dateAdded', operator: 'range', value: { gte: $('Loop over clients').first().json.week_start + 'T00:00:00.000Z', lte: $('Loop over clients').first().json.week_end + 'T23:59:59.999Z' } }] }) }}",
    full: true, neverError: true,
  }, {
    onError: "continueRegularOutput",
    notes: "Only the total is used. The answer can hold one contact, so this workflow keeps no execution data (hard rule 4).",
  });
  wf.code("Build client report", W, "build-client-report.js", P(15, 3));
  wf.sb("Save weekly stats", P(15, 3), "POST", "weekly_stats?on_conflict=client_id,week_start", { onError: "continueRegularOutput" },
    { prefer: "resolution=merge-duplicates,return=minimal", body: "={{ JSON.stringify([$json.stats]) }}", full: true, neverError: true });
  wf.sb("Save tracking health", P(16, 3), "POST", "tracking_health?on_conflict=customer_id,conversion_action_id,week_start", { onError: "continueRegularOutput" },
    { prefer: "resolution=merge-duplicates,return=minimal", body: "={{ JSON.stringify($('Build client report').first().json.tracking_rows) }}", full: true, neverError: true });
  wf.if("Google Sheet set?", "Boolean($('Build client report').first().json.google_sheet_id)", P(17, 3));
  wf.inline("Sheet row", "return [{ json: $('Build client report').first().json.sheet_row }];", P(18, 2));
  wf.add({
    name: "Write Google Sheet", type: "n8n-nodes-base.googleSheets", typeVersion: 4.5, position: P(19, 2), credentials: CRED.sheets,
    parameters: {
      operation: "appendOrUpdate",
      documentId: { __rl: true, value: "={{ $('Build client report').first().json.google_sheet_id }}", mode: "id" },
      sheetName: { __rl: true, value: "={{ $('Build client report').first().json.sheet_tab }}", mode: "name" },
      columns: { mappingMode: "autoMapInputData", value: {}, matchingColumns: ["Week"], schema: [] },
      options: {},
    },
    onError: "continueRegularOutput",
    notes: "One row per week in the client's Sheet (row 1 = the column names, see README). Matches on Week, so a re-run updates the row instead of adding another.",
  });
  wf.if("Sheet written?", "!$json.error", P(20, 2));
  wf.sb("Mark sheet written", P(21, 1), "PATCH",
    "weekly_stats?client_id=eq.{{ $('Build client report').first().json.client_id }}&week_start=eq.{{ $('Build client report').first().json.week_start }}",
    { onError: "continueRegularOutput" },
    { prefer: "return=minimal", body: "={{ JSON.stringify({ sheet_written_at: new Date().toISOString() }) }}", full: true, neverError: true });

  wf.sb("Get week rows", P(13, 0), "GET",
    "weekly_stats?week_start=eq.{{ $('Config').first().json.week_start }}&select=*,clients(name,process)&order=cost_micros.desc",
    { alwaysOutputData: true, executeOnce: true });
  wf.sb("Get last month cases", P(13, -1), "POST", "rpc/ff_month_cases", { alwaysOutputData: true, executeOnce: true, notes: "Last month's signed families, matches and spend per client - used in the note on the first Monday of the month." },
    { body: "={{ JSON.stringify({ p_month: (() => { const d = new Date($('Config').first().json.week_end + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); d.setUTCMonth(d.getUTCMonth() - 1, 1); return d.toISOString().slice(0, 10); })() }) }}" });
  wf.code("Build Slack note", W, "build-slack.js", P(14, 0), { executeOnce: true });
  wf.if("Send Slack note?", "!$json.skip", P(15, 0));
  wf.slack("Send Slack note", P(16, 0), "={{ $json.text }}");

  wf.connect("Schedule: weekly Monday 08:00", "Config");
  wf.connect("Webhook", "Config");
  wf.connect("Config", "Manual run?");
  wf.connect("Manual run?", "Auth: read token", 0);
  wf.connect("Manual run?", "Get report numbers", 1);
  wf.chain(...AUTH_NAMES.slice(0, 5));
  wf.connect("Auth: allowed?", "Respond: accepted", 0);
  wf.connect("Auth: allowed?", "Respond: denied", 1);
  wf.connect("Respond: accepted", "Get report numbers");
  wf.chain("Get report numbers", "Prepare clients", "Any clients?");
  wf.connect("Any clients?", "Loop over clients", 0);
  wf.connect("Any clients?", "Get week rows", 1);
  wf.connect("Loop over clients", "Get week rows", 0);
  wf.connect("Loop over clients", "GHL set up?", 1);
  wf.connect("GHL set up?", "GHL: find agency", 0);
  wf.connect("GHL: location token", "GHL: count Google Ads leads");
  wf.connect("GHL set up?", "Build client report", 1);
  wf.chain("GHL: count Google Ads leads", "Build client report", "Save weekly stats", "Save tracking health", "Google Sheet set?");
  wf.connect("Google Sheet set?", "Sheet row", 0);
  wf.connect("Google Sheet set?", "Loop over clients", 1);
  wf.chain("Sheet row", "Write Google Sheet", "Sheet written?");
  wf.connect("Sheet written?", "Mark sheet written", 0);
  wf.connect("Sheet written?", "Loop over clients", 1);
  wf.connect("Mark sheet written", "Loop over clients");
  wf.chain("Get week rows", "Get last month cases", "Build Slack note", "Send Slack note?");
  wf.connect("Send Slack note?", "Send Slack note", 0);
  // The GHL search answer can contain a contact: keep no execution data at all.
  return wf.toJSON({ saveDataErrorExecution: "none", saveManualExecutions: false });
}

// ================================================================== ff-ghl-setup
function buildGhlSetup() {
  const W = "ff-ghl-setup";
  const wf = new Workflow(W);
  const allowed = webhookFront(wf, {
    path: "ff/ghl-setup", roles: AGENCY, settings: { GHL_COMPANY_ID: "SET-ME", GHL_GOOGLE_ADS_TAG: "from google ads" },
    doc: "ff-ghl-setup: 'list_locations' lists FF's GHL sub-accounts (to pick a client's location on Edit client). 'check' / 'setup': opens the client's sub-account with the FF GHL agency key and checks (setup: creates) the Google Ads click fields (gclid, gbraid, wbraid, utm_*) and the 'from google ads' tag. Nothing else in GHL is changed. GHL_COMPANY_ID and GHL_GOOGLE_ADS_TAG must match ff-weekly-report.",
  });
  const ok = validated(wf, allowed, { workflow: W, pos: P(8, 1) });
  wf.if("List locations?", "$json.action === 'list_locations'", P(10, 1));
  wf.http("GHL: list locations", P(11, -1), {
    method: "GET", cred: "ghl", headers: GHL_HEADERS, full: true, neverError: true,
    url: `=${GHL_API}/locations/search?companyId={{ encodeURIComponent($('Config').first().json.GHL_COMPANY_ID) }}&skip=0&limit=1000`,
  }, { notes: "Read: FF's sub-accounts (id, name, town) with the agency key." });
  wf.code("Format locations", W, "format-locations.js", P(12, -1));
  wf.sb("Get client", P(11, 1), "GET",
    `clients?id=eq.${uuidOrZero("$json.client_id")}&select=id,name,ghl_location_id`, { alwaysOutputData: true });
  wf.inline("Check client",
    "const c = $input.first().json || {};\nif (!c.id) return [{ json: { ok: false, status: 404, body: { error: 'Client not found.' } } }];\nif (!c.ghl_location_id) return [{ json: { ok: false, status: 400, body: { error: 'Pick the GHL sub-account on Edit client first.' } } }];\nreturn [{ json: { ok: true } }];",
    P(12, 1));
  wf.if("Client ok?", "$json.ok === true", P(13, 1));
  ghlLocationToken(wf, "GHL: location token", P(14, 0), "$('Get client').first().json.ghl_location_id");
  const loc = "{{ encodeURIComponent($('Get client').first().json.ghl_location_id) }}";
  wf.http("GHL: get custom fields", P(15, 0), {
    method: "GET", url: `=${GHL_API}/locations/${loc}/customFields?model=contact`, headers: ghlAuthHeaders("GHL: location token"), full: true, neverError: true,
  }, { notes: "Read: the sub-account's contact custom fields." });
  wf.http("GHL: get tags", P(16, 0), {
    method: "GET", url: `=${GHL_API}/locations/${loc}/tags`, headers: ghlAuthHeaders("GHL: location token"), full: true, neverError: true,
  });
  wf.code("Plan", W, "plan.js", P(17, 0));
  wf.if("Anything to create?", "$json.kind === 'create'", P(18, 0));
  wf.http("GHL: create", P(19, -1), {
    method: "POST", url: "={{ $json.url }}", headers: ghlAuthHeaders("GHL: location token"),
    jsonBody: "={{ JSON.stringify($json.body) }}", full: true, neverError: true, batch: 300,
  }, { notes: "One field or tag per item: contact custom fields (TEXT) and the Google Ads tag. Runs only for 'setup'." });
  wf.code("Summarize", W, "summarize.js", P(20, -1));

  wf.connect(ok, "List locations?", 0);
  wf.connect("List locations?", "GHL: list locations", 0);
  wf.connect("List locations?", "Get client", 1);
  wf.chain("GHL: list locations", "Format locations", "Respond");
  wf.chain("Get client", "Check client", "Client ok?");
  wf.connect("Client ok?", "GHL: find agency", 0);
  wf.connect("Client ok?", "Respond", 1);
  wf.chain("GHL: location token", "GHL: get custom fields", "GHL: get tags", "Plan", "Anything to create?");
  wf.connect("Anything to create?", "GHL: create", 0);
  wf.connect("Anything to create?", "Respond", 1);
  wf.chain("GHL: create", "Summarize", "Respond");
  // A sub-account token passes through here: keep no execution data at all.
  return wf.toJSON({ saveDataErrorExecution: "none", saveManualExecutions: false });
}

// ------------------------------------------------------------------ write all
const builders = {
  "ff-sync": buildSync,
  "ff-geo-target-suggest": buildGeo,
  "ff-campaign-chat": buildChat,
  "ff-client-message": buildClientMessage,
  "ff-send-reply": buildSendReply,
  "ff-apply-campaign-action": buildApply,
  "ff-delete-campaign": buildDelete,
  "ff-case-match": buildCaseMatch,
  "ff-gaql": buildGaql,
  "ff-search-triage": buildSearchTriage,
  "ff-website-check": buildWebsiteCheck,
  "ff-build-campaign": buildBuild,
  "ff-client-admin": buildClientAdmin,
  "ff-review-actions": buildReview,
  "ff-audit": buildAudit,
  "ff-dataforseo": buildDataForSEO,
  "ff-google-ads-settings": buildGoogleAdsSettings,
  "ff-weekly-report": buildWeeklyReport,
  "ff-ghl-setup": buildGhlSetup,
};

for (const [name, build] of Object.entries(builders)) {
  const wf = build();
  writeFileSync(join(n8nDir, `${name}.json`), JSON.stringify(wf, null, 2) + "\n");
  console.log(`wrote n8n/${name}.json (${wf.nodes.length} nodes)`);
}
