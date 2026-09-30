#!/usr/bin/env node
// Offline tests for the ff-sync Code nodes (n8n/src/ff-sync/*.js) with fake
// Google Ads responses. No n8n, no network.  node scripts/test-sync-code.mjs

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Same "// @include shared/x.js" expansion as scripts/build-n8n.mjs.
const src = (f) => {
  const read = (rel) => readFileSync(join(root, "n8n", "src", rel), "utf8").replace(/\r\n/g, "\n");
  return read(f.includes("/") ? f : `ff-sync/${f}`).replace(/^\/\/ @include (\S+)\n/gm, (_, rel) => `${read(rel)}\n`);
};

// Minimal n8n Code-node runtime: $input, $(name).first()/.all()/.itemMatching(i).
async function run(file, { input = [], nodes = {} }) {
  const wrap = (items) => ({
    first: () => items[0],
    all: () => items,
    itemMatching: (i) => items[i],
  });
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`node "${name}" not provided`);
    return wrap(nodes[name]);
  };
  const $input = wrap(input);
  const fn = new Function("$", "$input", `return (async () => {\n${src(file)}\n})();`);
  return fn($, $input);
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

const stream = (results) => ({ statusCode: 200, body: JSON.stringify([{ results }]) });

// ------------------------------------------------------------------ config
await test("config: webhook with valid customer id and full mode", async () => {
  const [out] = await run("config.js", { input: [item({ headers: { a: 1 }, body: { customer_id: "123-456-7890", mode: "full" } })] });
  assert.equal(out.json.trigger, "manual");
  assert.equal(out.json.mode, "weekly");
  assert.equal(out.json.only_customer_id, "1234567890");
});
await test("config: junk customer id is ignored, weekly schedule", async () => {
  const [a] = await run("config.js", { input: [item({ headers: {}, body: { customer_id: "1; drop table" } })] });
  assert.equal(a.json.only_customer_id, null);
  const [b] = await run("config.js", { input: [item({ ff_trigger: "schedule_weekly", mode: "weekly" })] });
  assert.equal(b.json.trigger, "schedule_weekly");
  assert.equal(b.json.mode, "weekly");
});

// ------------------------------------------------------------------ build queries
const account = {
  customer_id: "1111111111", login_customer_id: "9999999999", time_zone: "America/Toronto",
  first_synced_at: null, towns: ["Mount Pleasant"], own_brand_terms: ["McCall Gardens"], competitor_terms: ["Smith Funeral Home"],
};
const cfg = { trigger: "schedule", mode: "daily", MCC_ID: "9999999999", SLACK_CHANNEL: "#ff-ads", AI_SUGGESTIONS: true };
let queries;
await test("build queries: 27 queries, first sync uses 365/90-day windows", async () => {
  queries = await run("build-queries.js", {
    nodes: { Config: [item(cfg)], "Start sync run": [item({ id: "run-1" })], "Loop over accounts": [item(account)] },
  });
  assert.equal(queries.length, 27);
  const q = Object.fromEntries(queries.map((i) => [i.json.query_name, i.json]));
  const days = (a, b) => (new Date(b) - new Date(a)) / 86400000;
  assert.equal(days(q.campaign_daily.window.from_campaign, q.campaign_daily.window.to), 364);
  assert.equal(days(q.search_terms.window.from_detail, q.search_terms.window.to), 89);
  assert.ok(q.change_events.gaql.includes("LIMIT 10000"));
  assert.ok(!/caller_area_code|caller_country_code/.test(q.calls.gaql), "calls must not select caller info");
  assert.equal(new Set(queries.map((i) => i.json.pass_at)).size, 1, "one pass_at for the whole pass");
});

// ------------------------------------------------------------------ map and plan
async function mapAndPlan(responses) {
  const names = queries.map((q) => q.json.query_name);
  const input = names.map((n) => item(responses[n] || stream([])));
  return run("map-and-plan.js", {
    input,
    nodes: { "Account: build queries": queries, "Loop over accounts": [item(account)] },
  });
}

