# Shared Computer Network - Operations

The membership registry for Shared Computer Network: applications, the
admin roster, grants and revocations. Records and the admin console only —
nothing here provisions or meters inference.

## Setup

Two steps need to be done manually in the HappyView dashboard to mint credentials. Outside of that `npm run deploy` installs all variables, lexicons, and scripts automatically.

**1. In the HappyView dashboard**

- Create an **admin API key** (`hv_…`) with permissions for lexicons, scripts, script variables, settings, and backfill.
- Create an **API client key** for this app:
 - **Type:** Public
 - **Client ID URI:** `http://127.0.0.1:5173/oauth/callback`
 - **Client URI:** `http://127.0.0.1:5173`
 - **Redirect URIs:** Whatever is set in `VITE_OAUTH_REDIRECT_URI`. Default `http://127.0.0.1:5173/oauth/callback`.
 - **Scopes:** Identical to `VITE_OAUTH_SCOPE` in your `.env`.

 Copy the `hvc_...` key into `VITE_HV_CLIENT_KEY` after it's created.

**2. Configure and provision**

```sh
cp .env.example .env    # fill in both keys and the service DID
npm install
npm run deploy
```

`npm run deploy` enables the spaces feature flag, uploads every lexicon with its endpoint config, attaches the Lua scripts, and pushes the script variables. It reads `.env` (shell variables win over the file), skips variables that are not set, and every write is an upsert, so re-running is safe. Use `--dry-run` to test.

**3. Bootstrap the registry**

```sh
npm run dev
```

- Sign in at `http://127.0.0.1:5173` as the **service identity** — the DID in
  `VITE_SERVICE_DID`. Its repo anchors the admin roster, and it becomes the
  registry space's permanent authority.
- On `#admin`: **CREATE REGISTRY SPACE**, then copy the resulting uri into
  `VITE_REGISTRY_SPACE_URI` in `.env` and re-run `npm run deploy` so the Lua
  scripts can read it.
- Still on `#admin`: **CREATE ROSTER WITH ME ON IT**, then **ADD ADMIN** for
  each admin DID. Adding an admin writes the roster entry and grants registry
  space write access in one action.
- Sign in as an admin to approve applications. Approval records a tier
  (`level-0`…`level-9`); what a tier entitles someone to is decided elsewhere.

Backfill the `membership.request` and `admin.list` collections from the dashboard if the index needs to catch up on records written before setup.

## Deploying

Static bundle, no backend — privileged work runs in the Lua procedures.

Set `VITE_OAUTH_CLIENT_ID` to the public URL of the client metadata and
`VITE_OAUTH_REDIRECT_URI` to `https://<host>/oauth/callback`, then:

```sh
npm run build   # generates public/client-metadata.json, then dist/
```

Serve `dist/` with an SPA fallback; `/oauth/callback` is a route, not a file.

Update the HappyView API client to match: client ID URL, plus the production
callback added to (not replacing) the loopback redirect URI.

Hosting real client metadata is what makes token refresh work — loopback dev
clients can't refresh, so writes fail a couple of hours after sign-in.

## Development

Open `http://127.0.0.1:5173` — the loopback IP, not `localhost`, and not a
custom hosts entry: the OAuth redirect URI must match exactly, and Web Crypto
requires a hostname the browser treats as a secure context.

Keep DevTools open with "Disable cache" ticked; browsers serve stale JS
modules on loopback otherwise.

## Layout

- `src/` — SPA source. `tests/` mirrors it.
- `lexicons/` — lexicon JSON, uploaded by the deploy script.
- `lua/` — HappyView Lua scripts, attached by the deploy script. The manifest
  at the top of `scripts/deploy.mjs` maps scripts to lexicons and carries the
  endpoint config (`target_collection`, `action`) the dashboard cannot set.
- `mockup/` — design concept, not a spec.

Only `VITE_`-prefixed variables reach the browser. Secrets in `.env` are read
by the deploy script alone and are never bundled.

## Testing

```sh
npm test
```
