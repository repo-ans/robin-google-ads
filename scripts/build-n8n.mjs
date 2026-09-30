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
};
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
    "Get accounts to sync", "Prepare account list", "Any accounts?");
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
    doc: "ff-apply-campaign-action: Confirm & Apply for a proposed budget / pause / resume (reference apply-campaign-action). rob_admin only; test account or writes_enabled; validateOnly first; every attempt logged in write_log.",
  });
  const ok = validated(wf, allowed, { workflow: W, pos: P(8, 1) });
  wf.sb("Get action context", P(10, 1), "POST", "rpc/ff_action_context", {},
    { body: "={{ JSON.stringify({ p_source: $json.source, p_source_id: $json.source_id }) }}" });
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
  wf.connect(ok, "Get action context", 0);
  wf.chain("Get action context", "Plan change", "Allowed?");
  wf.connect("Allowed?", "Get Google Ads secrets", 0);
  wf.connect("Allowed?", "Plan records", 1);
  wf.chain("Get Google Ads secrets", "Refresh Google token", "Validate change", "Check validation", "Valid?");
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
    settings: { GOOGLE_ADS_API_VERSION: "v25", NEGATIVE_LIST_NAME: "FF Universal Negatives", NEGATIVE_LIST: FF_NEGATIVES },
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
    body: "={{ JSON.stringify({ query: \"SELECT shared_set.resource_name, shared_set.name FROM shared_set WHERE shared_set.type = 'NEGATIVE_KEYWORDS' AND shared_set.status = 'ENABLED' AND shared_set.name = '\" + $('Config').first().json.NEGATIVE_LIST_NAME + \"'\" }) }}",
    token: "Refresh Google token", login: "$('Plan build').first().json.login_customer_id", text: true,
    notes: "Reuse the account's FF Universal Negatives list if it exists.",
  });
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
  wf.chain("Mark building", "Get Google Ads secrets", "Refresh Google token", "Find FF negative list", "Build operations", "Validate build", "Check validation", "Valid?");
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
  wf.sb("Get audit data", P(14, -1), "POST", "rpc/ff_audit_data", {}, { body: "={{ JSON.stringify({ p_customer_id: $('Validate input').first().json.customer_id }) }}" });
  wf.code("Write audit", W, "write-audit.js", P(15, -1));
  wf.sb("Save audit", P(16, -1), "POST", "audits", {}, { prefer: "return=representation", body: "={{ JSON.stringify($json.row) }}" });
  wf.inline("Audit result", "const row = $input.first().json;\nreturn [{ json: { status: 200, body: { ok: true, id: row.id, summary: row.summary } } }];", P(17, -1));
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
  wf.chain("Get audit data", "Write audit", "Save audit", "Audit result", "Respond");
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

// ------------------------------------------------------------------ write all
const builders = {
  "ff-sync": buildSync,
  "ff-geo-target-suggest": buildGeo,
  "ff-campaign-chat": buildChat,
  "ff-client-message": buildClientMessage,
  "ff-send-reply": buildSendReply,
  "ff-apply-campaign-action": buildApply,
  "ff-delete-campaign": buildDelete,
  "ff-build-campaign": buildBuild,
  "ff-client-admin": buildClientAdmin,
  "ff-review-actions": buildReview,
  "ff-audit": buildAudit,
  "ff-dataforseo": buildDataForSEO,
  "ff-google-ads-settings": buildGoogleAdsSettings,
};

for (const [name, build] of Object.entries(builders)) {
  const wf = build();
  writeFileSync(join(n8nDir, `${name}.json`), JSON.stringify(wf, null, 2) + "\n");
  console.log(`wrote n8n/${name}.json (${wf.nodes.length} nodes)`);
}
