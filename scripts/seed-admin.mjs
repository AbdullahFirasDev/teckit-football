#!/usr/bin/env node
/**
 * Seed the initial Super Admin account via the Supabase Service Role API.
 *
 * Idempotent: exits early if any admin already exists in public.users,
 * otherwise promotes or creates the account and guarantees its profile row
 * has role='admin'.
 *
 * Usage:
 *   npm run seed:admin [-- --dry-run]
 *   npm run seed:admin -- --email admin@platform.com --password 'S3cret!' --name 'System Administrator'
 *
 * Credentials (first match wins):
 *   --email / --password / --name CLI flags, then SEED_ADMIN_EMAIL /
 *   SEED_ADMIN_PASSWORD / SEED_ADMIN_NAME env vars, then the defaults below.
 *   If no password is supplied, a strong random one is generated and printed
 *   exactly once.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from
 * .env.local / .env (loaded automatically; real environment wins).
 */

import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DEFAULT_EMAIL = "admin@platform.com";
const DEFAULT_NAME = "System Administrator";
const MIN_PASSWORD_LENGTH = 8;

// ---------------------------------------------------------------------------
// Tiny .env loader (no dependency; does not override existing env)
// ---------------------------------------------------------------------------
function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let key = line.slice(0, eq).trim();
    if (key.startsWith("export ")) key = key.slice(7).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

