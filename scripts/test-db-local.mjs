#!/usr/bin/env node
// Runs the migrations and the RLS tests on a plain local PostgreSQL - no Docker.
//
//   node scripts/test-db-local.mjs
//
// Connection: LOCAL_PG_URL in the environment or in the repo-root .env, e.g.
//   LOCAL_PG_URL=postgresql://postgres:<password>@localhost:5432/postgres
// The user must be able to create databases and roles (the local superuser).
//
// Steps: create a throwaway database -> load scripts/db-shim/supabase-shim.sql
// (roles, auth.users, auth.uid(), Supabase default grants) -> apply every file
// in supabase/migrations in order -> load the pgTAP shim if the real pgtap
// extension is not installed -> run supabase/tests/*.test.sql -> drop the database.

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readDotEnv() {
  const file = join(root, ".env");
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );
}

const baseUrl = process.env.LOCAL_PG_URL || readDotEnv().LOCAL_PG_URL;
if (!baseUrl) {
  console.error("Set LOCAL_PG_URL (env or repo-root .env), e.g. postgresql://postgres:<password>@localhost:5432/postgres");
  process.exit(2);
}

function withDb(url, db) {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

function psql(url, args, { input, allowFail = false } = {}) {
  const res = spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", url, ...args], {
    encoding: "utf8",
    input,
    env: { ...process.env, PGCONNECT_TIMEOUT: "10" },
  });
  if (res.error) throw res.error;
  if (res.status !== 0 && !allowFail) {
    throw new Error(`psql failed (${args.join(" ")}):\n${res.stderr || res.stdout}`);
  }
  return res;
}

const dbName = `ff_test_${Date.now()}`;
const adminUrl = baseUrl;
const testUrl = withDb(baseUrl, dbName);
const work = mkdtempSync(join(tmpdir(), "ff-db-test-"));

let exitCode = 0;
psql(adminUrl, ["-c", `create database ${dbName}`]);
try {
  psql(testUrl, ["-c", `alter database ${dbName} set search_path = "$user", public, extensions`]);

  console.log("- Supabase shim");
  psql(testUrl, ["-f", join(root, "scripts", "db-shim", "supabase-shim.sql")]);

  const migrations = readdirSync(join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const m of migrations) {
    console.log(`- migration ${m}`);
    psql(testUrl, ["-f", join(root, "supabase", "migrations", m)]);
  }

  const hasPgtap =
    psql(testUrl, ["-Atc", "select count(*) from pg_available_extensions where name = 'pgtap'"]).stdout.trim() === "1";
  if (!hasPgtap) {
    console.log("- pgTAP not installed locally, using scripts/db-shim/pgtap-shim.sql");
    psql(testUrl, ["-f", join(root, "scripts", "db-shim", "pgtap-shim.sql")]);
  }

  const tests = readdirSync(join(root, "supabase", "tests")).filter((f) => f.endsWith(".sql")).sort();
  let total = 0;
  let failed = 0;
  for (const t of tests) {
    let sql = readFileSync(join(root, "supabase", "tests", t), "utf8");
    if (!hasPgtap) sql = sql.replace(/^create extension if not exists pgtap.*$/m, "-- pgtap: using local shim");
    const file = join(work, t);
    writeFileSync(file, sql);

    console.log(`\n# ${t}`);
    const res = psql(testUrl, ["-At", "-f", file], { allowFail: true });
    const lines = res.stdout.split(/\r?\n/).filter(Boolean);
    const results = lines.filter((l) => /^(not )?ok \d+/.test(l));
    const fails = lines.filter((l, i) => /^not ok/.test(l) || (/^# /.test(l) && /^not ok/.test(lines[i - 1] || "")));
    total += results.length;
    failed += results.filter((l) => l.startsWith("not ok")).length;

    if (process.argv.includes("--verbose")) console.log(lines.join("\n"));
    else if (fails.length) console.log(fails.join("\n"));
    if (res.status !== 0) {
      failed++;
      console.log(`psql error:\n${res.stderr}`);
    }
    console.log(`${results.length - results.filter((l) => l.startsWith("not ok")).length}/${results.length} passed`);
  }

  console.log(`\n${failed === 0 ? "PASS" : "FAIL"}: ${total - failed}/${total} checks passed across ${tests.length} file(s)`);
  exitCode = failed === 0 && total > 0 ? 0 : 1;
} catch (e) {
  console.error(e.message);
  exitCode = 1;
} finally {
  psql(adminUrl, ["-c", `drop database if exists ${dbName} with (force)`], { allowFail: true });
  rmSync(work, { recursive: true, force: true });
}
process.exit(exitCode);
