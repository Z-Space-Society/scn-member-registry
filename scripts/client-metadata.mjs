#!/usr/bin/env node
/**
 * Generates public/client-metadata.json from .env. The PDS fetches it at the
 * client ID URL; its scope and redirect URI must match what the app requests.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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

const clientId = process.env.VITE_OAUTH_CLIENT_ID;
if (!clientId) {
  console.log(
    "VITE_OAUTH_CLIENT_ID not set — skipping client metadata (loopback dev client)."
  );
  process.exit(0);
}

const redirectUri = process.env.VITE_OAUTH_REDIRECT_URI;
const scope = process.env.VITE_OAUTH_SCOPE;
if (!redirectUri || !scope) {
  console.error(
    "VITE_OAUTH_REDIRECT_URI and VITE_OAUTH_SCOPE are required to build client metadata."
  );
  process.exit(1);
}

for (const [name, value] of [
  ["VITE_OAUTH_CLIENT_ID", clientId],
  ["VITE_OAUTH_REDIRECT_URI", redirectUri],
]) {
  if (!value.startsWith("https://")) {
    console.error(`${name} must be https:// in production, got: ${value}`);
    process.exit(1);
  }
}

const metadata = {
  client_id: clientId,
  client_name: process.env.VITE_APP_NAME ?? "Shared Computer Network",
  client_uri: new URL(clientId).origin,
  redirect_uris: [redirectUri],
  scope,
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
  application_type: "web",
  dpop_bound_access_tokens: true,
};

const out = join(ROOT, "public", "client-metadata.json");
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(metadata, null, 2) + "\n");
console.log(`client metadata written for ${clientId}`);
