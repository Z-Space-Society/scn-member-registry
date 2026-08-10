#!/usr/bin/env node
/**
 * Deploys lexicons, Lua scripts, and script variables to a HappyView instance.
 *
 *   HAPPYVIEW_URL=http://127.0.0.1:3000 HAPPYVIEW_API_KEY=hv_... \
 *     node scripts/deploy.mjs [--dry-run]
 *
 * Endpoint config that the dashboard cannot set (target_collection, action)
 * lives in the MANIFEST below, alongside which Lua script backs which NSID.
 * Re-running is safe: every write is an upsert.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Loads .env into process.env without overwriting values already set, so a
 * shell export or CI secret still wins over the file.
 */
async function loadDotEnv(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || line.trimStart().startsWith("#")) continue;
    const value = match[2].trim().replace(/^["'](.*)["']$/, "$1");
    if (!(match[1] in process.env)) process.env[match[1]] = value;
  }
}

await loadDotEnv(join(ROOT, ".env"));
const REQUEST_COLLECTION = "network.sharedcomputer.membership.request";
const ADMIN_LIST_COLLECTION = "network.sharedcomputer.admin.list";

/**
 * One entry per lexicon. `script` attaches a Lua file; `targetCollection` and
 * `action` configure HappyView's built-in record-write handler (used only by
 * script-less procedures). `backfill` applies to record lexicons.
 */
const MANIFEST = [
  { file: "network.sharedcomputer.membership.request.json", backfill: true },
  { file: "network.sharedcomputer.admin.list.json", backfill: true },
  {
    file: "network.sharedcomputer.membership.submitRequest.json",
    targetCollection: REQUEST_COLLECTION,
    action: "update",
  },
  {
    file: "network.sharedcomputer.membership.withdrawRequest.json",
    targetCollection: REQUEST_COLLECTION,
    action: "delete",
  },
  {
    file: "network.sharedcomputer.admin.setRoster.json",
    targetCollection: ADMIN_LIST_COLLECTION,
    action: "update",
  },
  { file: "network.sharedcomputer.admin.gatewayHealth.json", script: "gateway_health.lua" },
  { file: "network.sharedcomputer.admin.whoami.json", script: "whoami.lua" },
  { file: "network.sharedcomputer.membership.listRequests.json", script: "list_requests.lua" },
  { file: "network.sharedcomputer.membership.listMembers.json", script: "list_members.lua" },
  { file: "network.sharedcomputer.membership.getMine.json", script: "get_my_membership.lua" },
  { file: "network.sharedcomputer.admin.approveMember.json", script: "approve_member.lua" },
  { file: "network.sharedcomputer.admin.setSpaceAccess.json", script: "set_space_access.lua" },
];

/**
 * Script variables to push. Read from .env or the shell; anything unset is
 * skipped, so an early deploy before the space exists is fine. The public
 * VITE_ twins are accepted as fallbacks for the values that appear in both
 * places, so they only need writing down once.
 */
const VARIABLES = [
  { key: "LITELLM_BASE_URL" },
  { key: "LITELLM_PROVISIONER_KEY" },
  { key: "SERVICE_DID", fallback: "VITE_SERVICE_DID" },
  { key: "BOOTSTRAP_ADMIN_DID" },
  { key: "REGISTRY_SPACE_URI", fallback: "VITE_REGISTRY_SPACE_URI" },
];

const baseUrl = (
  process.env.HAPPYVIEW_URL ??
  process.env.VITE_HAPPYVIEW_URL ??
  ""
).replace(/\/$/, "");
const apiKey = process.env.HAPPYVIEW_API_KEY;
const dryRun = process.argv.includes("--dry-run");

if (!baseUrl || !apiKey) {
  console.error(
    "Missing config. Set HAPPYVIEW_API_KEY (and HAPPYVIEW_URL or\n" +
      "VITE_HAPPYVIEW_URL) in .env — see .env.example."
  );
  process.exit(1);
}

async function send(method, path, body) {
  if (dryRun) {
    console.log(`  DRY RUN ${method} ${path}`);
    return;
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${path} → ${res.status} ${await res.text()}`);
  }
}

const post = (path, body) => send("POST", path, body);

let failures = 0;

// Spaces ship disabled; every space route 404s and the Lua spaces API is
// absent until this instance setting is "true".
try {
  await send("PUT", "/admin/settings/feature.spaces_enabled", { value: "true" });
  console.log("feature.spaces_enabled: on");
} catch (e) {
  console.error(`feature.spaces_enabled: FAILED ${e.message}`);
  failures++;
}

for (const entry of MANIFEST) {
  const lexicon = JSON.parse(
    await readFile(join(ROOT, "lexicons", entry.file), "utf8")
  );
  const type = lexicon.defs?.main?.type;
  console.log(`${lexicon.id} (${type})`);

  try {
    await post("/admin/lexicons", {
      lexicon_json: lexicon,
      backfill: Boolean(entry.backfill),
      ...(entry.targetCollection
        ? { target_collection: entry.targetCollection }
        : {}),
      ...(entry.action ? { action: entry.action } : {}),
    });

    if (entry.script) {
      const body = await readFile(join(ROOT, "lua", entry.script), "utf8");
      await post("/admin/scripts", {
        id: `xrpc.${type}:${lexicon.id}`,
        script_type: "lua",
        body,
        description: `Deployed from lua/${entry.script}`,
      });
      console.log(`  + ${entry.script}`);
    }
  } catch (e) {
    console.error(`  FAILED: ${e.message}`);
    failures++;
  }
}

for (const { key, fallback } of VARIABLES) {
  const value = process.env[key] ?? (fallback ? process.env[fallback] : undefined);
  if (!value) {
    console.log(`${key}: not set locally, skipped`);
    continue;
  }
  try {
    await post("/admin/script-variables", { key, value });
    console.log(`${key}: set`);
  } catch (e) {
    console.error(`${key}: FAILED ${e.message}`);
    failures++;
  }
}

if (failures) {
  console.error(`\n${failures} operation(s) failed`);
  process.exit(1);
}
console.log("\nDeploy complete.");
