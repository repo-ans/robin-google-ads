#!/usr/bin/env node
// Offline tests for the Code nodes of the webhook workflows (n8n/src/ff-*/),
// with fake requests and API responses. No n8n, no network.
//   node scripts/test-workflow-code.mjs

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, "n8n", "src", rel), "utf8").replace(/\r\n/g, "\n");
const src = (rel) => read(rel).replace(/^\/\/ @include (\S+)\n/gm, (_, inc) => `${read(inc)}\n`);

async function run(file, { input = [], nodes = {} }) {
  const wrap = (items) => ({ first: () => items[0], all: () => items, itemMatching: (i) => items[i] });
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`node "${name}" did not run`);
    return wrap(nodes[name]);
  };
  const fn = new Function("$", "$input", `return (async () => {\n${src(file)}\n})();`);
  return fn($, wrap(input));
}
const item = (json) => ({ json });
let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (e) {
    console.log(`FAIL ${name}\n     ${e.message}`);
    process.exitCode = 1;
  }
}

const rob = { user_id: "11111111-1111-4111-8111-111111111111", email: "rob@ff.test", role: "rob_admin", client_id: null };
const staff = { user_id: "22222222-2222-4222-8222-222222222222", email: "staff@ff.test", role: "ff_staff", client_id: null };
const clientA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const viewer = { user_id: "33333333-3333-4333-8333-333333333333", email: "home@client.test", role: "client_viewer", client_id: clientA };
const ctxNodes = (body, user, extra = {}) => ({
  Config: [item({ body, GOOGLE_ADS_API_VERSION: "v25", NEGATIVE_LIST_NAME: "FF Universal Negatives",
    NEGATIVE_LIST: [{ text: "jobs", match_type: "BROAD" }, { text: "mortuary school", match_type: "PHRASE" }] })],
  "Auth: check role": [item({ user })],
  ...extra,
});

// ------------------------------------------------------------------ build rules
const goodDraft = {
  action: "save_draft", client_id: clientA, customer_id: "1234567890", template: "C", name: "C - Preplanning - Mount Pleasant",
  daily_budget: 25, bidding_strategy: "MAXIMIZE_CONVERSIONS",
  geo_targets: [{ resource_name: "geoTargetConstants/1023191", name: "Mount Pleasant, SC" }],
  ad_groups: [{
    name: "Preplanning", final_url: "https://example-funeral.test/preplanning",
    keywords: ["preplan funeral", "prepaid funeral", "funeral preplanning", "preplanning a funeral", "prearranged funeral"]
      .map((text) => ({ text, match_type: "PHRASE" })),
    ads: [{ headlines: ["Plan Ahead With Care", "Preplanning Made Simple", "Talk With Our Team"],
      descriptions: ["Plan your arrangements ahead of time — with a calm, clear guide.", "Speak with us during office hours."],
      path1: "preplanning" }],
  }],
};

await test("build rules: a good draft has no issues and copy is cleaned", async () => {
  const out = await run("ff-build-campaign/route.js", {
    input: [item({ customer_id: "1234567890", client_id: clientA })], nodes: ctxNodes(goodDraft, staff),
  });
  assert.equal(out[0].json.valid, true);
  assert.deepEqual(out[0].json.issues, []);
  const body = out[0].json.body;
  assert.equal(body.daily_budget_micros, 25000000);
  assert.ok(!/—/.test(JSON.stringify(body)), "long dash replaced with a plain hyphen");
  assert.equal(out[0].json.method, "POST");
});

await test("build rules: broad match, too few keywords and long headline are reported", async () => {
  const bad = JSON.parse(JSON.stringify(goodDraft));
  bad.ad_groups[0].keywords = bad.ad_groups[0].keywords.slice(0, 3);
  bad.ad_groups[0].keywords[0].match_type = "BROAD";
  bad.ad_groups[0].ads[0].headlines[0] = "This headline is far longer than thirty characters";
  const out = await run("ff-build-campaign/route.js", {
    input: [item({ customer_id: "1234567890", client_id: clientA })], nodes: ctxNodes(bad, staff),
  });
  const issues = out[0].json.issues.join(" ");
  assert.match(issues, /5 to 15 keywords/);
  assert.match(issues, /phrase or exact/);
  assert.match(issues, /over 30 characters/);
});

await test("build: only rob_admin may build; account must belong to the client", async () => {
  const denied = await run("ff-build-campaign/route.js", {
    input: [item({})], nodes: ctxNodes({ action: "build", build_id: "44444444-4444-4444-8444-444444444444" }, staff),
  });
  assert.equal(denied[0].json.status, 403);
  const wrong = await run("ff-build-campaign/route.js", {
    input: [item({ customer_id: "1234567890", client_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })], nodes: ctxNodes(goodDraft, staff),
  });
  assert.equal(wrong[0].json.status, 400);
});