const responses = {
  customer: stream([{ customer: { id: "1111111111", descriptiveName: "Pilot", currencyCode: "USD", timeZone: "America/Toronto",
    autoTaggingEnabled: true, callReportingSetting: { callReportingEnabled: true } } }]),
  campaigns: stream([
    { campaign: { id: "10", name: "A - At-need", status: "ENABLED", networkSettings: { targetGoogleSearch: true },
      geoTargetTypeSetting: { positiveGeoTargetType: "PRESENCE" } }, campaignBudget: { id: "5", amountMicros: "30000000" } },
    { campaign: { id: "11", name: "Old", status: "REMOVED" }, campaignBudget: { id: "6" } },
  ]),
  campaign_criteria: stream([
    { campaign: { id: "10" }, campaignCriterion: { criterionId: "1", type: "LOCATION", location: { geoTargetConstant: "geoTargetConstants/1002451" } } },
    { campaign: { id: "10" }, campaignCriterion: { criterionId: "2", type: "KEYWORD", negative: true, keyword: { text: "jobs", matchType: "BROAD" } } },
    { campaign: { id: "10" }, campaignCriterion: { criterionId: "3", type: "AD_SCHEDULE", adSchedule: { dayOfWeek: "MONDAY", endHour: 17 } } },
  ]),
  keywords: stream([
    { campaign: { id: "10" }, adGroup: { id: "20" }, adGroupCriterion: { criterionId: "30", keyword: { text: "funeral home mount pleasant", matchType: "PHRASE" }, qualityInfo: { qualityScore: 7 } } },
    { campaign: { id: "10" }, adGroup: { id: "20" }, adGroupCriterion: { criterionId: "31", negative: true, keyword: { text: "free", matchType: "EXACT" } } },
  ]),
  recommendations: stream([{ recommendation: { resourceName: "customers/1111111111/recommendations/abc", type: "KEYWORD" } }]),
  campaign_daily: stream([{ campaign: { id: "10" }, segments: { date: "2026-09-29" }, metrics: { impressions: "100", clicks: "7", costMicros: "12340000", conversions: 1 } }]),
  search_terms: stream([
    { campaign: { id: "10" }, adGroup: { id: "20" }, searchTermView: { searchTerm: "John Doe obituary", status: "NONE" },
      segments: { date: "2026-09-29", keyword: { adGroupCriterion: "customers/1111111111/adGroupCriteria/20~30", info: { text: "x" } } },
      metrics: { impressions: "3", clicks: "1", costMicros: "1000000" } },
    { campaign: { id: "10" }, adGroup: { id: "20" }, searchTermView: { searchTerm: "jane roe obituary" },
      segments: { date: "2026-09-29", keyword: { adGroupCriterion: "customers/1111111111/adGroupCriteria/20~30" } },
      metrics: { impressions: "2", clicks: "1", costMicros: "500000" } },
    { campaign: { id: "10" }, adGroup: { id: "20" }, searchTermView: { searchTerm: "Mary Johnson" },
      segments: { date: "2026-09-29", keyword: { adGroupCriterion: "customers/1111111111/adGroupCriteria/20~30" } }, metrics: {} },
    { campaign: { id: "10" }, adGroup: { id: "20" }, searchTermView: { searchTerm: "smith funeral home" },
      segments: { date: "2026-09-29", keyword: { adGroupCriterion: "customers/1111111111/adGroupCriteria/20~30" } }, metrics: {} },
    { campaign: { id: "10" }, adGroup: { id: "20" }, searchTermView: { searchTerm: "cremation cost mount pleasant" },
      segments: { date: "2026-09-29", keyword: { adGroupCriterion: "customers/1111111111/adGroupCriteria/20~30" } }, metrics: { clicks: "4" } },
    { campaign: { id: "10" }, adGroup: { id: "20" }, searchTermView: { searchTerm: "grace chapel funeral" },
      segments: { date: "2026-09-29", keyword: { adGroupCriterion: "customers/1111111111/adGroupCriteria/20~30" } }, metrics: {} },
  ]),
  calls: stream([{ callView: { resourceName: "customers/1111111111/callViews/1", startCallDateTime: "2026-09-29 14:00:00",
    callDurationSeconds: "95", callStatus: "RECEIVED", callerAreaCode: "555" }, campaign: { id: "10" } }]),
  geo: { statusCode: 400, body: JSON.stringify([{ error: { message: "bad", details: [{ errors: [{ message: "Unrecognized field geographic_view.x" }] }] } }]) },
  hourly: { error: { message: "socket hang up" } },
};

