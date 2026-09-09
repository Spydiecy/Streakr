#!/usr/bin/env node
/**
 * Merge environment variables into a deployed Lambda without corrupting the
 * Firebase service-account credential.
 *
 * Why this script exists
 * ---------------------
 * `aws lambda update-function-configuration --environment` REPLACES the whole
 * variable set, so a naive call wipes everything you didn't restate. The obvious
 * workaround — read the current set with `get-function-configuration`, add a key,
 * write it back — is worse, and broke this deployment twice:
 *
 * `FIREBASE_SERVICE_ACCOUNT_JSON` holds a JSON *string* whose private key
 * contains `\n` escape sequences. Round-tripping it through
 * `JSON.parse` → `JSON.stringify` (or python's json module) turns those two
 * characters into real newlines. The variable is then invalid JSON, and the
 * function dies at startup with:
 *
 *   SyntaxError: Bad control character in string literal in JSON at position 168
 *       at getDb (/var/task/index.js)
 *
 * which points at the handler rather than at the deploy step that caused it.
 *
 * So: read the credential from the ORIGINAL file on every write, never from the
 * API, and verify the escaping before sending.
 *
 *   node scripts/set-env.mjs <function-name> KEY=VALUE [KEY=VALUE ...]
 *
 * Preserves any variable already set on the function unless it's being changed,
 * and re-reads the service account from disk when the function needs it.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";

const SERVICE_ACCOUNT_FILE = "streakr-hackathon-firebase-adminsdk.json";
const SA_KEY = "FIREBASE_SERVICE_ACCOUNT_JSON";

const [fn, ...pairs] = process.argv.slice(2);
if (!fn || pairs.length === 0) {
  console.error("usage: node scripts/set-env.mjs <function-name> KEY=VALUE [KEY=VALUE ...]");
  process.exit(1);
}

const aws = (args) => execFileSync("aws", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

// 1. Existing variables, so nothing is silently dropped.
let current = {};
try {
  current = JSON.parse(
    aws(["lambda", "get-function-configuration", "--function-name", fn, "--query", "Environment.Variables", "--output", "json"]),
  ) ?? {};
} catch (e) {
  console.error(`could not read current config for ${fn}:`, e.message);
  process.exit(1);
}

const next = { ...current };

// 2. Re-read the credential from disk rather than reusing the API's copy, which
//    may already have been mangled by an earlier round-trip.
if (SA_KEY in current) {
  if (!existsSync(SERVICE_ACCOUNT_FILE)) {
    console.error(`${fn} uses ${SA_KEY} but ${SERVICE_ACCOUNT_FILE} is missing — refusing to write a possibly corrupted credential.`);
    process.exit(1);
  }
  next[SA_KEY] = JSON.stringify(JSON.parse(readFileSync(SERVICE_ACCOUNT_FILE, "utf8")));
  console.log(`  ${SA_KEY}: re-read from ${SERVICE_ACCOUNT_FILE}`);
}

// 3. Apply the requested changes. Split on the FIRST "=" only, since values
//    (private keys, URLs) contain them.
for (const p of pairs) {
  const i = p.indexOf("=");
  if (i < 1) {
    console.error(`not a KEY=VALUE pair: ${p}`);
    process.exit(1);
  }
  const k = p.slice(0, i);
  const v = p.slice(i + 1);
  next[k] = v;
  console.log(`  ${k}: ${/KEY|TOKEN|SECRET/i.test(k) ? `<${v.length} chars>` : v}`);
}

// 4. The check that would have caught both incidents.
if (next[SA_KEY]) {
  const sa = next[SA_KEY];
  if (sa.includes("\n") || sa.includes("\r")) {
    console.error(`${SA_KEY} contains a literal newline — it would fail JSON.parse at runtime. Aborting.`);
    process.exit(1);
  }
  if (!sa.includes("\\n")) {
    console.error(`${SA_KEY} has no escaped newlines, so the private key is almost certainly damaged. Aborting.`);
    process.exit(1);
  }
  try {
    const parsed = JSON.parse(sa);
    if (!parsed.private_key?.includes("BEGIN PRIVATE KEY")) throw new Error("no private key inside");
  } catch (e) {
    console.error(`${SA_KEY} does not parse as a service account: ${e.message}. Aborting.`);
    process.exit(1);
  }
  console.log(`  ${SA_KEY}: verified parseable, escaping intact`);
}

const tmp = `/tmp/lambda-env-${fn}-${Date.now()}.json`;
writeFileSync(tmp, JSON.stringify({ Variables: next }));
try {
  aws(["lambda", "update-function-configuration", "--function-name", fn, "--environment", `file://${tmp}`, "--query", "LastUpdateStatus", "--output", "text"]);
  aws(["lambda", "wait", "function-updated", "--function-name", fn]);
  console.log(`\n${fn}: ${Object.keys(next).length} variable(s) set`);
} finally {
  // Never leave a credential lying in /tmp.
  unlinkSync(tmp);
}

// 5. Confirm the deployed value still parses.
const after = JSON.parse(
  aws(["lambda", "get-function-configuration", "--function-name", fn, "--query", "Environment.Variables", "--output", "json"]),
);
if (after[SA_KEY]) {
  try {
    JSON.parse(after[SA_KEY]);
    console.log(`${SA_KEY}: parses correctly after deploy`);
  } catch {
    console.error(`${SA_KEY} is CORRUPT after deploy — the function will fail at startup.`);
    process.exit(1);
  }
}
for (const p of pairs) {
  const k = p.slice(0, p.indexOf("="));
  if (!(k in after)) {
    console.error(`${k} did not persist`);
    process.exit(1);
  }
}
console.log("all requested variables persisted");
