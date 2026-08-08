# LEARNINGS.md — HappyView, empirically

Findings from two days of building against HappyView v2.x. Most of this is not
in the documentation. Verify against your version before relying on it.

## Mental model

HappyView is lexicon-driven: upload a lexicon, get an XRPC endpoint, attach Lua
for the logic. Roughly what Drupal is to websites — you accept someone else's
content model in exchange for not building the boring 80%.

There are **two entirely separate storage systems** and conflating them will
waste a day:

| | Indexed records | Space records |
|---|---|---|
| URI | `at://did/collection/rkey` | `at://did/space/type/skey/author/collection/rkey` |
| Lives in | user's PDS, mirrored to HappyView index | HappyView only |
| Lexicon | required, validated | not used at all |
| Lua access | `db.query`, `Record` | `xrpc` calls only |
| Triggers | yes | no |
| Backfill | yes | n/a |
| Portable | yes — any AppView can index | no — CAR export only |

## Auth and the SDK

- Only the `atproto` scope is registered on a new API client. Any write scope
  must be **added to the client in the dashboard AND requested at signIn**.
  Either alone fails, and the failure mode is a consent screen that says
  nothing about writes.
- Granular `repo:<nsid>?action=create` scopes **work end to end**
  (confirmed 2026-07-29: client config, consent, token exchange, and
  HappyView session registration all pass, localhost dev client included).
  The earlier "granular scopes don't work" finding was a misdiagnosis
  stacking three separate behaviors: the lone `POST /oauth/token` 400 (the
  normal DPoP nonce dance, retried automatically), a stale pre-scope-change
  session being silently restored after a genuinely failed callback, and
  writes failing for the unrelated reason below.