let plan;
await test("map: start item first, carries per-query results and errors", async () => {
  plan = await mapAndPlan(responses);
  const start = plan[0].json;
  assert.equal(start.kind, "start");
  assert.equal(start.rows[0].status, "partial");
  assert.match(start.query_results.geo.error, /^400 Unrecognized field/);
  assert.equal(start.query_results.hourly.error, "socket hang up");
  assert.equal(start.query_results.campaigns.rows, 2);
});

const rowsOf = (table) => plan.filter((p) => p.json.table === table).flatMap((p) => p.json.rows);

await test("map: every batch has identical keys (PostgREST requirement)", async () => {
  for (const p of plan.slice(1)) {
    const keys = JSON.stringify(Object.keys(p.json.rows[0]).sort());
    for (const r of p.json.rows) assert.equal(JSON.stringify(Object.keys(r).sort()), keys, `mixed keys in ${p.json.table}`);
    assert.ok(p.json.rows.length <= 500);
  }
});

await test("map: campaigns - REMOVED gets removed_at, false booleans default", async () => {
  const c = rowsOf("campaigns");
  assert.equal(c.find((r) => r.campaign_id === "11").removed_at, plan[0].json.pass_at);
  assert.equal(c.find((r) => r.campaign_id === "10").removed_at, null);
  assert.equal(c.find((r) => r.campaign_id === "10").network_display, false);
  assert.equal(c.find((r) => r.campaign_id === "10").budget_micros, 30000000);
});

await test("map: negatives from campaign and ad group levels", async () => {
  const n = rowsOf("negatives");
  assert.deepEqual(n.map((r) => [r.level, r.scope_id, r.text]).sort(), [["ad_group", "20", "free"], ["campaign", "10", "jobs"]]);
  assert.equal(rowsOf("keywords").length, 1);
  assert.equal(rowsOf("keywords")[0].quality_score, 7);
});

await test("map: ad schedule hour 0 omitted by proto3 becomes 0", async () => {
  const s = rowsOf("campaign_targets").find((r) => r.type === "AD_SCHEDULE");
  assert.equal(s.start_hour, 0);
  assert.equal(s.end_hour, 17);
});

await test("map: search term name filter", async () => {
  const st = rowsOf("search_term_daily");
  const terms = st.map((r) => r.search_term).sort();
  assert.deepEqual(terms, [
    "[name removed - name]",
    "[name removed - obituary]",
    "cremation cost mount pleasant",
    "grace chapel funeral",
    "smith funeral home",
  ]);
  assert.ok(!st.some((r) => /john|jane|mary|doe|roe/i.test(r.search_term)), "no names stored");
  const obit = st.find((r) => r.search_term === "[name removed - obituary]");
  assert.equal(obit.impressions, 5, "two obituary terms merged, metrics summed");
  assert.equal(obit.cost_micros, 1500000);
  assert.equal(obit.name_filtered, true);
  assert.equal(obit.keyword_criterion_id, "30");
  assert.match(obit.term_hash, /^[0-9a-f]{64}$/);
});

