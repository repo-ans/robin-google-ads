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
  Config: [item({ body, GOOGLE_ADS_API_VERSION: "v25", NEGATIVE_LIST_NAME: "FF - Funeral universal negatives",
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
  nodes["Find FF negative list"] = [item({ statusCode: 200, body: "[]" })];
  nodes["Get blocked words"] = [item({ text: "obituary", match_type: "BROAD", theme: "obituaries" }), item({ text: "urns", match_type: "BROAD", theme: "products" })];
  const [out] = await run("ff-build-campaign/build-operations.js", { input: nodes["Get blocked words"], nodes });
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
  assert.equal(created("sharedSetOperation")[0].name, "FF - Funeral universal negatives");
  const listWords = created("sharedCriterionOperation").map((c) => `${c.keyword.text}|${c.keyword.matchType}`);
  assert.ok(listWords.includes("obituary|BROAD") && listWords.includes("urns|BROAD"), "words from Supabase universal_negatives");
  assert.ok(listWords.includes("other funeral home|PHRASE"), "competitors go on the list too");
  assert.equal(new Set(listWords).size, listWords.length, "no duplicates");
  const temp = new Set();
  for (const o of ops) for (const v of Object.values(o)) if (v.create && v.create.resourceName) {
    assert.ok(!temp.has(v.create.resourceName), "temporary ids are unique");
    temp.add(v.create.resourceName);
  }
});

await test("build: existing FF negative list is reused, not recreated", async () => {
  const nodes = ctxNodes({}, rob);
  nodes["Plan build"] = await run("ff-build-campaign/plan-build.js", { input: [item(buildCtx())], nodes });
  nodes["Find FF negative list"] = [item({ statusCode: 200, body: JSON.stringify([{ results: [{ sharedSet: { resourceName: "customers/1234567890/sharedSets/77", name: "FF Universal Negatives" } }] }]) })];
  const [out] = await run("ff-build-campaign/build-operations.js", { input: [item({})], nodes });
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

await test("client admin: Google Sheet link becomes its id; bad GHL location id is refused", async () => {
  const sheetId = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
  const ok = await run("ff-client-admin/plan.js", {
    input: [item({})],
    nodes: ctxNodes({ action: "update_client", client_id: clientA, google_sheet_id: `https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=0`, ghl_location_id: "AbC123xyz" }, staff),
  });
  assert.equal(ok[0].json.valid, true);
  assert.equal(ok[0].json.body.google_sheet_id, sheetId);
  assert.equal(ok[0].json.body.ghl_location_id, "AbC123xyz");
  const bad = await run("ff-client-admin/plan.js", {
    input: [item({})], nodes: ctxNodes({ action: "update_client", client_id: clientA, ghl_location_id: "../../contacts" }, staff),
  });
  assert.equal(bad[0].json.status, 400);
});

await test("client admin: new client with contact and Google Ads account links the account after the client", async () => {
  const out = await run("ff-client-admin/plan.js", {
    input: [item({})],
    nodes: ctxNodes({ action: "create_client", name: "McCall Gardens", contact_name: "Office Manager", contact_email: "Office@McCall.test", google_ads_customer_id: "123-456-7890" }, staff),
  });
  assert.equal(out.length, 2);
  const [client, link] = out.map((o) => o.json);
  assert.equal(client.path, "rest/v1/clients");
  assert.equal(client.body.contact_email, "office@mccall.test");
  assert.match(client.body.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(link.body, [{ customer_id: "1234567890", client_id: client.body.id }]);
  const bad = await run("ff-client-admin/plan.js", {
    input: [item({})], nodes: ctxNodes({ action: "create_client", name: "X Home", google_ads_customer_id: "12345" }, staff),
  });
  assert.equal(bad[0].json.status, 400);
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
    input: [item({ statusCode: 200, body: data })],
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

await test("audit: a database failure (e.g. statement timeout) becomes a plain 500 message", async () => {
  const [out] = await run("ff-audit/write-audit.js", {
    input: [item({ statusCode: 500, body: { code: "57014", message: "canceling statement due to statement timeout" } })],
    nodes: ctxNodes({}, staff, {
      "Validate input": [item({ client_id: clientA, customer_id: "1234567890" })],
      "Get account": [item({ clients: { name: "McCall Gardens" } })],
    }),
  });
  assert.equal(out.json.ok, false);
  assert.equal(out.json.status, 500);
  assert.match(out.json.body.error, /statement timeout/);
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

// ------------------------------------------------------------------ Google Ads settings
await test("google ads settings: only Rob saves; values are checked; test is open to staff", async () => {
  const staffSave = await run("ff-google-ads-settings/validate.js", { nodes: ctxNodes({ action: "save", values: { mcc_id: "123-456-7890" } }, staff) });
  assert.equal(staffSave[0].json.status, 403);
  const staffTest = await run("ff-google-ads-settings/validate.js", { nodes: ctxNodes({ action: "test" }, staff) });
  assert.equal(staffTest[0].json.valid, true);
  const [save] = await run("ff-google-ads-settings/validate.js", {
    nodes: ctxNodes({ action: "save", values: { mcc_id: "123-456-7890", client_id: "549-abc.apps.googleusercontent.com", client_secret: "", developer_token: "AbCdEf12345" } }, rob),
  });
  assert.deepEqual(save.json.values, { mcc_id: "1234567890", client_id: "549-abc.apps.googleusercontent.com", developer_token: "AbCdEf12345" });
  const badId = await run("ff-google-ads-settings/validate.js", { nodes: ctxNodes({ action: "save", values: { client_id: "not-an-id" } }, rob) });
  assert.equal(badId[0].json.status, 400);
  const badRedirect = await run("ff-google-ads-settings/validate.js", {
    nodes: ctxNodes({ action: "exchange_code", code: "4/abc", redirect_uri: "https://evil.test/steal" }, rob),
  });
  assert.equal(badRedirect[0].json.status, 400);
  const good = await run("ff-google-ads-settings/validate.js", {
    nodes: ctxNodes({ action: "exchange_code", code: "4/abc", redirect_uri: "https://ff-ads.netlify.app/settings/google-callback" }, rob),
  });
  assert.equal(good[0].json.valid, true);
});

await test("google ads settings: refresh token is passed on but never in the answer", async () => {
  const [ok] = await run("ff-google-ads-settings/check-exchange.js", { input: [item({ statusCode: 200, body: { access_token: "ya29", refresh_token: "1//secret" } })] });
  assert.equal(ok.json.ok, true);
  const [bad] = await run("ff-google-ads-settings/check-exchange.js", { input: [item({ statusCode: 400, body: { error: "redirect_uri_mismatch" } })] });
  assert.match(bad.json.body.error, /Authorized redirect URIs/);
  assert.ok(!JSON.stringify(bad.json).includes("1//"));
});

await test("google ads settings: test explains the first problem in plain words", async () => {
  const secrets = { client_id: "a", client_secret: "b", refresh_token: "c", developer_token: "d", mcc_id: "1234567890" };
  const missing = await run("ff-google-ads-settings/test-result.js", {
    input: [item({})], nodes: { "Get Google Ads secrets": [item({ client_id: "a" })], "Refresh Google token": [item({})] },
  });
  assert.match(missing[0].json.body.message, /Not set yet: Client secret/);
  const expired = await run("ff-google-ads-settings/test-result.js", {
    input: [item({})], nodes: { "Get Google Ads secrets": [item(secrets)], "Refresh Google token": [item({ error: "invalid_grant" })] },
  });
  assert.match(expired[0].json.body.message, /In production/);
  const connected = await run("ff-google-ads-settings/test-result.js", {
    input: [item({ statusCode: 200, body: { resourceNames: ["customers/1234567890", "customers/2222222222"] } })],
    nodes: { "Get Google Ads secrets": [item(secrets)], "Refresh Google token": [item({ access_token: "x" })] },
  });
  assert.equal(connected[0].json.body.ok, true);
  assert.match(connected[0].json.body.message, /2 Google Ads account/);
  const noMcc = await run("ff-google-ads-settings/test-result.js", {
    input: [item({ statusCode: 200, body: { resourceNames: ["customers/2222222222"] } })],
    nodes: { "Get Google Ads secrets": [item(secrets)], "Refresh Google token": [item({ access_token: "x" })] },
  });
  assert.equal(noMcc[0].json.body.ok, false);
});

// ------------------------------------------------------------------ weekly report, GHL setup
const weekRow = {
  client_id: clientA, client_name: "McCall Gardens", process: "funeral_home", currency_code: "USD",
  ghl_location_id: "loc123", google_sheet_id: "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789", week_start: "2026-09-21", week_end: "2026-09-27",
  cost_micros: 400000000, impressions: 5000, clicks: 120, conversions: 15, calls_90s: 12, ad_calls_90s_seen: 14, forms: 3,
  arrangements: 0, arrangements_value: 0, arrangements_started: 0,
  prev_cost_micros: 300000000, prev_clicks: 100, prev_calls_90s: 12, prev_forms: 1, prev_arrangements: 0,
  has_call_action: true, has_form_action: true, has_purchase_action: false,
  ask_rob_terms: 2, unsorted_terms: 0, last_synced_at: new Date().toISOString(), account_flags: [],
  tracking: [{ customer_id: "1234567890", conversion_action_id: "70", name: "Calls 90s+", type: "AD_CALL", status: "ENABLED", primary_for_goal: true,
    phone_call_duration_seconds: 90, last_conversion_date: "2026-09-27", conversions_week: 12, spend_14d_micros: 700000000,
    flag_no_recent_conversions: false, flag_call_duration_not_90s: false }],
};
const weekCfg = { SHEET_TAB: "Weekly", SLACK_CHANNEL: "#ff-ads", send_slack: true, week_start: "2026-09-21", week_end: "2026-09-27", DASHBOARD_URL: "" };

await test("weekly report: config picks last full Monday-to-Sunday week, or a given Monday", async () => {
  const [auto] = await run("ff-weekly-report/config.js", { input: [item({})] });
  const ws = new Date(`${auto.json.week_start}T00:00:00Z`);
  assert.equal(ws.getUTCDay(), 1);
  assert.equal((Date.parse(`${auto.json.week_end}T00:00:00Z`) - ws.getTime()) / 86400000, 6);
  assert.equal(auto.json.send_slack, true);
  const [given] = await run("ff-weekly-report/config.js", { input: [item({ headers: {}, body: { week_start: "2026-09-21", client_id: clientA } })] });
  assert.equal(given.json.week_start, "2026-09-21");
  assert.equal(given.json.only_client_id, clientA);
  assert.equal(given.json.send_slack, false, "a dashboard run does not post to Slack unless asked");
  const [notMonday] = await run("ff-weekly-report/config.js", { input: [item({ headers: {}, body: { week_start: "2026-09-22" } })] });
  assert.notEqual(notMonday.json.week_start, "2026-09-22");
});

await test("weekly report: client row has counts, flags, changes and decisions - no contacts", async () => {
  const ghl = { statusCode: 200, body: { total: 5, contacts: [{ firstName: "Should", lastName: "NotBeKept" }] } };
  const [out] = await run("ff-weekly-report/build-client-report.js", {
    input: [item(ghl)], nodes: { Config: [item(weekCfg)], "Loop over clients": [item(weekRow)], "GHL: location token": [item({ statusCode: 201, body: { access_token: "loc-token" } })] },
  });
  const s = out.json.stats;
  assert.equal(s.ghl_google_leads, 5);
  assert.equal(s.cost_per_conversion_micros, Math.round(400000000 / 15));
  assert.ok(s.flags.some((f) => /GHL received 5 Google Ads lead\(s\) but Google Ads counted 3/.test(f)));
  assert.ok(s.flags.some((f) => /saw 14 ad call/.test(f)));
  assert.equal(s.tracking_ok, false);
  assert.ok(s.changes.some((c) => /Spend up 33%/.test(c)));
  assert.ok(s.changes.some((c) => /Forms up 200%/.test(c)));
  assert.ok(!s.changes.some((c) => /Calls/.test(c)), "unchanged calls are not reported");
  assert.deepEqual(s.decisions, ["2 search term(s) marked ask Rob."]);
  assert.equal(out.json.tracking_rows[0].week_start, "2026-09-21");
  assert.equal(out.json.sheet_row.Spend, 400);
  assert.equal(out.json.sheet_row.Week, "2026-09-21");
  assert.ok(!/NotBeKept|Should/.test(JSON.stringify(out.json)), "no contact data leaves the node");
});

await test("weekly report: no GHL and missing actions are flagged; GHL errors are flagged", async () => {
  const bare = { ...weekRow, ghl_location_id: null, has_form_action: false, ad_calls_90s_seen: 0, tracking: [] };
  const [noGhl] = await run("ff-weekly-report/build-client-report.js", {
    input: [item(bare)], nodes: { Config: [item(weekCfg)], "Loop over clients": [item(bare)] },
  });
  assert.equal(noGhl.json.stats.ghl_google_leads, null);
  assert.deepEqual(noGhl.json.stats.flags, ["No preplanning form conversion action."]);
  const [err] = await run("ff-weekly-report/build-client-report.js", {
    input: [item({ statusCode: 401, body: {} })], nodes: { Config: [item(weekCfg)], "Loop over clients": [item(weekRow)], "GHL: location token": [item({ statusCode: 201, body: { access_token: "loc-token" } })] },
  });
  assert.ok(err.json.stats.flags.some((f) => /GHL contacts could not be counted \(status 401\)/.test(f)));
  const [noToken] = await run("ff-weekly-report/build-client-report.js", {
    input: [item({ statusCode: 401, body: {} })],
    nodes: { Config: [item(weekCfg)], "Loop over clients": [item(weekRow)], "GHL: location token": [item({ statusCode: 403, body: {} })] },
  });
  assert.ok(noToken.json.stats.flags.some((f) => /could not be opened with the FF GHL agency key \(status 403\)/.test(f)));
  assert.equal(noToken.json.stats.ghl_google_leads, null);
});

await test("weekly report: Slack note has the key numbers, plain text, skips quiet clients", async () => {
  const rows = [
    { client_id: clientA, cost_micros: 400000000, currency_code: "USD", calls_90s: 12, forms: 3, tracking_ok: true, flags: [], changes: ["Spend up 33%: 400.00 USD from 300.00 USD."], decisions: ["2 new search term(s) with spend to sort: keep, block or ask Rob."], clients: { name: "McCall Gardens", process: "funeral_home" } },
    { client_id: "b", cost_micros: 0, flags: [], changes: [], decisions: [], clients: { name: "Quiet Home", process: "funeral_home" } },
  ];
  const [out] = await run("ff-weekly-report/build-slack.js", { input: [item({})], nodes: { Config: [item(weekCfg)], "Get week rows": rows.map(item) } });
  assert.equal(out.json.skip, false);
  assert.match(out.json.text, /McCall Gardens: spent 400 USD, 12 call\(s\) 90s\+, 3 form\(s\)\. Tracking OK\./);
  assert.match(out.json.text, /For you: 2 new search term/);
  assert.ok(!/Quiet Home/.test(out.json.text));
  assert.ok(!/[–—]/.test(out.json.text));
  const [off] = await run("ff-weekly-report/build-slack.js", { input: [item({})], nodes: { Config: [item({ ...weekCfg, send_slack: false })], "Get week rows": rows.map(item) } });
  assert.equal(off.json.skip, true);
});

await test("weekly report: the first Monday of a month adds signed families and cost per signed case", async () => {
  const rows = [{ client_id: clientA, cost_micros: 400000000, currency_code: "USD", calls_90s: 12, forms: 3, tracking_ok: true, flags: [], changes: [], decisions: [], clients: { name: "Hillside Funeral Home", process: "funeral_home" } }];
  const month = [
    { client_id: clientA, client_name: "Hillside Funeral Home", currency_code: "USD", spend_micros: 3200000000, signed_cases: 5, matched: 3 },
    { client_id: "b", client_name: "Other Home", currency_code: "USD", spend_micros: 900000000, signed_cases: 0, matched: 0 },
  ];
  // week of Sep 28 - Oct 4: the note goes out Monday Oct 5 (first Monday of October)
  const first = { ...weekCfg, week_start: "2026-09-28", week_end: "2026-10-04" };
  const [out] = await run("ff-weekly-report/build-slack.js", { input: month.map(item), nodes: { Config: [item(first)], "Get week rows": rows.map(item) } });
  assert.match(out.json.text, /September 2026 - signed families and cost per signed case:/);
  assert.match(out.json.text, /Hillside Funeral Home: spent 3,200 USD, 5 signed \(3 matched to ads\), 640 USD per signed case\./);
  assert.match(out.json.text, /Other Home: spent 900 USD, no case list uploaded yet\./);
  const later = { ...weekCfg, week_start: "2026-10-05", week_end: "2026-10-11" };
  const [mid] = await run("ff-weekly-report/build-slack.js", { input: month.map(item), nodes: { Config: [item(later)], "Get week rows": rows.map(item) } });
  assert.ok(!/signed families/.test(mid.json.text), "only on the first Monday of the month");
});

await test("ghl setup: plans only the missing fields and tag; check reports without creating", async () => {
  const nodes = (body) => ({
    ...ctxNodes(body, staff),
    Config: [item({ body, GHL_GOOGLE_ADS_TAG: "from google ads" })],
    "Validate input": [item({ valid: true, action: body.action, client_id: clientA })],
    "Get client": [item({ id: clientA, name: "McCall Gardens", ghl_location_id: "loc 1" })],
    "GHL: location token": [item({ statusCode: 201, body: { access_token: "loc-token" } })],
    "GHL: get custom fields": [item({ statusCode: 200, body: { customFields: [{ name: "GCLID", fieldKey: "contact.gclid" }, { name: "utm_source", fieldKey: "contact.utm_source" }] } })],
  });
  const tags = item({ statusCode: 200, body: { tags: [{ name: "Other" }] } });
  const setup = await run("ff-ghl-setup/plan.js", { input: [tags], nodes: nodes({ action: "setup", client_id: clientA }) });
  assert.equal(setup.length, 7, "6 missing fields + the tag");
  assert.ok(setup.every((i) => i.json.kind === "create" && i.json.url.startsWith("https://services.leadconnectorhq.com/locations/loc%201/")));
  assert.ok(!setup.some((i) => i.json.body.name === "gclid"));
  assert.deepEqual(setup.at(-1).json.body, { name: "from google ads" });
  const check = await run("ff-ghl-setup/plan.js", { input: [tags], nodes: nodes({ action: "check", client_id: clientA }) });
  assert.equal(check.length, 1);
  assert.equal(check[0].json.kind, "done");
  assert.equal(check[0].json.body.ok, false);
  assert.match(check[0].json.body.message, /missing fields: gbraid/);
  const refused = await run("ff-ghl-setup/plan.js", { input: [item({ statusCode: 401 })], nodes: nodes({ action: "check", client_id: clientA }) });
  assert.equal(refused[0].json.status, 502);
  assert.match(refused[0].json.body.message, /GHL refused the sub-account token/);
  const n = nodes({ action: "check", client_id: clientA });
  n["GHL: location token"] = [item({ statusCode: 403, body: {} })];
  const noAgency = await run("ff-ghl-setup/plan.js", { input: [tags], nodes: n });
  assert.equal(noAgency[0].json.status, 502);
  assert.match(noAgency[0].json.body.message, /oauth.readonly and oauth.write/);
});

await test("ghl setup: sub-account list keeps only id, name and town, sorted", async () => {
  const [ok] = await run("ff-ghl-setup/format-locations.js", {
    input: [item({ statusCode: 200, body: { locations: [
      { id: "b1", name: "Zeta Cremation", city: "Austin", state: "TX", email: "owner@zeta.test", phone: "+15125550100" },
      { id: "a1", name: "McCall Gardens", city: "Mount Pleasant", state: "SC" },
    ] } })],
  });
  assert.deepEqual(ok.json.body.locations, [
    { id: "a1", name: "McCall Gardens", town: "Mount Pleasant, SC" },
    { id: "b1", name: "Zeta Cremation", town: "Austin, TX" },
  ]);
  const [bad] = await run("ff-ghl-setup/format-locations.js", { input: [item({ statusCode: 403 })] });
  assert.equal(bad.json.status, 502);
  assert.match(bad.json.body.error, /connected as the agency/);
});

await test("ghl setup: summary matches created items by name, not position", async () => {
  const plan = [{ what: "field gbraid" }, { what: "field wbraid" }, { what: "tag from google ads" }].map(item);
  const [out] = await run("ff-ghl-setup/summarize.js", {
    input: [
      item({ statusCode: 201, body: { tag: { name: "from google ads" } } }),
      item({ statusCode: 422, body: { message: "exists" } }),
      item({ statusCode: 201, body: { customField: { name: "gbraid" } } }),
    ],
    nodes: { Plan: plan },
  });
  assert.deepEqual(out.json.body.created, ["field gbraid", "tag from google ads"]);
  assert.deepEqual(out.json.body.failed, ["field wbraid"]);
  assert.equal(out.json.status, 502);
});

// ------------------------------------------------------------------ negatives (apply, PDF task 5)
const negBody = (o = {}) => ({ source: "negatives", source_id: "66666666-6666-4666-8666-666666666666", level: "list", match_type: "PHRASE", terms: ["Free  Cremation", "urns for sale"], ...o });

await test("negatives validate: plain terms pass, names, placeholders and broad match are refused", async () => {
  const [ok] = await run("ff-apply-campaign-action/validate.js", { nodes: ctxNodes(negBody(), rob) });
  assert.equal(ok.json.valid, true);
  assert.deepEqual(ok.json.terms, ["free cremation", "urns for sale"]);
  for (const [body, re] of [
    [negBody({ terms: ["[name removed - obituary]"] }), /not a plain search term/],
    [negBody({ terms: ["john cremation"] }), /person's name/],
    [negBody({ match_type: "BROAD" }), /PHRASE or EXACT/],
    [negBody({ level: "account" }), /campaign or list/],
    [negBody({ terms: [] }), /1 to 50/],
  ]) {
    const [out] = await run("ff-apply-campaign-action/validate.js", { nodes: ctxNodes(body, rob) });
    assert.equal(out.json.valid, false);
    assert.match(out.json.body.error, re);
  }
});

const negCtx = (o = {}) => ({
  found: true, customer_id: "1234567890", campaign_id: "10", action_status: "proposed", campaign_row_id: "c1",
  login_customer_id: "9998887777", is_test_account: true, writes_enabled: false, universal_list_id: "77",
  existing_campaign_negatives: [], existing_list_negatives: ["free cremation|PHRASE"], ...o,
});
const negNodes = (body) => ctxNodes({}, rob, { "Validate input": [item({ valid: true, ...body, terms: body.terms.map((t) => t.toLowerCase().replace(/\s+/g, " ")) })] });

await test("negatives plan: list adds shared criteria, skips ones already there; campaign adds negative criteria", async () => {
  const [list] = await run("ff-apply-campaign-action/plan.js", { input: [item(negCtx())], nodes: negNodes(negBody()) });
  assert.equal(list.json.ok, true);
  assert.equal(list.json.url_suffix, "sharedCriteria:mutate");
  assert.deepEqual(list.json.mutate_body.operations, [{ create: { sharedSet: "customers/1234567890/sharedSets/77", keyword: { text: "urns for sale", matchType: "PHRASE" } } }]);
  assert.equal(list.json.action.skipped, 1);
  const [camp] = await run("ff-apply-campaign-action/plan.js", { input: [item(negCtx())], nodes: negNodes(negBody({ level: "campaign", match_type: "EXACT" })) });
  assert.equal(camp.json.url_suffix, "campaignCriteria:mutate");
  assert.equal(camp.json.mutate_body.operations.length, 2);
  assert.deepEqual(camp.json.mutate_body.operations[0].create, { campaign: "customers/1234567890/campaigns/10", negative: true, keyword: { text: "free cremation", matchType: "EXACT" } });
});

await test("negatives plan: guards - live account without writes, no universal list, nothing new", async () => {
  for (const [ctx, body, status] of [
    [negCtx({ is_test_account: false }), negBody(), 403],
    [negCtx({ universal_list_id: null }), negBody(), 422],
    [negCtx({ existing_list_negatives: ["free cremation|PHRASE", "urns for sale|PHRASE"] }), negBody(), 409],
    [{ found: false }, negBody(), 404],
  ]) {
    const [out] = await run("ff-apply-campaign-action/plan.js", { input: [item(ctx)], nodes: negNodes(body) });
    assert.equal(out.json.ok, false);
    assert.equal(out.json.status, status);
  }
});

await test("negatives records: success logs validate + apply and answers with the count", async () => {
  const nodes = negNodes(negBody());
  nodes["Plan change"] = await run("ff-apply-campaign-action/plan.js", { input: [item(negCtx())], nodes });
  nodes["Validate change"] = [item({ statusCode: 200, body: {} })];
  nodes["Apply change"] = [item({ statusCode: 200, body: { results: [{ resourceName: "x" }] } })];
  const out = await run("ff-apply-campaign-action/records.js", { nodes });
  assert.deepEqual(out[0].json.respond, { status: 200, body: { ok: true, added: 1, skipped: 1, level: "list" } });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].json.body.map((l) => [l.operation, l.validate_only]), [["add_negatives", true], ["add_negatives", false]]);
});

// ------------------------------------------------------------------ case match (PDF task 6)
const caseBody = (o = {}) => ({
  action: "check", client_id: clientA, customer_id: "123-456-7890", month: "2026-09",
  cases: [
    { case_date: "2026-09-03", gclid: "EAIaIQobChMI_test_gclid_1", value: 4200 },
    { case_date: "2026-09-10", email: " Jane.Doe@Gmail.com ", phone: "(843) 555-0100" },
    { case_date: "2026-09-12", phone: "843-555-0101", call_time: "2026-09-08 14:05" },
    { case_date: "2026-09-20" },
    { case_date: "2026-08-30", gclid: "EAIaIQobChMI_test_gclid_2" },
  ],
  ...o,
});

await test("case match validate: name columns refuse the list; upload is Rob only", async () => {
  const [ok] = await run("ff-case-match/validate.js", { nodes: ctxNodes(caseBody(), staff) });
  assert.equal(ok.json.valid, true);
  assert.equal(ok.json.customer_id, "1234567890");
  const [named] = await run("ff-case-match/validate.js", { nodes: ctxNodes(caseBody({ cases: [{ case_date: "2026-09-03", family_name: "x" }] }), staff) });
  assert.equal(named.json.valid, false);
  assert.match(named.json.body.error, /not allowed: "family_name"/);
  const [up] = await run("ff-case-match/validate.js", { nodes: ctxNodes(caseBody({ action: "upload" }), staff) });
  assert.equal(up.json.status, 403);
});

const caseCtx = (o = {}) => ({
  found: true, customer_id: "1234567890", login_customer_id: "9998887777", is_test_account: true, writes_enabled: false,
  currency_code: "USD", time_zone: "America/New_York", case_value_micros: 3500000000,
  click_action: { id: "501", name: "FF - Signed case" }, call_action: { id: "502", name: "FF - Signed case call" }, ...o,
});
const caseNodes = (body, ctx, earlier = [item({})]) => ctxNodes({}, rob, {
  "Validate input": [item({ valid: true, ...body, customer_id: "1234567890", again: body.again === true })],
  "Get case match context": [item(ctx)],
  "Get earlier uploads": earlier,
});

await test("case match plan: click, enhanced and call conversions; hashes, offsets, skips", async () => {
  const [out] = await run("ff-case-match/plan.js", { nodes: caseNodes(caseBody(), caseCtx()) });
  assert.equal(out.json.ok, true);
  const click = out.json.uploads.find((u) => u.kind === "click");
  const call = out.json.uploads.find((u) => u.kind === "call");
  assert.equal(click.url_suffix, ":uploadClickConversions");
  assert.equal(click.body.partialFailure, true);
  assert.equal(click.body.conversions.length, 2);
  const [c1, c2] = click.body.conversions;
  assert.equal(c1.gclid, "EAIaIQobChMI_test_gclid_1");
  assert.equal(c1.conversionAction, "customers/1234567890/conversionActions/501");
  assert.equal(c1.conversionDateTime, "2026-09-03 12:00:00-04:00");
  assert.equal(c1.conversionValue, 4200);
  assert.ok(/^ff-[0-9a-f]{28}$/.test(c1.orderId));
  // email normalised (trim, lower case, gmail dots removed) then SHA-256; phone to E.164 then SHA-256
  assert.equal(c2.conversionValue, 3500);
  assert.equal(c2.userIdentifiers.length, 2);
  assert.ok(c2.userIdentifiers.every((u) => /^[0-9a-f]{64}$/.test(u.hashedEmail || u.hashedPhoneNumber)));
  assert.ok(!JSON.stringify(click.body).includes("Jane") && !JSON.stringify(click.body).includes("555-0100"));
  assert.deepEqual(call.body.conversions[0], {
    callerId: "+18435550101", callStartDateTime: "2026-09-08 14:05:00-04:00",
    conversionAction: "customers/1234567890/conversionActions/502", conversionDateTime: "2026-09-12 12:00:00-04:00",
    conversionValue: 3500, currencyCode: "USD",
  });
  assert.deepEqual(out.json.reasons, { "no click id, phone or email": 1, "case_date outside the month": 1 });
  assert.equal(out.json.counts.skipped, 2);
});

await test("case match plan: guards - live account, earlier upload, missing conversion action", async () => {
  const [live] = await run("ff-case-match/plan.js", { nodes: caseNodes(caseBody({ action: "upload" }), caseCtx({ is_test_account: false })) });
  assert.equal(live.json.status, 403);
  const [again] = await run("ff-case-match/plan.js", { nodes: caseNodes(caseBody({ action: "upload" }), caseCtx(), [item({ id: "r1", created_at: "2026-10-01T10:00:00Z" })]) });
  assert.equal(again.json.status, 409);
  const [checkAgain] = await run("ff-case-match/plan.js", { nodes: caseNodes(caseBody(), caseCtx(), [item({ id: "r1", created_at: "2026-10-01T10:00:00Z" })]) });
  assert.equal(checkAgain.json.ok, true, "a check run is allowed after an upload");
  const [noAction] = await run("ff-case-match/plan.js", { nodes: caseNodes(caseBody(), caseCtx({ click_action: null })) });
  assert.equal(noAction.json.reasons['no "Case signed" conversion action yet - Rob: client page > Call tracking > Set up call tracking'], 2);
});

await test("case match records: counts from partial failure, no case data saved, check never uploads", async () => {
  const nodes = caseNodes(caseBody(), caseCtx());
  nodes["Plan uploads"] = await run("ff-case-match/plan.js", { nodes });
  const reqs = nodes["Plan uploads"][0].json.uploads.map((u) => item({ kind: u.kind, sent: u.sent }));
  nodes["Upload requests"] = reqs;
  const partial = { statusCode: 200, body: { partialFailureError: { code: 3, message: "x", details: [{ errors: [{ errorCode: { conversionUploadError: "CLICK_NOT_FOUND" }, message: "EAIaIQobChMI_test_gclid_1 not found", location: { fieldPathElements: [{ fieldName: "conversions", index: 0 }] } }] }] }, results: [{}, {}] } };
  const fine = { statusCode: 200, body: { results: [{}] } };
  nodes["Check validation"] = await run("ff-case-match/check.js", { input: [item(partial), item(fine)], nodes });
  assert.equal(nodes["Check validation"][0].json.go, false, "check action never uploads");
  const out = await run("ff-case-match/records.js", { nodes });
  const runRow = out.find((o) => o.json.path === "case_match_runs").json.body;
  assert.equal(runRow.validate_only, true);
  assert.equal(runRow.accepted, 2);
  assert.equal(runRow.rejected, 1);
  assert.equal(runRow.reasons.CLICK_NOT_FOUND, 1);
  assert.equal(runRow.status, "partial");
  const saved = JSON.stringify(out.map((o) => o.json.body));
  for (const leak of ["EAIaIQ", "gmail", "843", "2026-09-03"]) assert.ok(!saved.includes(leak), `saved data must not contain ${leak}`);
  assert.equal(out[0].json.respond.status, 200);
});

await test("case match records: Rob's upload after a clean check is logged as a real write", async () => {
  const body = caseBody({ action: "upload" });
  const nodes = caseNodes(body, caseCtx());
  nodes["Plan uploads"] = await run("ff-case-match/plan.js", { nodes });
  nodes["Upload requests"] = nodes["Plan uploads"][0].json.uploads.map((u) => item({ kind: u.kind, sent: u.sent }));
  const fine = (n) => item({ statusCode: 200, body: { results: Array(n).fill({}) } });
  nodes["Check validation"] = await run("ff-case-match/check.js", { input: [fine(2), fine(1)], nodes });
  assert.equal(nodes["Check validation"][0].json.go, true);
  nodes["Real upload requests"] = nodes["Upload requests"];
  nodes["Upload conversions"] = [fine(2), fine(1)];
  const out = await run("ff-case-match/records.js", { nodes });
  const runRow = out.find((o) => o.json.path === "case_match_runs").json.body;
  assert.equal(runRow.validate_only, false);
  assert.equal(runRow.accepted, 3);
  const logs = out.find((o) => o.json.path === "write_log").json.body;
  assert.deepEqual(logs.map((l) => [l.operation, l.validate_only]), [
    ["upload_click_conversions", true], ["upload_call_conversions", true],
    ["upload_click_conversions", false], ["upload_call_conversions", false],
  ]);
  assert.equal(out[0].json.respond.body.uploaded, true);
});

// ------------------------------------------------------------------ gaql (PDF task 1, read only)
await test("gaql validate: one SELECT only, caller details refused, limit bounded", async () => {
  const [ok] = await run("ff-gaql/validate.js", { nodes: ctxNodes({ customer_id: "123-456-7890", query: "SELECT campaign.name FROM campaign" }, staff) });
  assert.deepEqual(ok.json, { valid: true, customer_id: "1234567890", query: "SELECT campaign.name FROM campaign", limit: 200 });
  for (const [body, re] of [
    [{ customer_id: "1234567890", query: "SELECT a FROM b; SELECT c FROM d" }, /Only one SELECT/],
    [{ customer_id: "1234567890", query: "DELETE campaign" }, /Only one SELECT/],
    [{ customer_id: "1234567890", query: "SELECT call_view.caller_area_code FROM call_view" }, /Caller phone/],
    [{ customer_id: "1234567890", query: "SELECT campaign.name FROM campaign", limit: 5000 }, /limit/],
    [{ customer_id: "12", query: "SELECT campaign.name FROM campaign" }, /10 digits/],
  ]) {
    const [out] = await run("ff-gaql/validate.js", { nodes: ctxNodes(body, staff) });
    assert.equal(out.json.valid, false);
    assert.match(out.json.body.error, re);
  }
});

await test("gaql shape: search terms are name-filtered, rows capped at the limit", async () => {
  const answer = JSON.stringify([{ results: [
    { searchTermView: { searchTerm: "john smith obituary" }, metrics: { clicks: "3" } },
    { searchTermView: { searchTerm: "cremation cost" }, metrics: { clicks: "9" } },
    { searchTermView: { searchTerm: "direct cremation" }, metrics: { clicks: "1" } },
  ] }]);
  const [out] = await run("ff-gaql/shape.js", {
    input: [item({ statusCode: 200, body: answer })],
    nodes: {
      "Validate input": [item({ customer_id: "1234567890", limit: 2 })],
      "Get account": [item({ customer_id: "1234567890", descriptive_name: "Pilot", clients: { towns: [], own_brand_terms: [], competitor_terms: [] } })],
    },
  });
  assert.equal(out.json.status, 200);
  assert.equal(out.json.body.total, 3);
  assert.equal(out.json.body.returned, 2);
  assert.equal(out.json.body.truncated, true);
  assert.equal(out.json.body.rows[0].searchTermView.searchTerm, "[name removed - obituary]");
  assert.equal(out.json.body.rows[1].searchTermView.searchTerm, "cremation cost");
  assert.ok(!JSON.stringify(out.json).includes("smith"));
});

// ------------------------------------------------------------------ call tracking setup (PDF task 2)
const trackCtx = (t = {}, o = {}) => ({
  found: true, customer_id: "1234567890", action_status: "proposed", login_customer_id: "9998887777",
  is_test_account: true, writes_enabled: false,
  tracking: {
    client_phone: "843-555-0100", case_value_micros: 3500000000, currency_code: "USD", last_synced_at: "2026-10-05T06:00:00Z",
    call_reporting_enabled: false, call_conversion_reporting_enabled: false, auto_tagging_enabled: true,
    call_actions: [],
    account_call_assets: 0, ...t,
  },
  ...o,
});
const trackNodes = () => ctxNodes({}, rob, { "Validate input": [item({ valid: true, source: "tracking", source_id: clientA, customer_id: "1234567890" })] });

await test("tracking validate: needs a client id and a 10-digit account", async () => {
  const [ok] = await run("ff-apply-campaign-action/validate.js", { nodes: ctxNodes({ source: "tracking", source_id: clientA, customer_id: "123-456-7890" }, rob) });
  assert.deepEqual(ok.json, { valid: true, source: "tracking", source_id: clientA, customer_id: "1234567890" });
  const [bad] = await run("ff-apply-campaign-action/validate.js", { nodes: ctxNodes({ source: "tracking", source_id: clientA }, rob) });
  assert.equal(bad.json.valid, false);
});

await test("tracking plan: turns on call reporting, creates both 90s actions, plans the account call asset", async () => {
  const [out] = await run("ff-apply-campaign-action/plan.js", { input: [item(trackCtx())], nodes: trackNodes() });
  assert.equal(out.json.ok, true);
  const [acct, conv] = out.json.tracking.requests_a;
  assert.equal(acct.url_suffix, ":mutate");
  assert.deepEqual(acct.body.operation.update.callReportingSetting, { callReportingEnabled: true, callConversionReportingEnabled: true });
  assert.equal(conv.url_suffix, "/conversionActions:mutate");
  assert.deepEqual(conv.op_types, ["AD_CALL", "WEBSITE_CALL", "UPLOAD_CLICKS", "UPLOAD_CALLS", "WEBPAGE"]);
  for (const op of conv.body.operations.slice(0, 2)) {
    assert.equal(op.create.phoneCallDurationSeconds, 90);
    assert.equal(op.create.primaryForGoal, true);
    assert.equal(op.create.valueSettings.defaultValue, 3500);
  }
  assert.deepEqual(conv.body.operations.map((o) => o.create.name), ["Calls from ads 90s+", "Calls from website 90s+", "Case signed", "Case signed - calls", "Preplanning form"]);
  assert.deepEqual(conv.body.operations[4].create, { name: "Preplanning form", type: "WEBPAGE", category: "SUBMIT_LEAD_FORM", status: "ENABLED", primaryForGoal: true, countingType: "ONE_PER_CLICK" });
  for (const op of conv.body.operations.slice(2, 4)) {
    assert.equal(op.create.category, "CONVERTED_LEAD");
    assert.equal(op.create.primaryForGoal, false, "case signed is reported, bidding stays Rob's call");
    assert.equal(op.create.phoneCallDurationSeconds, undefined);
  }
  assert.equal(out.json.tracking.need_asset, true);
  assert.equal(out.json.tracking.phone, "(843) 555-0100");
  assert.equal(out.json.tracking.ad_call_action, null);
  assert.ok(!JSON.stringify(out.json).toLowerCase().includes("record"), "never sets call recording");
});

await test("tracking plan: existing 90s actions and asset are left alone; our action at 60s is fixed; guards", async () => {
  const done = trackCtx({ call_reporting_enabled: true, call_conversion_reporting_enabled: true, account_call_assets: 1,
    call_actions: [{ id: "5", name: "Calls from ads 90s+", type: "AD_CALL", status: "ENABLED", seconds: 90 }, { id: "6", name: "Calls from website 90s+", type: "WEBSITE_CALL", status: "ENABLED", seconds: 90 }, { id: "8", name: "Case signed", type: "UPLOAD_CLICKS", status: "ENABLED", seconds: null }, { id: "9", name: "Case signed - calls", type: "UPLOAD_CALLS", status: "ENABLED", seconds: null }, { id: "10", name: "Leads", type: "WEBPAGE", category: "SUBMIT_LEAD_FORM", status: "ENABLED", seconds: null }] });
  const [already] = await run("ff-apply-campaign-action/plan.js", { input: [item(done)], nodes: trackNodes() });
  assert.equal(already.json.status, 409);

  const fix = trackCtx({ call_reporting_enabled: true, call_conversion_reporting_enabled: true,
    call_actions: [{ id: "5", name: "Calls from ads 90s+", type: "AD_CALL", status: "ENABLED", seconds: 60 }, { id: "6", name: "Calls from website 90s+", type: "WEBSITE_CALL", status: "ENABLED", seconds: 90 }, { id: "8", name: "Case signed", type: "UPLOAD_CLICKS", status: "ENABLED", seconds: null }, { id: "9", name: "Case signed - calls", type: "UPLOAD_CALLS", status: "ENABLED", seconds: null }, { id: "10", name: "Leads", type: "WEBPAGE", category: "SUBMIT_LEAD_FORM", status: "ENABLED", seconds: null }] });
  const [fixed] = await run("ff-apply-campaign-action/plan.js", { input: [item(fix)], nodes: trackNodes() });
  assert.equal(fixed.json.tracking.requests_a.length, 1);
  assert.deepEqual(fixed.json.tracking.requests_a[0].body.operations[0].update,
    { resourceName: "customers/1234567890/conversionActions/5", status: "ENABLED", phoneCallDurationSeconds: 90 });
  assert.equal(fixed.json.tracking.ad_call_action, "customers/1234567890/conversionActions/5");

  for (const [ctx, status] of [
    [trackCtx({}, { is_test_account: false }), 403],
    [trackCtx({ client_phone: null }), 422],
    [trackCtx({ client_phone: null, asset_phone: "+1 843-555-0199" }), null],
    [trackCtx({ last_synced_at: null }), 409],
    [{ found: false }, 404],
  ]) {
    const [out] = await run("ff-apply-campaign-action/plan.js", { input: [item(ctx)], nodes: trackNodes() });
    if (status === null) {
      assert.equal(out.json.tracking.phone, "(843) 555-0199", "falls back to the phone on an existing call asset");
      continue;
    }
    assert.equal(out.json.status, status);
  }
});

await test("tracking step B: the call asset uses the action step A just created", async () => {
  const nodes = trackNodes();
  nodes["Plan change"] = await run("ff-apply-campaign-action/plan.js", { input: [item(trackCtx())], nodes });
  const reqs = nodes["Plan change"][0].json.tracking.requests_a;
  nodes["Tracking: real requests"] = reqs.map((r) => item(r));
  nodes["Apply tracking"] = [
    item({ statusCode: 200, body: { resourceName: "customers/1234567890" } }),
    item({ statusCode: 200, body: { results: [{ resourceName: "customers/1234567890/conversionActions/901" }, { resourceName: "customers/1234567890/conversionActions/902" }] } }),
  ];
  const [b] = await run("ff-apply-campaign-action/plan-asset.js", { nodes });
  assert.equal(b.json.need, true);
  const [assetOp, linkOp] = b.json.body.mutateOperations;
  assert.deepEqual(assetOp.assetOperation.create.callAsset, {
    countryCode: "US", phoneNumber: "(843) 555-0100",
    callConversionReportingState: "USE_RESOURCE_LEVEL_CALL_CONVERSION_ACTION",
    callConversionAction: "customers/1234567890/conversionActions/901",
  });
  assert.deepEqual(linkOp.customerAssetOperation.create, { asset: "customers/1234567890/assets/-1", fieldType: "CALL" });

  nodes["Apply tracking"][1] = item({ statusCode: 400, body: { error: { message: "bad" } } });
  const [failed] = await run("ff-apply-campaign-action/plan-asset.js", { nodes });
  assert.equal(failed.json.need, false);
  assert.equal(failed.json.failed, true);
});

await test("tracking records: both steps logged; answer lists the steps", async () => {
  const nodes = trackNodes();
  nodes["Plan change"] = await run("ff-apply-campaign-action/plan.js", { input: [item(trackCtx())], nodes });
  const reqs = nodes["Plan change"][0].json.tracking.requests_a.map((r) => item(r));
  nodes["Tracking: requests"] = reqs;
  nodes["Tracking: real requests"] = reqs;
  const ok = item({ statusCode: 200, body: { results: [{ resourceName: "customers/1234567890/conversionActions/901" }] } });
  nodes["Validate tracking"] = [ok, ok];
  nodes["Apply tracking"] = [ok, ok];
  nodes["Plan call asset"] = [item({ need: true, body: {} })];
  nodes["Validate call asset"] = [ok];
  nodes["Apply call asset"] = [ok];
  const out = await run("ff-apply-campaign-action/records.js", { nodes });
  assert.equal(out[0].json.respond.status, 200);
  assert.equal(out[0].json.respond.body.steps.length, 7, "settings, 2 call actions, 2 case signed actions, preplanning form, call asset");
  const logs = out[0].json.body;
  assert.deepEqual(logs.map((l) => [l.request.step, l.validate_only]), [
    ["account", true], ["conversion_actions", true], ["account", false], ["conversion_actions", false],
    ["call asset", true], ["call asset", false],
  ]);
  assert.ok(logs.every((l) => l.operation === "setup_call_tracking"));
});

await test("tracking plan (real account shape): 10s call actions are set to 90s, no duplicates, no second call asset, Canada", async () => {
  const real = trackCtx({
    client_phone: null, asset_phone: "250-483-2559", case_value_micros: null, currency_code: "CAD",
    call_reporting_enabled: true, call_conversion_reporting_enabled: true, auto_tagging_enabled: true,
    call_actions: [
      { id: "273335022", name: "Calls from ADS", type: "AD_CALL", status: "ENABLED", seconds: 10 },
      { id: "7155638308", name: "Calls from website", type: "WEBSITE_CALL", status: "ENABLED", seconds: 10 },
    ],
    account_call_assets: 0, search_campaigns_without_call_asset: 0,
  }, { writes_enabled: true, is_test_account: false });
  const [out] = await run("ff-apply-campaign-action/plan.js", { input: [item(real)], nodes: trackNodes() });
  assert.equal(out.json.ok, true);
  assert.equal(out.json.tracking.requests_a.length, 1, "account settings already on");
  const ops = out.json.tracking.requests_a[0].body.operations;
  assert.ok(ops.slice(0, 2).every((o) => o.update && !o.create), "existing call actions are updated, no second call action");
  assert.deepEqual(ops.slice(2).map((o) => o.create.name), ["Case signed", "Case signed - calls", "Preplanning form"]);
  assert.deepEqual(ops.slice(0, 2).map((o) => [o.update.resourceName, o.update.phoneCallDurationSeconds]), [
    ["customers/1234567890/conversionActions/273335022", 90],
    ["customers/1234567890/conversionActions/7155638308", 90],
  ]);
  assert.equal(out.json.tracking.need_asset, false, "campaigns already show a number");
  assert.equal(out.json.tracking.country_code, "CA");
  assert.equal(out.json.tracking.ad_call_action, "customers/1234567890/conversionActions/273335022");
});

// ------------------------------------------------------------------ blocked-words list (PDF task 5)
const neglistCtx = (n = {}, o = {}) => ({
  found: true, customer_id: "1234567890", action_status: "proposed", login_customer_id: "9998887777",
  is_test_account: false, writes_enabled: true,
  neglist: {
    last_synced_at: "2026-10-06T06:00:00Z", client_name: "Pacific Coast Cremation", own_brand_terms: [],
    competitor_terms: ["Smith Funeral Home"], list_id: null, list_terms: [],
    campaigns: [{ id: "10", name: "Cremation - Local", linked: false }, { id: "11", name: "Preplanning", linked: false }],
    universal: [{ text: "obituary", match_type: "BROAD" }, { text: "mortuary school", match_type: "PHRASE" }],
    ...n,
  },
  ...o,
});
const neglistNodes = () => ctxNodes({}, rob, { "Validate input": [item({ valid: true, source: "neglist", source_id: clientA, customer_id: "1234567890" })] });

await test("blocked-words list: new account gets the list, FF words, own name, competitors, and every search campaign", async () => {
  const [out] = await run("ff-apply-campaign-action/plan.js", { input: [item(neglistCtx())], nodes: neglistNodes() });
  assert.equal(out.json.ok, true);
  assert.equal(out.json.url_suffix, "googleAds:mutate");
  const ops = out.json.mutate_body.mutateOperations;
  assert.deepEqual(ops[0].sharedSetOperation.create, { resourceName: "customers/1234567890/sharedSets/-1", name: "FF - Funeral universal negatives", type: "NEGATIVE_KEYWORDS" });
  const words = ops.filter((o) => o.sharedCriterionOperation).map((o) => `${o.sharedCriterionOperation.create.keyword.text}|${o.sharedCriterionOperation.create.keyword.matchType}`);
  assert.deepEqual(words, ["obituary|BROAD", "mortuary school|PHRASE", "pacific coast cremation|PHRASE", "smith funeral home|PHRASE"]);
  const links = ops.filter((o) => o.campaignSharedSetOperation).map((o) => o.campaignSharedSetOperation.create);
  assert.deepEqual(links, [
    { campaign: "customers/1234567890/campaigns/10", sharedSet: "customers/1234567890/sharedSets/-1" },
    { campaign: "customers/1234567890/campaigns/11", sharedSet: "customers/1234567890/sharedSets/-1" },
  ]);
});

await test("blocked-words list: existing list only gets what is missing; complete account is refused; guards", async () => {
  const partial = neglistCtx({ list_id: "77", list_terms: ["obituary|BROAD", "mortuary school|PHRASE", "pacific coast cremation|PHRASE"],
    campaigns: [{ id: "10", name: "Cremation - Local", linked: true }, { id: "11", name: "Preplanning", linked: false }] });
  const [out] = await run("ff-apply-campaign-action/plan.js", { input: [item(partial)], nodes: neglistNodes() });
  const ops = out.json.mutate_body.mutateOperations;
  assert.ok(!ops.some((o) => o.sharedSetOperation));
  assert.deepEqual(ops.map((o) => Object.keys(o)[0]), ["sharedCriterionOperation", "campaignSharedSetOperation"]);
  assert.equal(ops[0].sharedCriterionOperation.create.sharedSet, "customers/1234567890/sharedSets/77");

  const full = neglistCtx({ list_id: "77", list_terms: ["obituary|BROAD", "mortuary school|PHRASE", "pacific coast cremation|PHRASE", "smith funeral home|PHRASE"],
    campaigns: [{ id: "10", name: "x", linked: true }] });
  const [done] = await run("ff-apply-campaign-action/plan.js", { input: [item(full)], nodes: neglistNodes() });
  assert.equal(done.json.status, 409);
  const [locked] = await run("ff-apply-campaign-action/plan.js", { input: [item(neglistCtx({}, { writes_enabled: false }))], nodes: neglistNodes() });
  assert.equal(locked.json.status, 403);
  const [notSynced] = await run("ff-apply-campaign-action/plan.js", { input: [item(neglistCtx({ last_synced_at: null }))], nodes: neglistNodes() });
  assert.equal(notSynced.json.status, 409);
});

// ------------------------------------------------------------------ weekly search-term triage
const triageNodes = (candidates, useAi = true) => ({
  Config: [item({ USE_AI: useAi })],
  "Get blocked words": [item({ text: "obituary", match_type: "BROAD", theme: "obituaries" }), item({ text: "mortuary school", match_type: "PHRASE", theme: "jobs" })],
  "Get candidates": candidates.map((c) => item(c)),
});
const cand = {
  customer_id: "1234567890", campaign_id: "10", campaign_name: "Cremation - Local", client_name: "Pacific Coast Cremation",
  process: "funeral_home", towns: ["Victoria"], own_brand_terms: [], competitor_terms: ["smith funeral home"],
  terms: [
    { term_hash: "a".repeat(64), term: "victoria obituary", cost_micros: 900000, clicks: 2, conversions: 0 },
    { term_hash: "b".repeat(64), term: "smith funeral home prices", cost_micros: 500000, clicks: 1, conversions: 0 },
    { term_hash: "c".repeat(64), term: "pacific coast cremation reviews", cost_micros: 400000, clicks: 1, conversions: 0 },
    { term_hash: "d".repeat(64), term: "cremation cost victoria", cost_micros: 3000000, clicks: 5, conversions: 1 },
    { term_hash: "e".repeat(64), term: "how long does cremation take", cost_micros: 200000, clicks: 1, conversions: 0 },
  ],
};

await test("triage rules: FF words, competitors and own name are blocked without AI; the rest goes to the AI", async () => {
  const [out] = await run("ff-search-triage/rules.js", { nodes: triageNodes([cand]) });
  assert.deepEqual(out.json.rule_rows.map((r) => [r.term_hash[0], r.decision, r.theme, r.decided_how]), [
    ["a", "block", "obituaries", "rule"], ["b", "block", "competitor", "rule"], ["c", "block", "own name", "rule"],
  ]);
  assert.equal(out.json.ai_batches.length, 1);
  assert.deepEqual(out.json.ai_batches[0].terms.map((t) => t.term_hash[0]), ["d", "e"]);
  assert.match(out.json.ai_batches[0].list, /^1\. cremation cost victoria \(clicks 5, conversions 1\)\n2\. how long does cremation take/);
  const [noAi] = await run("ff-search-triage/rules.js", { nodes: triageNodes([cand], false) });
  assert.equal(noAi.json.ai_batches.length, 0);
  assert.equal(noAi.json.rule_rows.filter((r) => r.decision === "ask_rob").length, 2, "without AI the rest goes to Rob");
});

await test("triage save: AI answers matched by number; missing or bad answers go to Rob", async () => {
  const nodes = triageNodes([cand]);
  nodes["Rule triage"] = await run("ff-search-triage/rules.js", { nodes });
  nodes["AI batches"] = nodes["Rule triage"][0].json.ai_batches.map((b) => item(b));
  nodes["Sort (AI Agent)"] = [item({ output: { decisions: [{ n: 1, decision: "keep", theme: "pricing" }, { n: 9, decision: "block", theme: "x" }] } })];
  const [out] = await run("ff-search-triage/save-rows.js", { nodes });
  const byHash = Object.fromEntries(out.json.rows.map((r) => [r.term_hash[0], r]));
  assert.equal(byHash.d.decision, "keep");
  assert.equal(byHash.d.decided_how, "ai");
  assert.equal(byHash.e.decision, "ask_rob", "no answer for number 2 - Rob decides");
  assert.deepEqual(out.json.counts, { keep: 1, block: 3, ask_rob: 1 });
  assert.ok(out.json.rows.every((r) => r.decided_by === null));

  delete nodes["Sort (AI Agent)"];
  const [noAi] = await run("ff-search-triage/save-rows.js", { nodes });
  assert.equal(noAi.json.total, 3, "only the rule rows when the AI did not run");
});

await test("case match (Robin's list): case_type counted, cases older than 90 days unattributed not failed, matched counted", async () => {
  const old = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
  const recent = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
  const month = recent.slice(0, 7);
  const body = {
    action: "check", client_id: clientA, customer_id: "1234567890", month,
    cases: [
      { case_date: recent, case_type: "At-need", phone: "(250) 483-2559" },
      { case_date: recent, case_type: "Preneed", email: "family@example.test" },
      { case_date: recent, case_type: "At-need", phone: "250 483 0000", call_time: `${old} 10:15` },
      { case_date: recent },
    ],
  };
  const [v] = await run("ff-case-match/validate.js", { nodes: ctxNodes(body, staff) });
  assert.equal(v.json.valid, true, "case_type is an allowed column");
  const nodes = caseNodes(body, caseCtx({ currency_code: "CAD", time_zone: "America/Vancouver" }));
  const [plan] = await run("ff-case-match/plan.js", { nodes });
  assert.equal(plan.json.ok, true);
  assert.equal(plan.json.counts.unattributed, 1, "first call more than 90 days ago");
  assert.equal(plan.json.counts.skipped, 1, "no phone, email or click id");
  assert.equal(plan.json.counts.matched, 2);
  assert.deepEqual(plan.json.counts.case_types, { "at-need": 2, preneed: 1, "not given": 1 });

  nodes["Plan uploads"] = [plan];
  nodes["Upload requests"] = plan.json.uploads.map((u) => item({ kind: u.kind, sent: u.sent }));
  nodes["Check validation"] = await run("ff-case-match/check.js", { input: [item({ statusCode: 200, body: { results: [{}, {}] } })], nodes });
  const out = await run("ff-case-match/records.js", { nodes });
  const runRow = out.find((o) => o.json.path === "case_match_runs").json.body;
  assert.equal(runRow.unattributed, 1);
  assert.equal(runRow.matched, 2);
  assert.equal(runRow.rejected, 0, "unattributed is never counted as rejected");
  assert.deepEqual(runRow.case_types, { "at-need": 2, preneed: 1, "not given": 1 });
  assert.ok(!JSON.stringify(runRow).includes("483"), "no phone digits saved");
});

// ------------------------------------------------------------------ case match straight from GHL (no CSV)
await test("case match from GHL: won opportunities of the month become cases; click id from the contact field or attribution", async () => {
  const recent = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
  const month = recent.slice(0, 7);
  const body = { action: "check", client_id: clientA, customer_id: "1234567890", month, source: "ghl" };
  const [v] = await run("ff-case-match/validate.js", { nodes: ctxNodes(body, staff) });
  assert.equal(v.json.valid, true);
  assert.equal(v.json.source, "ghl");
  const [both] = await run("ff-case-match/validate.js", { nodes: ctxNodes({ ...body, cases: [{ case_date: recent }] }, staff) });
  assert.equal(both.json.valid, false);

  const nodes = {
    "Validate input": [item(v.json)],
    "Get client GHL": [item({ ghl_location_id: "loc1" })],
    "GHL: location token": [item({ statusCode: 200, body: { access_token: "t" } })],
    "GHL: contact fields": [item({ statusCode: 200, body: { customFields: [{ id: "f1", fieldKey: "contact.gclid" }] } })],
  };
  const opps = { statusCode: 200, body: { meta: { total: 3 }, opportunities: [
    { id: "o1", status: "won", lastStatusChangeAt: `${recent}T15:00:00Z`, monetaryValue: 4200, contact: { id: "c1", name: "Family One" } },
    { id: "o2", status: "won", lastStatusChangeAt: "2025-01-10T15:00:00Z", contactId: "c2" },
    { id: "o3", status: "open", lastStatusChangeAt: `${recent}T15:00:00Z`, contactId: "c3" },
    { id: "o4", status: "won", updatedAt: `${recent}T09:00:00Z`, contactId: "c4" },
  ] } };
  nodes["GHL: won in month"] = await run("ff-case-match/ghl-won.js", { input: [item(opps)], nodes });
  assert.deepEqual(nodes["GHL: won in month"].map((i) => i.json.contact_id), ["c1", "c4"], "won, in the month only");
  assert.ok(!JSON.stringify(nodes["GHL: won in month"]).includes("Family"), "names are not carried on");

  nodes["GHL: get contacts"] = [
    item({ statusCode: 200, body: { contact: { phone: "+12505550101", email: "a@example.test", customFields: [{ id: "f1", value: "EAIaIQobChMI_from_form" }] } } }),
    item({ statusCode: 200, body: { contact: { phone: "+12505550102", attributionSource: { gclid: "EAIaIQobChMI_from_attr" } } } }),
  ];
  const [built] = await run("ff-case-match/ghl-cases.js", { nodes });
  assert.deepEqual(built.json.cases, [
    { case_date: recent, case_type: "ghl won", value: "4200", phone: "+12505550101", email: "a@example.test", gclid: "EAIaIQobChMI_from_form" },
    { case_date: recent, case_type: "ghl won", phone: "+12505550102", gclid: "EAIaIQobChMI_from_attr" },
  ]);

  nodes["GHL: build cases"] = [built];
  Object.assign(nodes, caseNodes(v.json, caseCtx()));
  nodes["Validate input"] = [item(v.json)];
  const [plan] = await run("ff-case-match/plan.js", { nodes });
  assert.equal(plan.json.ok, true);
  assert.equal(plan.json.counts.cases_in, 2);
  assert.equal(plan.json.uploads[0].body.conversions.length, 2);
  assert.equal(plan.json.uploads[0].body.conversions[0].gclid, "EAIaIQobChMI_from_form");
});

await test("case match from GHL: no sub-account, missing scope and an empty month give plain answers", async () => {
  const body = { valid: true, action: "check", client_id: clientA, customer_id: "1234567890", month: "2026-09", source: "ghl", cases: [] };
  const base = { "Validate input": [item(body)], "GHL: location token": [item({ statusCode: 200, body: { access_token: "t" } })] };
  const [noLoc] = await run("ff-case-match/ghl-won.js", { input: [item({ statusCode: 200, body: {} })], nodes: { ...base, "Get client GHL": [item({ ghl_location_id: null })] } });
  assert.match(noLoc.json.error, /no GHL sub-account/);
  const [scope] = await run("ff-case-match/ghl-won.js", { input: [item({ statusCode: 403, body: {} })], nodes: { ...base, "Get client GHL": [item({ ghl_location_id: "loc1" })] } });
  assert.match(scope.json.error, /opportunities.readonly/);

  const nodes = { ...caseNodes(body, caseCtx()), "Validate input": [item(body)], "GHL: build cases": [item({ cases: [], from: "ghl", error: null })] };
  const [empty] = await run("ff-case-match/plan.js", { nodes });
  assert.equal(empty.json.status, 404);
  assert.match(empty.json.error, /set an opportunity to "Won"/);
});

await test("tracking plan: an online cremation client gets the paid-arrangement and started actions, not the form", async () => {
  const [out] = await run("ff-apply-campaign-action/plan.js", { input: [item(trackCtx({ process: "online_cremation" }))], nodes: trackNodes() });
  const ops = out.json.tracking.requests_a.find((r) => r.label === "conversion_actions").body.operations;
  const web = ops.filter((o) => o.create && o.create.type === "WEBPAGE").map((o) => o.create);
  assert.deepEqual(web.map((w) => [w.name, w.category, w.primaryForGoal, w.countingType]), [
    ["Online arrangement paid", "PURCHASE", true, "MANY_PER_CLICK"],
    ["Arrangement started", "BEGIN_CHECKOUT", false, "ONE_PER_CLICK"],
  ]);
  assert.equal(web[0].valueSettings.alwaysUseDefaultValue, false, "the real amount paid is used");
});

// ------------------------------------------------------------------ website check (tasks 3 and 7)
await test("website check: pages per client, at most 5, bad urls dropped", async () => {
  const out = await run("ff-website-check/pages.js", { input: [
    item({ client_id: clientA, process: "funeral_home", urls: ["https://home.test/", "https://home.test/", "javascript:alert(1)", "https://home.test/a", "https://home.test/b", "https://home.test/c", "https://home.test/d", "https://home.test/e"] }),
  ] });
  assert.deepEqual(out.map((o) => o.json.url), ["https://home.test/", "https://home.test/a", "https://home.test/b", "https://home.test/c", "https://home.test/d"]);
  const none = await run("ff-website-check/pages.js", { input: [item({})] });
  assert.equal(none[0].json.none, true);
});

await test("website check: finds our script and settings, Google tag, GHL form, checkout and platform - and keeps no page text", async () => {
  const wp = `<html><head><link href="/wp-content/themes/x.css"><script async src="https://www.googletagmanager.com/gtag/js?id=AW-123456789"></script></head>
    <body><p>Call Jane Smith at the front desk</p><a href="tel:+12505550100">Call</a>
    <iframe src="https://api.leadconnectorhq.com/widget/form/abc"></iframe>
    <script src="https://dash.test/ff-click-id.js" defer data-phone-conversion="AW-123456789/x" data-phone="(250) 555-0100"></script></body></html>`;
  const shop = `<html><body><div id="__nuxt"></div><script src="https://assets.cdn.filesafe.space/x.js"></script><script src="https://js.stripe.com/v3/"></script></body></html>`;
  const nodes = { Pages: [item({ client_id: clientA, url: "https://home.test/" }), item({ client_id: clientA, url: "https://shop.test/" }), item({ client_id: clientA, url: "https://down.test/" })] };
  const [out] = await run("ff-website-check/read-pages.js", {
    input: [item({ statusCode: 200, body: wp }), item({ statusCode: 200, body: shop }), item({ statusCode: 503, body: "" })], nodes,
  });
  const [a, b, c] = out.json.rows;
  assert.equal(a.platform, "wordpress");
  assert.equal(a.has_ff_script, true);
  assert.deepEqual(a.ff_settings, ["phone-conversion"]);
  assert.equal(a.has_gtag, true);
  assert.deepEqual(a.gtag_ids, ["AW-123456789"]);
  assert.equal(a.has_ghl_form, true);
  assert.equal(a.has_form, true);
  assert.equal(a.has_checkout, false);
  assert.equal(a.phones_seen, 1);
  assert.equal(b.platform, "ghl");
  assert.equal(b.checkout_hint, "stripe");
  assert.equal(b.has_ff_script, false);
  assert.equal(c.error, "status 503");
  assert.ok(!JSON.stringify(out.json).includes("Jane") && !JSON.stringify(out.json).includes("555"), "no page text or numbers kept");
});

await test("GHL auto-link: name, website or phone; only unambiguous matches; never a sub-account already used", async () => {
  const nodes = {
    "GHL: list sub-accounts": [item({ statusCode: 200, body: { locations: [
      { id: "L1", name: "Pacific Coast Cremation Inc.", website: "https://pacificcoastcremation.com" },
      { id: "L2", name: "Hillside Funeral Home", phone: "+1 (250) 555-0100" },
      { id: "L3", name: "Twin A" }, { id: "L4", name: "Twin A" },
      { id: "L5", name: "Already Linked Home" },
    ] } })],
    "Clients without GHL": [
      item({ client_id: "c1", name: "Pacific Coast Cremation", website_url: null, phone: null }),
      item({ client_id: "c2", name: "Hillside", website_url: null, phone: "250-555-0100" }),
      item({ client_id: "c3", name: "Twin A", website_url: null, phone: null }),
      item({ client_id: "c4", name: "Already Linked Home", website_url: null, phone: null }),
      item({ client_id: "c5", name: "Nobody", website_url: "https://www.pacificcoastcremation.com/", phone: null }),
    ],
    "Linked GHL sub-accounts": [item({ ghl_location_id: "L5" })],
  };
  const out = await run("ff-website-check/match-ghl.js", { nodes });
  assert.deepEqual(out.map((o) => [o.json.path, o.json.body.ghl_location_id]), [
    ["clients?id=eq.c1&ghl_location_id=is.null", "L1"],
    ["clients?id=eq.c2&ghl_location_id=is.null", "L2"],
  ], "c3 is ambiguous, c4's sub-account is taken, c5's website matches L1 which c1 already took");
  nodes["GHL: list sub-accounts"] = [item({ statusCode: 401, body: {} })];
  const none = await run("ff-website-check/match-ghl.js", { nodes });
  assert.equal(none[0].json.matched, 0);
});

await test("blocked-words list: no own name when a brand campaign runs, no competitor names when a competitor campaign runs", async () => {
  const ctx = neglistCtx({ campaigns: [{ id: "10", name: "Brand - Local", linked: false }, { id: "11", name: "Competitors - Local", linked: false }, { id: "12", name: "Cremation - Local", linked: false }] });
  const [out] = await run("ff-apply-campaign-action/plan.js", { input: [item(ctx)], nodes: neglistNodes() });
  const words = out.json.mutate_body.mutateOperations.filter((o) => o.sharedCriterionOperation).map((o) => o.sharedCriterionOperation.create.keyword.text);
  assert.ok(!words.includes("pacific coast cremation"), "own name kept off the shared list");
  assert.ok(!words.includes("smith funeral home"), "competitor names kept off the shared list");
  assert.ok(words.includes("obituary"));
});

console.log(`\n${passed} passed${process.exitCode ? ", some failed" : ""}`);
