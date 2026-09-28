import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { verifyWorkflows } from "./workflows.mjs";
import { verifyAdministration } from "./administration.mjs";

// Deliberately uses an isolated local stack. Never reads the repository .env or
// accepts a hosted URL/admin key. Test identities are created without sending mail.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const stack = process.env.ITSM_E2E_STACK_DIR || (await mkdtemp(path.join(tmpdir(), "itsm-e2e-")));
const artifacts = path.join(stack, `evidence-${Date.now()}`);
await mkdir(artifacts, { recursive: true });
const cli = path.join(root, "node_modules/.bin/supabase");
const org = "10000000-0000-0000-0000-000000000001";
const baseURL = "http://127.0.0.1:8082";
const environment = { ...process.env };
for (const key of Object.keys(environment)) {
  if (key.startsWith("SUPABASE_") || key.startsWith("VITE_SUPABASE_")) delete environment[key];
}
const command = (args) =>
  execFileSync(cli, args, {
    cwd: stack,
    env: environment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
let app, browser, sql;
const report = {
  environment: "local Supabase Auth/Postgres/REST/Storage + actual Vite application",
  checks: [],
  status: "RUNNING",
};
const check = (name) => {
  report.checks.push({ name, status: "PASS" });
  console.log(`PASS ${name}`);
};
const waitFor = async (fn, label, attempts = 80) => {
  for (let i = 0; i < attempts; i++) {
    if (await fn().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out: ${label}`);
};
try {
  if (!process.env.ITSM_E2E_STACK_DIR) {
    await mkdir(path.join(stack, "supabase"));
    await writeFile(
      path.join(stack, "supabase/config.toml"),
      `project_id = "wecrew-itsm-e2e"
[api]
enabled = true
port = 56421
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
[db]
port = 56422
shadow_port = 56420
major_version = 17
[db.seed]
enabled = false
[realtime]
enabled = false
[studio]
enabled = false
[local_smtp]
enabled = false
[storage]
enabled = true
[storage.vector]
enabled = false
[auth]
enabled = true
site_url = "${baseURL}"
additional_redirect_urls = ["${baseURL}"]
[auth.email]
enable_signup = true
enable_confirmations = false
[analytics]
enabled = false
[edge_runtime]
enabled = false
`,
    );
    console.log("Starting isolated local Supabase (first run downloads Docker images)…");
    await new Promise((resolve, reject) => {
      const log = createWriteStream(path.join(stack, "stack.log"), { mode: 0o600 });
      const child = spawn(
        cli,
        [
          "start",
          "--exclude",
          "realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
        ],
        { cwd: stack, env: environment, stdio: ["ignore", "pipe", "pipe"] },
      );
      child.stdout.pipe(log);
      child.stderr.pipe(log);
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error("Local Supabase failed to start. Inspect private stack.log.")),
      );
    });
  }
  const config = await readFile(path.join(stack, "supabase/config.toml"), "utf8");
  assert.match(
    config,
    /project_id\s*=\s*"wecrew-itsm-e2e(?:-local)?"/,
    "Only the dedicated E2E test stack can be used",
  );
  const status = JSON.parse(command(["status", "-o", "json"]));
  for (const url of [status.API_URL, status.DB_URL])
    assert.equal(new URL(url).hostname, "127.0.0.1", "E2E only accepts loopback services");
  assert.equal(new URL(status.API_URL).port, "56421");
  assert.equal(new URL(status.DB_URL).port, "56422");
  sql = postgres(status.DB_URL, { max: 1, onnotice() {} });
  const applied = await sql`select to_regclass('public.itsm_e2e_ready') as marker`;
  if (!applied[0].marker) {
    for (const directory of ["supabase/migrations", "drizzle/migrations"]) {
      const migrations = (await readdir(path.join(root, directory)))
        .filter((name) => name.endsWith(".sql"))
        .sort();
      for (const name of migrations)
        await sql.unsafe(await readFile(path.join(root, directory, name), "utf8"));
    }
    await sql`create table public.itsm_e2e_ready (created_at timestamptz default now())`;
    await sql`notify pgrst, 'reload schema'`;
  }
  check("All application migrations apply to real local Supabase");
  const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const bucket = await admin.storage.createBucket("itsm-evidence", { public: false });
  if (bucket.error && !bucket.error.message.includes("already exists")) throw bucket.error;
  // A fresh run has no test roles; when debugging the same isolated stack remove
  // only the previous test role assignments so approver counts remain stable.
  await sql`delete from public.user_roles where user_id in (select id from auth.users where email like '%@itsm-e2e.invalid')`;
  const actors = {};
  const runId = Date.now().toString(36);
  for (const [name, roles] of Object.entries({
    operator: ["service_desk", "change_manager"],
    requester: ["requester"],
    peer: ["requester"],
    approver1: ["manager", "cab_member"],
    approver2: ["manager", "cab_member"],
    outsider: [],
    inactive: ["admin"],
  })) {
    const email = `${name}-${runId}@itsm-e2e.invalid`;
    const password = `${randomBytes(18).toString("base64url")}Aa1!`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    const id = created.data.user.id;
    await sql`insert into public.profiles(id, display_name) values (${id}, ${`E2E ${name}`})`;
    if (name !== "outsider")
      await sql`insert into public.memberships(organization_id,user_id,is_active) values (${org},${id},${name !== "inactive"})`;
    for (const role of roles)
      await sql`insert into public.user_roles(organization_id,user_id,role) values (${org},${id},${role})`;
    const client = createClient(status.API_URL, status.ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signed = await client.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    actors[name] = { id, email, password, client };
  }
  check("Seven real authenticated personas provisioned in local Auth");
  const appLog = createWriteStream(path.join(artifacts, "app.log"), { mode: 0o600 });
  app = spawn(
    path.join(root, "node_modules/.bin/vite"),
    ["--host", "127.0.0.1", "--port", "8082", "--strictPort"],
    {
      cwd: root,
      env: {
        ...environment,
        SUPABASE_URL: status.API_URL,
        SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
        VITE_SUPABASE_URL: status.API_URL,
        VITE_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
        SUPABASE_PROJECT_ID: "local-e2e",
        VITE_SUPABASE_PROJECT_ID: "local-e2e",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  app.stdout.pipe(appLog);
  app.stderr.pipe(appLog);
  await waitFor(async () => {
    if (app.exitCode !== null) throw new Error("App exited");
    return (await fetch(`${baseURL}/auth`)).ok;
  }, "actual application ready");
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}),
  });
  await verifyWorkflows({ browser, baseURL, actors, sql, org, artifacts, check, waitFor, runId });
  await verifyAdministration({
    browser,
    baseURL,
    actors,
    sql,
    org,
    artifacts,
    check,
    waitFor,
    runId,
    authAdmin: admin,
    authURL: status.API_URL,
    anonKey: status.ANON_KEY,
  });
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.error = error instanceof Error ? error.message : "Unexpected failure";
  console.error(report.error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (app) {
    app.kill("SIGTERM");
    await new Promise((resolve) => {
      if (app.exitCode !== null) return resolve();
      app.once("exit", resolve);
      setTimeout(() => {
        app.kill("SIGKILL");
        resolve();
      }, 5000).unref();
    });
  }
  if (sql) await sql.end({ timeout: 5 });
  if (!process.env.ITSM_E2E_KEEP) {
    try {
      command(["stop", "--no-backup"]);
    } catch {
      report.cleanup = "Stack stop failed; inspect local Docker before retry.";
      process.exitCode = 1;
    }
  }
  await writeFile(path.join(artifacts, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${report.status} — evidence: ${artifacts}`);
}