const buildCtx = (overrides = {}) => ({
  build: { id: "44444444-4444-4444-8444-444444444444", status: "draft", ...goodDraft, daily_budget_micros: 25000000, ...overrides.build },
  account: { customer_id: "1234567890", login_customer_id: "9999999999", is_test_account: true, ...overrides.account },
  client: { writes_enabled: false, competitor_terms: ["Other Funeral Home"], language_code: "en",
    office_hours: { days: ["MONDAY", "FRIDAY"], start_hour: 9, end_hour: 17 }, ...overrides.client },
});

await test("build: write gate - live account needs writes_enabled", async () => {
  const out = await run("ff-build-campaign/plan-build.js", {
    input: [item(buildCtx({ account: { is_test_account: false } }))], nodes: ctxNodes({}, rob),
  });
  assert.equal(out[0].json.ok, false);
  assert.equal(out[0].json.status, 403);
  const ok = await run("ff-build-campaign/plan-build.js", { input: [item(buildCtx())], nodes: ctxNodes({}, rob) });
  assert.equal(ok[0].json.ok, true);
});

await test("build: one atomic mutate, everything PAUSED, presence only, schedule for C, FF negatives", async () => {
  const nodes = ctxNodes({}, rob);
  const plan = await run("ff-build-campaign/plan-build.js", { input: [item(buildCtx())], nodes });
  nodes["Plan build"] = plan;
  const [out] = await run("ff-build-campaign/build-operations.js", {
    input: [item({ statusCode: 200, body: "[]" })], nodes,
  });
  const ops = out.json.body.mutateOperations;
  const created = (k) => ops.filter((o) => o[k]).map((o) => o[k].create);
  const campaign = created("campaignOperation")[0];
  assert.equal(campaign.status, "PAUSED");
  assert.equal(campaign.advertisingChannelType, "SEARCH");
  assert.equal(campaign.geoTargetTypeSetting.positiveGeoTargetType, "PRESENCE");
  assert.equal(campaign.networkSettings.targetSearchNetwork, false);
  assert.ok(created("adGroupOperation").every((g) => g.status === "PAUSED"));
  assert.ok(created("adGroupAdOperation").every((a) => a.status === "PAUSED"));
  assert.ok(created("adGroupCriterionOperation").every((k) => ["PHRASE", "EXACT"].includes(k.keyword.matchType)));
  assert.equal(created("campaignCriterionOperation").filter((c) => c.adSchedule).length, 2, "office-hours schedule for template C");
  assert.ok(created("campaignCriterionOperation").some((c) => c.negative && c.keyword.text === "other funeral home"));
  assert.equal(created("sharedSetOperation")[0].name, "FF Universal Negatives");
  assert.equal(created("sharedCriterionOperation").length, 2);
  const temp = new Set();
  for (const o of ops) for (const v of Object.values(o)) if (v.create && v.create.resourceName) {
    assert.ok(!temp.has(v.create.resourceName), "temporary ids are unique");
    temp.add(v.create.resourceName);
  }
});

await test("build: existing FF negative list is reused, not recreated", async () => {
  const nodes = ctxNodes({}, rob);
  nodes["Plan build"] = await run("ff-build-campaign/plan-build.js", { input: [item(buildCtx())], nodes });
  const [out] = await run("ff-build-campaign/build-operations.js", {
    input: [item({ statusCode: 200, body: JSON.stringify([{ results: [{ sharedSet: { resourceName: "customers/1234567890/sharedSets/77" } }] }]) })],
    nodes,
  });
  const ops = out.json.body.mutateOperations;
  assert.ok(!ops.some((o) => o.sharedSetOperation));
  assert.equal(ops.find((o) => o.campaignSharedSetOperation).campaignSharedSetOperation.create.sharedSet, "customers/1234567890/sharedSets/77");
});

await test("build records: validation failure marks the draft error and logs it", async () => {
  const nodes = ctxNodes({}, rob);
  nodes["Plan build"] = await run("ff-build-campaign/plan-build.js", { input: [item(buildCtx())], nodes });
  nodes["Build operations"] = [item({ op_count: 12 })];
  nodes["Validate build"] = [item({ statusCode: 400, body: JSON.stringify({ error: { message: "Bad", details: [{ errors: [{ message: "Too long" }] }] } }) })];
  const out = await run("ff-build-campaign/records.js", { nodes });
  assert.equal(out[0].json.respond.status, 422);
  assert.ok(out.some((o) => o.json.path.startsWith("campaign_builds") && o.json.body.status === "error"));
  const log = out.find((o) => o.json.path === "write_log").json.body[0];
  assert.equal(log.validate_only, true);
  assert.equal(log.status, "failed");
});