for (const envFile of [".env.local", ".env"]) {
  loadEnvFile(path.resolve(process.cwd(), envFile));
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
function printHelp() {
  console.log(`Seed the initial Super Admin (role='admin') via the Supabase Service Role API.

Usage:
  npm run seed:admin [-- --dry-run]
  npm run seed:admin -- --email admin@platform.com --password 'S3cret!' --name 'System Administrator'

Options:
  --email <email>     Admin email (default: ${DEFAULT_EMAIL}, env SEED_ADMIN_EMAIL)
  --password <pass>   Admin password (min ${MIN_PASSWORD_LENGTH} chars; generated if omitted, env SEED_ADMIN_PASSWORD)
  --name <name>       Full name (default: "${DEFAULT_NAME}", env SEED_ADMIN_NAME)
  --dry-run           Report what would happen without changing anything
  --help              Show this help

Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (from .env.local / .env).`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--email") args.email = argv[++i];
    else if (arg === "--password") args.password = argv[++i];
    else if (arg === "--name") args.name = argv[++i];
    else args._.push(arg);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

/** Throw with a friendly message instead of process.exit(): exiting with open
 * sockets can crash Node's libuv on Windows. Errors propagate to the bottom. */
function fail(message, error) {
  const detail = error ? `\n  ${error.message ?? error}` : "";
  throw new Error(`✗ ${message}${detail}`);
}

/** Page through auth users to find one by email (service role only). */
async function findAuthUserByEmail(supabase, targetEmail) {
  const target = targetEmail.toLowerCase();
  const perPage = 200;
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) fail("Could not list auth users", error);
    const match = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (match) return match;
    if (data.users.length < perPage) return null;
  }
}

async function main() {
  if (args.help) {
    printHelp();
    return;
  }

  const email = (args.email ?? process.env.SEED_ADMIN_EMAIL ?? DEFAULT_EMAIL).trim();
  const fullName = args.name ?? process.env.SEED_ADMIN_NAME ?? DEFAULT_NAME;
  let password = args.password ?? process.env.SEED_ADMIN_PASSWORD ?? "";
  const generatedPassword = !password;
  if (generatedPassword) password = randomBytes(18).toString("base64url");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(`Invalid email address: "${email}"`);
  }
  if (!generatedPassword && password.length < MIN_PASSWORD_LENGTH) {
    fail(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  // -------------------------------------------------------------------------
  // Supabase service-role client (same pattern as src/lib/supabase/admin.ts)
  // -------------------------------------------------------------------------
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    fail(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
        "  Copy .env.example → .env.local and fill in the Supabase values first.",
    );
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // -------------------------------------------------------------------------
  // 1. Bail out if any admin already exists (idempotency guard)
  // -------------------------------------------------------------------------
  const { data: admins, error: adminsError } = await supabase
    .from("users")
    .select("id, email, full_name")
    .eq("role", "admin");
  if (adminsError) {
    fail(
      "Could not query public.users (have migrations 0001/0002 been applied to this project?)",
      adminsError,
    );
  }

  if (admins.length > 0) {
    console.log("= An admin account already exists — nothing to do:");
    for (const a of admins) console.log(`    • ${a.email} (${a.full_name}) [${a.id}]`);
    console.log(
      "\nTo reset this admin's password instead, run supabase/seed_super_admin.sql or use Supabase Auth → Users.",
    );
    return;
  }

  // -------------------------------------------------------------------------
  // 2. Locate or create the auth user
  // -------------------------------------------------------------------------
  const existingAuthUser = await findAuthUserByEmail(supabase, email);
  const existingProfile = await supabase
    .from("users")
    .select("id, role, full_name")
    .eq("email", email)
    .maybeSingle();
  if (existingProfile.error) fail("Could not look up the profile row", existingProfile.error);

  if (args.dryRun) {
    console.log("Dry run — no changes were made. Plan:");
    if (existingAuthUser) {
      console.log(
        `  • Auth user exists (${existingAuthUser.id}) → promote via updateUserById (metadata role='admin'; password NOT changed)`,
      );
    } else {
      console.log(
        `  • Create auth user ${email} (confirmed)${generatedPassword ? " with a generated password" : ""}`,
      );
    }
    if (existingProfile.data) {
      if (existingProfile.data.id === existingAuthUser?.id) {
        console.log(
          `  • Profile row exists with role='${existingProfile.data.role}' → update to role='admin'`,
        );
      } else {
        console.log(
          `  ⚠ Profile row ${existingProfile.data.id} shares the email but has a different auth id — it would be removed (script aborts if events reference it)`,
        );
      }
    } else {
      console.log("  • No profile row → insert public.users (role='admin') (normally the DB trigger does this)");
    }
    return;
  }

  let userId;

  if (existingAuthUser) {
    userId = existingAuthUser.id;
    console.log(`• Auth user already exists (${userId}) — promoting to admin (password unchanged)`);
    const { error } = await supabase.auth.admin.updateUserById(userId, {
      user_metadata: { ...(existingAuthUser.user_metadata ?? {}), full_name: fullName, role: "admin" },
    });
    if (error) fail("Could not update the auth user", error);
  } else {
    console.log(`• Creating auth user ${email}...`);
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // no verification email; can sign in immediately
      user_metadata: { full_name: fullName, role: "admin" },
    });
    if (error) fail("Could not create the auth user", error);
    userId = data.user.id;
  }

  // -------------------------------------------------------------------------
  // 3. Make sure the public.users profile row exists with role='admin'
  //    (normally auto-created by the on_auth_user_created trigger).
  // -------------------------------------------------------------------------
  const stale = existingProfile.data && existingProfile.data.id !== userId ? existingProfile.data : null;
  if (stale) {
    const { count, error: countError } = await supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("organizer_id", stale.id);
    if (countError) fail("Could not check events referencing the stale profile", countError);
    if (count > 0) {
      fail(`Profile ${stale.id} shares the email but ${count} event(s) reference it; resolve manually in public.users.`);
    }
    const { error } = await supabase.from("users").delete().eq("id", stale.id);
    if (error) fail("Could not remove the stale profile row", error);
    console.log(`• Removed stale profile row ${stale.id}`);
  }

  const { data: profile } = await supabase
    .from("users")
    .select("id, role")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) {
    const { error } = await supabase
      .from("users")
      .insert({ id: userId, full_name: fullName, email, role: "admin" });
    if (error) fail("Could not insert the profile row", error);
    console.log("• Inserted public.users profile row (role='admin')");
  } else if (profile.role !== "admin") {
    const { error } = await supabase
      .from("users")
      .update({ role: "admin", full_name: fullName })
      .eq("id", userId);
    if (error) fail("Could not update the profile role", error);
    console.log(`• Profile role '${profile.role}' → 'admin'`);
  }

  // -------------------------------------------------------------------------
  // 4. Verify + report
  // -------------------------------------------------------------------------
  const { data: check, error: checkError } = await supabase
    .from("users")
    .select("id, email, role")
    .eq("id", userId)
    .single();
  if (checkError || check?.role !== "admin") {
    fail("Verification failed — the profile row is not role='admin'", checkError);
  }

  console.log("\n✔ Super Admin is ready");
  console.log(`    URL:      ${url}`);
  console.log(`    Email:    ${check.email}`);
  if (generatedPassword) {
    console.log(`    Password: ${password}`);
    console.log("    ⚠ Generated password — store it in your password manager NOW; it is not shown again.");
  } else {
    console.log("    Password: (the one you supplied)");
  }
}

try {
  await main();
} catch (err) {
  console.error(err?.message ?? err);
  process.exitCode = 1;
}
