# scn-manage

Membership SPA for Shared Computer Network.

## Development

```sh
cp .env.example .env   # fill in the hvc_ client key
npm install
npm run dev
```

Open `http://127.0.0.1:5173` — the loopback IP, not `localhost`, and not a
custom hosts entry: the OAuth redirect URI must match exactly, and Web Crypto
requires a hostname the browser treats as a secure context.

Keep DevTools open with "Disable cache" ticked; browsers serve stale JS
modules on loopback otherwise.

## Layout

- `src/` — SPA source. `tests/` mirrors it.
- `lexicons/` — lexicon JSON, uploaded to the HappyView instance.
- `lua/` — HappyView Lua scripts, deployed via the Admin API. Script env vars
  (`LITELLM_MASTER_KEY`, `SERVICE_DID`, ...) are set in the HappyView
  dashboard, never committed here.
- `mockup/` — design concept, not a spec.

## Testing

```sh
npm test
```

## Deploying lexicons and scripts

`scripts/deploy.mjs` pushes every lexicon, its Lua script, and the endpoint
config the dashboard cannot set (`target_collection`, `action`) to a HappyView
instance. Script variables are read from the environment and pushed only when
set locally. Every write is an upsert, so re-running is safe.

```sh
HAPPYVIEW_URL=http://127.0.0.1:3000 HAPPYVIEW_API_KEY=hv_... npm run deploy
```

Pass `--dry-run` to list what would be written. The manifest at the top of the
script is the source of truth for which script backs which NSID.