// ------------------------------------------------------------------ apply
const actionCtx = (o = {}) => ({
  found: true, customer_id: "1234567890", campaign_id: "10", action_status: "proposed", campaign_row_id: "c1",
  campaign_status: "ENABLED", budget_id: "5", budget_shared: false, login_customer_id: null, is_test_account: true,
  writes_enabled: false, proposed_action: { action_type: "update_daily_budget", daily_budget: 45, reason: "Budget limits delivery" }, ...o,
});
const applyNodes = (ctx) => ctxNodes({}, rob, { "Validate input": [item({ source: "chat", source_id: "55555555-5555-4555-8555-555555555555" })] });

await test("apply: budget change builds a campaignBudgets update in micros", async () => {
  const [out] = await run("ff-apply-campaign-action/plan.js", { input: [item(actionCtx())], nodes: applyNodes() });
  assert.equal(out.json.ok, true);
  assert.equal(out.json.url_suffix, "campaignBudgets:mutate");
  assert.equal(out.json.mutate_body.operations[0].update.amountMicros, "45000000");
  assert.equal(out.json.mutate_body.operations[0].update.resourceName, "customers/1234567890/campaignBudgets/5");
});

await test("apply: guards - already applied, shared budget, live account without writes, resume of running", async () => {
  const cases = [
    [actionCtx({ action_status: "applied" }), 409],
    [actionCtx({ budget_shared: true }), 422],
    [actionCtx({ is_test_account: false }), 403],
    [actionCtx({ proposed_action: { action_type: "resume_campaign", daily_budget: null, reason: "x" } }), 409],
    [actionCtx({ proposed_action: { action_type: "delete_everything" } }), 422],
    [{ found: false }, 404],
  ];
  for (const [ctx, status] of cases) {
    const [out] = await run("ff-apply-campaign-action/plan.js", { input: [item(ctx)], nodes: applyNodes() });
    assert.equal(out.json.ok, false);
    assert.equal(out.json.status, status, JSON.stringify(ctx.proposed_action || ctx));
  }
});

await test("apply records: success writes back budget and marks the chat row applied", async () => {
  const nodes = applyNodes();
  nodes["Plan change"] = await run("ff-apply-campaign-action/plan.js", { input: [item(actionCtx())], nodes });
  nodes["Validate change"] = [item({ statusCode: 200, body: {} })];
  nodes["Apply change"] = [item({ statusCode: 200, body: { results: [{ resourceName: "x" }] } })];
  const out = await run("ff-apply-campaign-action/records.js", { nodes });
  assert.equal(out[0].json.respond.status, 200);
  const paths = out.map((o) => `${o.json.method} ${o.json.path}`);
  assert.ok(paths.includes("PATCH campaigns?customer_id=eq.1234567890&campaign_id=eq.10"));
  assert.ok(paths.some((p) => p.startsWith("PATCH campaign_chat_messages?id=eq.") && p.endsWith("action_status=eq.proposed")));
  const logs = out.find((o) => o.json.path === "write_log").json.body;
  assert.deepEqual(logs.map((l) => [l.validate_only, l.status]), [[true, "ok"], [false, "ok"]]);
});

// ------------------------------------------------------------------ chat, messages
await test("chat route: names are removed from staff messages; dismiss only touches proposed rows", async () => {
  const campaign = { customer_id: "1234567890", campaign_id: "10", name: "A - At-need" };
  const send = await run("ff-campaign-chat/route.js", {
    input: [item(campaign)],
    nodes: ctxNodes({}, staff, { "Validate input": [item({ action: "send", message: "Why did John Smith's family call twice?" })] }),
  });
  assert.equal(send[0].json.route, "send");
  assert.ok(!/john|smith/i.test(send[0].json.content), send[0].json.content);
  const dismiss = await run("ff-campaign-chat/route.js", {
    input: [item(campaign)],
    nodes: ctxNodes({}, staff, { "Validate input": [item({ action: "dismiss_action", message_id: "66666666-6666-4666-8666-666666666666" })] }),
  });
  assert.match(dismiss[0].json.path, /action_status=eq\.proposed$/);
  const missing = await run("ff-campaign-chat/route.js", { input: [item({})], nodes: ctxNodes({}, staff, { "Validate input": [item({ action: "reset" })] }) });
  assert.equal(missing[0].json.status, 404);
});