await test("map: sha256 matches the standard test vector", async () => {
  // term_hash of "abc" must be the well-known SHA-256 value.
  const code = src("map-and-plan.js");
  const fnSrc = code.slice(code.indexOf("function sha256"), code.indexOf("// ---------------------------------------------------------------- name filter\n// Rules live"));
  const sha256 = new Function(`${fnSrc}; return sha256;`)();
  assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(sha256(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256("hello world"), "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
});

await test("map: calls converted to UTC, no caller info stored", async () => {
  const c = rowsOf("calls")[0];
  assert.equal(c.duration_seconds, 95);
  assert.equal(c.start_at, "2026-09-29T18:00:00.000Z"); // Toronto is UTC-4 in September
  assert.ok(!("caller_area_code" in c) && !JSON.stringify(c).includes("555"));
});

await test("map: recommendations never send status (hidden rows stay hidden)", async () => {
  const r = rowsOf("recommendations")[0];
  assert.ok(!("status" in r));
  assert.deepEqual(r.impact, {});
  assert.equal(r.est_extra_clicks, 0);
});

// ------------------------------------------------------------------ finish account
await test("finish: soft-remove only for queries that succeeded; write failure blocks it", async () => {
  // Every write OK except keywords.
  const writes = plan.map((p) => item(p.json.table === "keywords" ? { statusCode: 400, body: { message: "bad row" } } : { statusCode: 201 }));
  const out = await run("finish-account.js", {
    input: writes,
    nodes: { "Map and plan writes": plan, "Loop over accounts": [item(account)] },
  });
  const paths = out.map((o) => `${o.json.method} ${o.json.path}`);
  assert.ok(paths.some((p) => p.startsWith("PATCH campaigns?customer_id=eq.1111111111&removed_at=is.null&synced_at=lt.")));
  assert.ok(paths.some((p) => p.includes("negatives?customer_id=eq.1111111111&level=eq.campaign")));
  assert.ok(!paths.some((p) => p.startsWith("PATCH keywords?")), "keywords write failed - no soft-remove");
  assert.ok(!paths.some((p) => p.startsWith("PATCH negatives?") && p.includes("level=eq.ad_group")), "keywords query owns ad-group negatives too");
  assert.ok(paths.some((p) => p.startsWith("PATCH assets?") && p.includes("level=eq.ad_group")), "ad-group assets still soft-removed");
  assert.ok(paths.some((p) => p.includes("recommendations?customer_id=eq.1111111111&status=eq.open")));
  const result = out.find((o) => o.json.path.startsWith("sync_run_accounts")).json.body[0];
  assert.equal(result.status, "partial");
  assert.match(result.resources.keywords.error, /write to keywords failed: bad row/);
  assert.match(result.resources.geo.error, /Unrecognized field/);
  assert.ok(out.some((o) => o.json.path === "ad_accounts?customer_id=eq.1111111111"));
});

await test("finish: customer query failing marks the account failed, no last_synced_at", async () => {
  const bad = await mapAndPlan({ ...responses, customer: { statusCode: 401, body: "[]" } });
  const out = await run("finish-account.js", {
    input: bad.map(() => item({ statusCode: 201 })),
    nodes: { "Map and plan writes": bad, "Loop over accounts": [item(account)] },
  });
  const result = out.find((o) => o.json.path.startsWith("sync_run_accounts")).json.body[0];
  assert.equal(result.status, "failed");
  assert.ok(!out.some((o) => o.json.path.startsWith("ad_accounts")));
});

// ------------------------------------------------------------------ accounts, run summary, slack
await test("account upserts: skips the MCC itself and never sends client_id", async () => {
  const [out] = await run("build-account-upserts.js", {
    input: [item(stream([
      { customerClient: { id: "1111111111", descriptiveName: "Pilot", status: "ENABLED" } },
      { customerClient: { id: "9999999999", manager: true } },
    ]))],
    nodes: { Config: [item(cfg)] },
  });
  assert.deepEqual(out.json.rows.map((r) => r.customer_id), ["1111111111"]);
  assert.ok(!("client_id" in out.json.rows[0]));
  assert.equal(out.json.rows[0].login_customer_id, "9999999999");
});

await test("prepare accounts: empty table becomes { none: true }", async () => {
  const out = await run("prepare-accounts.js", { input: [item({})] });
  assert.deepEqual(out.map((o) => o.json), [{ none: true }]);
});

await test("summarize: partial and failed counts", async () => {
  const [out] = await run("summarize-run.js", {
    input: [item({ status: "ok" }), item({ status: "partial" }), item({ status: "failed" })],
    nodes: { "Start sync run": [item({ id: "run-1" })] },
  });
  assert.equal(out.json.patch.status, "partial");
  assert.equal(out.json.patch.accounts_ok, 2);
  assert.equal(out.json.patch.accounts_failed, 1);
  assert.equal(out.json.patch.mutate_calls, 0);
});

await test("slack: skipped with no alerts; plain text otherwise", async () => {
  const nodes = {
    Config: [item(cfg)],
    "Summarize run": [item({ accounts_total: 2, accounts_failed: 0, accounts_partial: 1 })],
  };
  const [none] = await run("build-slack.js", { input: [item({})], nodes });
  assert.equal(none.json.skip, true);
  const [msg] = await run("build-slack.js", {
    input: [item({ severity: "high", customer_id: "1111111111", account_name: "Pilot", kind: "x", detail: "Spend — no conversions" })],
    nodes,
  });
  assert.equal(msg.json.skip, false);
  assert.ok(msg.json.text.includes("111-111-1111"));
  assert.ok(!/[–—]/.test(msg.json.text), "plain hyphens only");
  assert.ok(!/\p{Extended_Pictographic}/u.test(msg.json.text), "no emoji");
});

console.log(`\n${passed} passed${process.exitCode ? ", some failed" : ""}`);
