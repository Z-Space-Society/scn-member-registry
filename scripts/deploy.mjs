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
  { file: "network.sharedcomputer.membership.getMine.json", script: "get_my_membership.lua" },
  { file: "network.sharedcomputer.admin.approveMember.json", script: "approve_member.lua" },
  { file: "network.sharedcomputer.admin.setSpaceAccess.json", script: "set_space_access.lua" },
];

/** Script variables to push, read from the environment. */
const VARIABLES = [
  "LITELLM_BASE_URL",
  "LITELLM_PROVISIONER_KEY",
  "SERVICE_DID",
  "BOOTSTRAP_ADMIN_DID",
  "REGISTRY_SPACE_URI",
];

const baseUrl = (process.env.HAPPYVIEW_URL ?? "").replace(/\/$/, "");
const apiKey = process.env.HAPPYVIEW_API_KEY;
const dryRun = process.argv.includes("--dry-run");

if (!baseUrl || !apiKey) {
  console.error("HAPPYVIEW_URL and HAPPYVIEW_API_KEY are required");
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

for (const key of VARIABLES) {
  const value = process.env[key];
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