await test("chat reply: malformed AI output becomes an apology; emoji and long dashes are removed", async () => {
  const nodes = ctxNodes({}, staff, { Route: [item({ customer_id: "1234567890", campaign_id: "10" })] });
  const [bad] = await run("ff-campaign-chat/prepare-reply.js", { input: [item({ output: null })], nodes });
  assert.match(bad.json.content, /could not answer/);
  const [good] = await run("ff-campaign-chat/prepare-reply.js", {
    input: [item({ output: { reply: "Spend is steady — good news \u{1F600}", proposed_action: { action_type: "pause_campaign", daily_budget: 5, reason: "x" } } })],
    nodes,
  });
  assert.equal(good.json.content, "Spend is steady - good news");
  assert.deepEqual(good.json.proposed_action, { action_type: "pause_campaign", daily_budget: null, reason: "x" });
  assert.equal(good.json.action_status, "proposed");
});

await test("client message: a client login cannot post for another client; names are redacted", async () => {
  const other = await run("ff-client-message/validate.js", {
    input: [item({})], nodes: ctxNodes({ client_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", body: "Hello" }, viewer),
  });
  assert.equal(other[0].json.status, 403);
  const ok = await run("ff-client-message/validate.js", {
    input: [item({})], nodes: ctxNodes({ client_id: clientA, body: "Please add Mary Johnson's service to the ads." }, viewer),
  });
  assert.equal(ok[0].json.valid, true);
  assert.ok(!/mary|johnson/i.test(ok[0].json.row.body), ok[0].json.row.body);
  const wrongCampaign = await run("ff-client-message/validate.js", {
    input: [item({ customer_id: "1234567890", campaign_id: "10", name: "X", ad_accounts: { client_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } })],
    nodes: ctxNodes({ client_id: clientA, body: "Hi", campaign_row_id: "77777777-7777-4777-8777-777777777777" }, viewer),
  });
  assert.equal(wrongCampaign[0].json.status, 404);
});

// ------------------------------------------------------------------ client admin
await test("client admin: staff cannot manage staff logins, cannot flip the write switch", async () => {
  const target = { user_id: rob.user_id, role: "rob_admin" };
  const reset = await run("ff-client-admin/plan.js", {
    input: [item(target)], nodes: ctxNodes({ action: "reset_password", user_id: rob.user_id, password: "Newpassword123" }, staff),
  });
  assert.equal(reset[0].json.status, 403);
  const writes = await run("ff-client-admin/plan.js", {
    input: [item({})], nodes: ctxNodes({ action: "set_writes_enabled", client_id: clientA, enabled: true }, staff),
  });
  assert.equal(writes[0].json.status, 403);
  const staffLogin = await run("ff-client-admin/plan.js", {
    input: [item({})], nodes: ctxNodes({ action: "create_staff_login", email: "new@ff.test", password: "Password1234", role: "ff_staff" }, staff),
  });
  assert.equal(staffLogin[0].json.status, 403);
});

await test("client admin: create login and disable login plans", async () => {
  const create = await run("ff-client-admin/plan.js", {
    input: [item({})], nodes: ctxNodes({ action: "create_login", client_id: clientA, email: " Home@Client.test ", password: "Password1234" }, staff),
  });
  assert.deepEqual({ ...create[0].json, password: "x" }, { valid: true, kind: "create_login", email: "home@client.test", password: "x", role: "client_viewer", client_id: clientA });
  const weak = await run("ff-client-admin/plan.js", {
    input: [item({})], nodes: ctxNodes({ action: "create_login", client_id: clientA, email: "a@b.test", password: "short" }, staff),
  });
  assert.equal(weak[0].json.status, 400);
  const disable = await run("ff-client-admin/plan.js", {
    input: [item({ user_id: viewer.user_id, role: "client_viewer" })], nodes: ctxNodes({ action: "disable_login", user_id: viewer.user_id }, staff),
  });
  assert.deepEqual(disable.map((d) => d.json.method), ["PUT", "PATCH"]);
  assert.deepEqual(disable[0].json.body, { ban_duration: "876000h" });
  const self = await run("ff-client-admin/plan.js", {
    input: [item({ user_id: rob.user_id, role: "rob_admin" })], nodes: ctxNodes({ action: "disable_login", user_id: rob.user_id }, rob),
  });
  assert.equal(self[0].json.status, 403);
});

await test("client admin: client fields are whitelisted and checked", async () => {
  const out = await run("ff-client-admin/plan.js", {
    input: [item({})],
    nodes: ctxNodes({ action: "create_client", name: "McCall Gardens", towns: ["Mount Pleasant"], currency_code: "usd",
      case_value: 6500, writes_enabled: true, role: "rob_admin" }, staff),
  });
  const body = out[0].json.body;
  assert.equal(body.slug, "mccall-gardens");
  assert.equal(body.currency_code, "USD");
  assert.equal(body.case_value_micros, 6500000000);
  assert.ok(!("writes_enabled" in body), "writes_enabled cannot be set through create_client");
});

// ------------------------------------------------------------------ audit, dataforseo
await test("audit: issues found follow the SOP and the markdown has no long dashes", async () => {
  const data = {
    period: { from: "2026-07-02", to: "2026-09-29" },
    account: { customer_id: "1234567890", name: "Pilot", currency: "USD", auto_tagging: false, call_reporting: true },
    campaigns: [{ name: "A - At-need", status: "ENABLED", geo_type: "PRESENCE_OR_INTEREST", cost: 1200, clicks: 300, conversions: 4, budget_lost_is: 0.35, locations: "Mount Pleasant" }],
    conversion_actions: [{ name: "Calls", type: "AD_CALL", status: "ENABLED", primary: true, call_seconds: 60, call_not_90s: true }],
    keywords: { count: 20, broad: 3, low_quality: 2, by_match_type: { BROAD: 3, PHRASE: 17 } },
    ad_groups_keyword_counts: [{ ad_group: "At-need", keywords: 20 }],
    search_terms_top: [{ term: "cremation cost", cost: 50, clicks: 10, conversions: 0, negated: false }],
    search_terms_wasted: [{ term: "free cremation", cost: 40, clicks: 8 }],
    search_terms_name_filtered: { rows: 3, cost: 5 },
    negatives: {}, shared_lists: [], ads: { count: 2, disapproved: 1 }, assets: {}, calls: { total: 10, over_90s: 6 },
    geo: { presence_cost: 1000, interest_cost: 200 }, recommendations: [], changes_30d: {},
  };
  const [out] = await run("ff-audit/write-audit.js", {
    input: [item(data)],
    nodes: ctxNodes({}, staff, {
      "Validate input": [item({ client_id: clientA, customer_id: "1234567890" })],
      "Get account": [item({ clients: { name: "McCall Gardens" } })],
    }),
  });
  const md = out.json.row.markdown;
  for (const re of [/Auto-tagging is off/, /presence only/, /90 seconds/, /broad match/, /5 to 15/, /disapproved/, /No shared negative/, /No call asset/, /area of interest/]) {
    assert.match(md, re);
  }
  assert.ok(!/[–—]/.test(md));
  assert.ok(out.json.row.summary.issues_high >= 2);
});

await test("dataforseo: volumes, Google metrics and related keywords map to one row per key", async () => {
  const t = { client_id: clientA, customer_id: "1234567890", location_code: 2840, language_code: "en", keywords: ["cremation cost"], seeds: ["cremation cost"], geo_targets: [] };
  const [out] = await run("ff-dataforseo/map-results.js", {
    input: [item({ statusCode: 200, body: { tasks: [{ status_code: 20000, result: [{ items: [{ keyword_data: { keyword: "cheap cremation", keyword_info: { search_volume: 90, cpc: 3.1 } } }] }] }] } })],
    nodes: {
      "Build requests": [item(t)],
      "Related seeds": [item({ skip: false, seed: "cremation cost" })],
      "DataForSEO search volume": [item({ statusCode: 200, body: { tasks: [{ status_code: 20000, result: [{ keyword: "Cremation  Cost", search_volume: 880, cpc: 4.25, competition: "HIGH", monthly_searches: [{ year: 2026, month: 8, search_volume: 900 }] }] }] } })],
      "Google keyword metrics": [item({ statusCode: 200, body: { results: [{ text: "cremation cost", keywordMetrics: { avgMonthlySearches: "720", averageCpcMicros: "3900000" } }] } })],
    },
  });
  const rows = out.json.rows;
  const dfs = rows.find((r) => r.source === "dataforseo");
  const kp = rows.find((r) => r.source === "google_kp");
  assert.equal(rows.length, 2);
  assert.equal(dfs.keyword_norm, "cremation cost");
  assert.equal(dfs.avg_cpc_micros, 4250000);
  assert.equal(dfs.related_keywords[0].keyword, "cheap cremation");
  assert.equal(kp.avg_monthly_searches, 720);
  const keys = JSON.stringify(Object.keys(dfs).sort());
  assert.equal(JSON.stringify(Object.keys(kp).sort()), keys, "same keys in one upsert");
});

console.log(`\n${passed} passed${process.exitCode ? ", some failed" : ""}`);