- **Do not call `com.atproto.repo.*` through the HappyView session, reads
  included.** Those NSIDs are proxied to their authority — Bluesky's
  infrastructure — so `getRecord` lands on api.bsky.app, which only serves
  collections the Bluesky AppView indexes: custom-collection records return
  `RecordNotFound` even when they sit in HappyView's own index (verified:
  identical error bodies from view.sharedcomputer.network and api.bsky.app).
  Writes die earlier with the PDS's `AuthMissing` (proxied without auth).
  The rules: **read** custom records from the owner's PDS directly (resolve
  DID → PDS endpoint → public `getRecord`) or via your own query endpoints
  over the index; **write** through your own procedure lexicons configured
  with `target_collection` + action (`create` mints a TID rkey;
  `update`/`delete` take a `uri` input and trust only its rkey, scoped to
  the caller's repo; `upsert` sniffs for `uri`).
- The localhost dev client ID is `http://localhost?redirect_uri=...&scope=...`.
  The `client_id` uses the literal string `localhost`; the `redirect_uri`
  inside it must be a loopback **IP** (`127.0.0.1`) — atproto rejects the
  `localhost` hostname in redirect URIs per RFC 8252.
- Web Crypto (needed for PKCE) requires a secure context. Over plain HTTP that
  means `127.0.0.1`, `::1`, or `localhost` only. A custom `/etc/hosts` name
  pointing at loopback is **not** a secure context — the browser checks the
  hostname string, not what it resolves to. Symptom is
  `Cannot read properties of undefined (reading 'digest')`.
- The SDK's default callback path is `/oauth/callback`. It must match the
  `redirect_uri` in the client ID exactly.
- `oauthClient.init()` does double duty: completes the OAuth callback **and**
  restores an existing session. Call it once on page load. From source: the
  SDK strips the callback params from the URL **before** the token exchange,
  so a failed exchange throws once and every later load silently restores
  the previous session. Failed attempts also leak `pending-auth:*` rows in
  localStorage.
- The first `POST /oauth/token` **always returns 400** (DPoP nonce dance)
  and the SDK retries with the nonce. A lone 400 in the console is normal;
  judge the exchange by whether a second POST followed with 200.
- `getTokenInfo()` never populates `expired`/`expiresAt` (declared in the
  type, absent in the implementation). You cannot detect token expiry
  client-side.
- HappyView's own session check never consults token expiry: possession of
  the DPoP key is the credential, and `ath` is computed over whatever token
  the client presents. Server-side, HappyView refreshes the atproto tokens
  lazily when a proxied PDS write 401s (it stored the refresh token at
  registration); a permanent `invalid_grant` deletes the session. Net: a
  browser session works indefinitely for HappyView-local calls.
- The server-side lazy refresh presents the API client row's `client_id_url`
  as the OAuth client_id (loopback-looking URLs are synthesized into
  `http://localhost?scope=...`). With a non-loopback `client_id_url` that
  serves no client-metadata JSON, refresh fails with
  `invalid_client_metadata` — observed live: writes start failing about two
  hours after sign-in with "Unable to obtain client metadata". Dev
  workaround: sign out and back in, then retry the write. In production the
  SPA must host real client metadata at the client_id URL, which makes
  refresh work. The root problem: session registration never receives the
  client_id the browser actually authorized with, so the server's refresh
  can never exactly match a loopback dev client.
- The scope gate is `POST /oauth/sessions` (`validate_scopes`): every token
  scope must be covered by the client's registered scopes. PDS-granted
  `repo?collection=X` is covered by `transition:generic` or by any
  registered/expanded `repo:X?action=...`; `include:<nsid>` client scopes
  expand from a permission-set lexicon in the instance's lexicon registry
  (no DNS involved). After registration, HappyView never enforces scopes —
  proxied PDS writes are decided by the PDS.
- Service auth: HappyView accepts Bearer JWTs verified against the issuer's
  DID doc (`#atproto` key), but requires `aud` = `<instance DID>#<fragment>`
  where the fragment names a registered service entry allowlisting the
  method. Whether a standard PDS mints fragmented `aud` values is untested.
- The SPA is the OAuth client, not HappyView. The redirect comes back to your
  app. HappyView provisions the DPoP keypair at the start and receives tokens
  at the end; it is not in the redirect path.

## XrpcClient

- `new XrpcClient(session, [lexicons])` accepts the HappyView session object
  directly as the fetch handler. Confirmed working.
- It validates NSIDs against locally supplied lexicons. Custom NSIDs need a
  lexicon object passed in or you get `Lexicon not found`.
- Minimal inline lexicons are fine — `{lexicon:1, id, defs:{main:{type:"query"}}}`.
  No codegen needed.
- **Query parameters must be declared** in the lexicon's `parameters` block or
  the client rejects them before sending (`Invalid query parameter: limit`).
  curl doesn't care, so this only bites in the browser.
- `agent.call()` from `@atproto/api` only knows bundled `com.atproto.*` and
  `app.bsky.*` lexicons. Use `XrpcClient` instead.
- The `lex` CLI downloads from the **network** via DNS authority resolution.
  It cannot fetch lexicons that only exist in your HappyView instance.

## Lua

- `require`, `io`, `package`, and `debug` are stripped. No external libraries,
  no `cjson` — `json` is already a global. There is **no `urlencode`**.
  Useful globals from source: `TID` (mint and convert TIDs), `now()`,
  `toarray`, a trimmed `os`. Instruction cap: 1,000,000 per run.
- `db.query{ collection, did?, limit?, cursor?, sort?, filter? }` returns
  `{ records, cursor }`; each row is the record's fields **flat** with `uri`
  injected — no `.value` nesting, no `did`/`rkey`/`cid`. It reads only the
  firehose index, never space records.
- `atproto.spaces.*` reads space records **in-process, ungated**:
  `query{space_uri, collection?, limit?, cursor?}` rows carry full values
  plus `authorDid` and `rkey` (unlike HTTP `listRecords`), and
  `get_access(space_uri, did)` / `is_member` / `list_members` answer
  membership directly. No credential, no membership check — the script is
  the access-control boundary, so scope every read by `caller_did`.
- Space **writes** from Lua exist: `space:write_record` / `put_record`
  record `author_did = caller_did`, always — there is no way to write as
  another DID. Caller must hold `write` membership. `delete_record` only
  deletes the caller's own records. `add_member`/`remove_member`/`update`/
  `create_invite` require the space authority or an instance super-user.
- The gated write operations are registered in **query** scripts too: an
  authenticated GET can mutate spaces. Keep query scripts read-only by
  convention; procedures are where writes belong.
- `db.raw` executes **any** SQL, including INSERT/UPDATE, on the allowed
  tables — which include space records and members. A deployed script can
  forge records with arbitrary authors: script deployment is the trust
  boundary. Never build raw SQL from caller input.
- `xrpc.query`/`xrpc.procedure` dispatch known lexicons in-process with the
  caller's identity, but **unknown NSIDs are proxied to the NSID's authority
  unauthenticated**, and space routes are unreachable. Returns
  `{status, body}` with `body` a raw JSON string.
- **A nil value in a table means the key does not exist.** So
  `db.query({did = caller_did})` with a nil `caller_did` silently returns
  *unfiltered* results rather than erroring. This is a real security bug class.
  Guard explicitly: `if not caller_did then error("...") end`.
- `caller_did` is **nil for unauthenticated queries**. `X-Client-Key` alone
  identifies the app, not a person. Queries cannot self-scope without a DPoP
  session.
- `http.get` returns `{status, body, headers}` and does not throw on HTTP
  errors — but **does** throw on DNS failure. Wrap in `pcall`.
- `error()` produces a generic 500 to the client; the real message is
  server-side only. Return a structured table for expected failures.
- `toarray()` forces an empty table to serialise as `[]` rather than `{}`.
  Needed for array fields or schema validation fails.
- `env` holds script variables set in the dashboard. This is the secrets
  mechanism. Scripts are also manageable via the Admin API, so deploy-from-git
  is possible.
- A query lexicon with no Lua script attached is served by a built-in list
  mode: calling it returns
  `"<nsid> has no target_collection configured for list queries"` (400).
  Uploading the lexicon creates the endpoint; attaching the script gives it
  your behavior.

## Trigger scripts

- The global is `event`, shaped:
  `{action, collection, did, record, rkey, uri}`. The record is inline —
  no need to load it.
- Triggers are **pre-index hooks**, not post-write callbacks. You return a
  transformed record and that is what gets indexed. Returning `nil` **drops
  the record from the index entirely**.
- **Return `event.record`, not `event`.** Returning the whole envelope stores
  the envelope as the record body, producing rows with `action`/`did`/`rkey`
  columns instead of your fields. This is silent — the write returns 200 and
  queries look plausible. Only visible in the dashboard records table.
- Record scripts run in **no-auth mode**: `save_local()` works, `save()`
  raises. A trigger cannot write to a PDS — there is no session at trigger
  time, and the record may have come from anyone's repo via Jetstream.
- Backfill fires triggers, so derived data regenerates on re-index. This makes
  enrichment self-healing — a sidecar collection is unnecessary.
- Corollary: a backfill over N records means N outbound HTTP calls as fast as
  the indexer runs. Fine at 11 records; consider it at scale.
- Failures go to the dead letter queue, not to any HTTP response.

## Spaces

- Space records have **no schema validation**. `collection` is a string you
  assert; `record` is an arbitrary object. (Worth re-verifying — absence in
  docs is not proof.)
- `allowedCollections` is populated **at space creation time** from the space
  type lexicon's `defs.main.collections`. Uploading the type lexicon
  afterwards does not backfill it.
- **Spaces are behind a feature flag.** With `feature.spaces_enabled` off,
  every space route returns 404 `FeatureDisabled` and the Lua spaces API is
  absent. Newer builds ship it **off by default** — verified 2026-08-08, when
  an upgrade of the deployed instance silently disabled every space call.
  Enable it under the dashboard's feature flags (`/admin/feature-flags`)
  before anything space-related will work.
- Mint policies: `managing-app`, `member-list`, `public`. Mint policy governs
  who can create repos in the space; it has no effect on record authorship.
  Verified: a member DPoP write into a `managing-app` space returns a URI
  with the member's DID in the author segment.
- Space authority defaults to whoever creates the space and cannot be changed
  afterwards. A service identity must exist before any long-lived space is
  created.
- **The author DID is always the authenticated user.** You cannot write as
  someone else. This is what makes author-based verification work.
- `read_self` means a member reads only their own records; reading another
  member's returns 403.
- `listRecords` returns only `collection`, `rkey`, and `cid` — **no values**.
  Listing then requires an N+1 `getRecord`. Design rkeys so you can fetch
  directly. (Source: the `repo` param is the author filter; with a DPoP
  session and no explicit `repo` it defaults to **your own DID**, with a
  credential it defaults to all authors.)
- `getRecord` takes (space, collection, rkey) with **no author param** and
  resolves collisions with `LIMIT 1`, arbitrarily. Two authors reusing an
  rkey in one collection is silent data roulette — keep rkeys author-unique.
- Colons are legal in rkeys, so a full DID works as a key. No length or
  charset validation at all (source); only non-empty and no `/`.
- Mint policy is consulted **only** at credential issuance. Record writes are
  gated purely by membership access level; `appAccess` likewise only gates
  credentials.
- Space admin (add/remove members, update, invites) = the authority DID or
  an instance super-user. `write` members cannot administer.
- Invites are the intended onboarding path: the authority mints
  (`create_invite`, admin-only), the joiner self-accepts (`accept_invite`,
  any authenticated caller), landing at the invite's access level.
- You can only delete your own records — which is why revocation must be
  append-only rather than deletion.
- `getSpace` returns **404** for non-members, not 403.
- Cross-service reads use a space credential as a Bearer token, no DPoP.
  Space credentials expire after 2 hours — they are session tokens, not
  durable secrets, and cannot be parked in script `env`. From source:
  minting is a two-step flow (60 s delegation token, then the credential),
  requires a DPoP session with full `read` membership, credentials are
  **read-only** (writes are Forbidden), are revoked when the member is
  removed, and a Bearer credential is only accepted on the
  `dev.happyview.space.*` alias routes — the documented `com.atproto.space.*`
  paths reject it. Lua cannot mint or use one.
- `createRecord` requires write membership — see the open question about how
  non-members submit anything.

## Raise with Trezy — docs and bugs

1. **Statusphere step 6 is a cliff.** Steps 1–5 are dashboard-only, fifteen
   minutes. Step 6 says "the JavaScript SDK handles this for you, but you can
   test with curl if you have a token" and never explains how to get one.
   Most people will stop here. This is the single highest-value fix.
2. **Step 3 doesn't mention scopes.** The tutorial has you create an API
   client, then write records in step 5, without ever saying a write scope must
   be added. Guaranteed 403.
3. **The Record & Label Scripts guide 404s.** It's linked from the Lua
   Scripting page (twice) and from the introduction, and is absent from the
   sidebar. Record-script globals are documented nowhere as a result — the
   `event` shape above was found by dumping it.
4. **Trigger return semantics are ambiguous.** "Returns either a transformed
   event/record" — returning `event` silently corrupts the index. Worth being
   explicit, with a warning.
5. **`ats://` vs `at://` inconsistency.** The createSpace response example
   shows `at://`; the decoded pagination cursor shows `ats://`. Actual returns
   use `ats://`.
6. **No dev loop for scripts.** No test harness, no dry run, no local
   execution. Triggers in particular are undebuggable from the client side —
   failures go to the DLQ and the only introspection is `log()` plus the event
   log.
7. **The browser SDK cannot refresh a session.** `StoredSession` keeps no
   refresh token, so every session dies at access-token expiry and the app
   must detect it and re-authenticate. Table stakes for a real SPA.
8. **A failed OAuth callback is silently swallowed.** The SDK strips
   `code`/`state` from the URL (`history.replaceState`) *before* attempting
   the token exchange, so a failure surfaces once and every later load
   quietly restores the previous stored session — the user looks signed in
   with stale scopes. Failed attempts also leak `pending-auth:*` rows in
   localStorage. (Originally misdiagnosed as "granular scopes break the
   token exchange" — they don't; the lone `/oauth/token` 400 is the normal
   DPoP nonce dance.)
9. **`getTokenInfo()` never populates `expired`/`expiresAt`.** Both are
   declared in the TypeScript types and absent from the implementation, so
   token expiry is undetectable client-side.
10. **The dashboard cannot configure record-write procedures.** The "Record
    Collection" field on the local lexicon upload form is commented out in
    the frontend source and there is no action field, so
    `target_collection`/`action` are settable only via `POST /admin/lexicons`.
    The statusphere write model is unusable from the UI.
11. **Space credentials are only accepted on `dev.happyview.space.*` routes.**
    The docs point at `com.atproto.space.*`, which rejects them with "space
    credentials are only accepted on space routes".
12. **`com.atproto.repo.*` calls through a session are proxied
    unauthenticated** to the resolved authority. Writes fail with the PDS's
    `AuthMissing`, and no error hints that record writes are supposed to go
    through your own procedure lexicons instead.
13. **`db.raw` permits INSERT/UPDATE** on the allowed internal tables,
    including space records and members — a deployed script can forge space
    records with arbitrary author DIDs. Should probably be read-only.
14. **Space `getRecord` ignores the author segment** of the seven-segment
    URI and resolves same-rkey collisions with an unordered `LIMIT 1`.
15. **Server-side token refresh cannot match browser dev clients.**
    `POST /oauth/sessions` never receives the client_id the browser
    authorized with, so the lazy refresh on a PDS-write 401 presents the API
    client row's `client_id_url` instead. A non-loopback URL that 404s
    yields `invalid_client_metadata`; even the loopback synthesis
    (`http://localhost?scope=...`) differs from the SDK's
    `http://localhost?redirect_uri=...&scope=...`. Registration should
    accept and store the authorized client_id and reuse it for refresh.

## Things worth building on

- **Local script development.** The v3 notes mention managing lexicons and
  scripts from the filesystem; a `happyview dev` that runs a script against a
  fixture would remove most of the pain above.
- **Space record validation.** Attaching a lexicon to a space collection would
  make spaces usable for anything money-adjacent.
- **`listRecords` with values**, or a projection parameter. The N+1 is a real
  constraint on any list UI.
- **A spaces UI in the dashboard.** Currently API-only as far as we can tell.

## Non-HappyView gotchas that cost time

- Brave (and Chrome, and Safari) will serve cached JS modules on loopback.
  Tick "Disable cache" in DevTools and leave DevTools open.
- Vite's file watcher did not receive fsevents on macOS despite fsevents being
  installed and the project living outside any sync folder. Symptom: no fresh
  `page reload` line in the terminal on save. Fix:
  `server: { watch: { usePolling: true, interval: 300 } }` in `vite.config.js`.
  Cause never identified.
