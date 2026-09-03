# scn-member-registry

The membership registry for Shared Computer Network: applications, the admin
roster, grants and revocations. This repo is the registry's *definition* — the
ATProto lexicons and the Lua that serves them — published to a HappyView
AppView. Nothing here provisions or meters inference.

There is no application to run. HappyView is the runtime; `scripts/deploy.mjs`
installs this repo into it.

## Deploying

Node 20+ and nothing else. `deploy.mjs` imports only node builtins and
`fetch`, so there is **no `npm install`** — no dependencies, no lockfile, no
`node_modules/`.

```sh
cp .env.example .env    # fill in HAPPYVIEW_URL, HAPPYVIEW_API_KEY, SERVICE_DID
npm run deploy          # or: node scripts/deploy.mjs
```

It enables the spaces feature flag, uploads every lexicon with its endpoint
config, attaches the Lua scripts (each one prefixed with `lua/lib/prelude.lua`),
and pushes the script variables. It reads `.env`, with shell variables winning
over the file, skips variables that are not set, and every write is an upsert —
so re-running is safe. `--dry-run` walks the whole plan without writing.

One manual step remains outside this repo: the **admin API key** (`hv_`) is
minted in the HappyView dashboard, with permissions for lexicons, scripts,
script variables, settings, and backfill. HappyView exposes no way to create
one from a script, which is why the key is written down rather than generated.

Backfill the `membership.request` and `admin.list` collections from the
dashboard if the index needs to catch up on records written before setup.

## Bootstrap

A registry needs three things before it can answer anything: a space, a roster,
and an admin. Two of the three are covered; the first is not.

- **The registry space** — **not yet automated, and the one real gap.** Its
  authority is fixed at creation and cannot be migrated, so it must be created
  by the service identity. `com.atproto.simplespace.createSpace` is an XRPC
  *procedure*, and HappyView gates procedures behind DPoP authentication, so a
  token-only script cannot call it. The admin console SPA used to do this from
  a browser session; it was deleted with no headless replacement. Until one
  exists, a cluster rebuilt from nothing needs the space created by hand, and
  its uri written into `REGISTRY_SPACE_URI` followed by a re-deploy.

  Tracked as [Corliss #8](https://github.com/Z-Space-Society/Corliss/issues/8).
  Two routes look plausible and neither has been verified: a Lua script writing
  `happyview_spaces` directly through `db.raw` (permitted, but the row's shape
  is unconfirmed and a wrong authority is unfixable), or an upstream procedure
  that takes an explicit authority.

- **The roster and the first admin** — covered by Corliss `v0.9.0`, which
  appoints admins from `/manage/`: it writes the roster entry in the service
  DID's repo *and* grants registry-space write access, which is what makes a
  grant authoritative. Before any roster record exists, `BOOTSTRAP_ADMIN_DID`
  is the sole admin so the first one can be written. An existing-but-empty
  roster fails closed.

Approval records a tier (`level-0`…`level-9`); what a tier entitles someone to
is decided elsewhere.

## Layout

- `lexicons/` — 21 lexicon JSON files, uploaded by the deploy script.
- `lua/` — the HappyView Lua scripts, attached by the deploy script.
  `lua/lib/prelude.lua` is concatenated ahead of each one.
- `scripts/deploy.mjs` — the deployer. Its `MANIFEST` maps each lexicon to its
  Lua script and carries the endpoint config (`target_collection`, `action`)
  that the dashboard cannot set.
- `CLAUDE.md` — the trust model. Read it before changing anything here.

## Testing

There is no test suite in this repo. There was one — it covered the deleted
TypeScript client — and `membership.test.ts` was the second implementation of
membership resolution. `Corliss/corliss/tests/test_reconcile.py` is now the
only place that logic is tested; it is the stricter of the two, asking
`was_admin_at` rather than filtering on `ever_admins`.

Validate a change here with `node scripts/deploy.mjs --dry-run`, which parses
every lexicon and walks the manifest without writing.
