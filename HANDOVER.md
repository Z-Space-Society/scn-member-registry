# HANDOVER.md — decisions, open items, build order

## What this is

A self-service membership and key-management front end for a LiteLLM gateway,
using atproto identity and HappyView as the datastore. Replaces manual
invite-only onboarding.

The wrapper is a **membership** application that happens to include key
management, not a key-management app. Most members will never create a key —
they use Open WebUI and never see one. Build in that order.

## Components

| Name | Host | Role |
|---|---|---|
| manage | manage.sharedcomputer.network | membership SPA (this project) |
| view | view.sharedcomputer.network | HappyView — registry space, Lua procedures |
| gateway | (LiteLLM) | keys, budgets, spend |
| chat | (Open WebUI) | default member-facing app |
| rauthy | (Rauthy) | OIDC for OWUI; `sub` = DID |
| email | Comail | approval and rejection notifications |

## Decisions made

- **No backend service.** The SPA is static. Privileged operations run as
  HappyView Lua procedures holding the master key in `env`. This was tested
  and is viable — see LEARNINGS.md.
- **Author-based authority instead of a service DID.** An admin approving
  someone produces a record authored by that admin, which is a stronger
  accountability record than an anonymous service signature.
- **The registry space is admin-only.** Members are never space members and
  no member-facing code reads the space directly. Member reads go through
  Lua procedures reading the space in-process (`atproto.spaces.*`, which is
  ungated — the script is the access boundary and returns only the caller's
  own state). Zero member write access means zero member forgery surface,
  and the membership roll is not member-visible. Admins hold `write`
  membership; their writes carry their own DID as author — that is what
  author-based verification records.
- **Applications are public indexed records in the applicant's own PDS**,
  picked up from the firehose — not space records. Requesting via the SPA is
  the happy path (it captures a contact email); a raw PDS write is still a
  valid application, it just gets no email notification.
- **The admin roster is a record, not config.**
  `network.sharedcomputer.admin.list` (rkey `self`) in the service DID's own
  repo, indexed like any record and read from Lua via `db.query`. `env` pins
  only `SERVICE_DID` as the immutable trust anchor; the mutable roster lives
  in the record. Entries carry `addedAt`/`removedAt` and are never deleted:
  the write gate uses current admins only, while the read filter (whose
  grants count) uses everyone ever listed, because a departed admin's past
  grants remain valid. Removing an admin also removes their registry space
  membership — that is what stops new writes. The roster UI does both halves
  in one action: the roster write plus space membership sync through the
  authority-gated `setSpaceAccess` procedure (idempotent, so a half-completed
  add is repaired by re-adding). All roster reads fail closed,
  except first-run: with no roster record at all, `env.BOOTSTRAP_ADMIN_DID`
  is the sole admin, and the admin UI's roster manager writes the first
  roster (via `setRoster`, which must include the bootstrap admin or their
  bootstrap-era grants stop counting).
- **LiteLLM `user_id` = DID**, making `/user/new` idempotent and approval
  retryable. There is no transaction across the LiteLLM call and the grant
  write; idempotency is the mitigation.
- **Budget on the LiteLLM user, not the key.** Members can self-issue keys;
  if budgets lived on keys, the tier cap would be meaningless.
- **Model restrictions via LiteLLM access groups.** Group records store an
  access-group name. Adding a model to a tier is a LiteLLM-side change and
  nothing in HappyView moves.
- **Per-member limits live in LiteLLM, not in records.** A group record maps
  a membership tier to a LiteLLM group; the limits themselves (tokens and
  requests per week, per member) are configured and enforced on the LiteLLM
  side. HappyView stores the mapping, never the numbers.
- **Grant and revocation rkeys are `{memberDid}:{tid}`.** Append-only means
  rkeys must be unique per event — plain `rkey = DID` collides the first time
  the same admin re-grants a returning member. Encoding subject and time in
  the rkey also makes `listRecords` (which returns rkeys only) sufficient to
  resolve the whole roll with no N+1. A member is active iff their latest
  event across the grant and revocation collections is a grant. Resolution
  lives in a single Lua query procedure so the admin DID list stays in `env`.
- **Rauthy stays** for OWUI OIDC. The SPA authenticates directly against
  HappyView with DPoP. Two auth paths, reconciled on the DID.
- **The network service identity is did:plc, not did:web.** Grants are the
  network's permanent record and should not depend on a domain registration.
  The PLC directory is US-operated — the same sovereignty tension that
  already applies to member identity.
- **Approval is one Lua procedure.** `space:put_record` from Lua records
  `author_did = caller_did`, enforced by the runtime (there is no way to
  write as another DID), so `approveMember` gates on the roster, provisions
  LiteLLM, and writes the grant as the calling admin in a single call. No
  transaction spans the LiteLLM call and the write; idempotency on both
  sides is the mitigation.

## Rejected, with reasons — do not re-propose

- **Client-only app with no privileged layer.** `/key/generate` accepts
  `user_id`, `models`, and `max_budget`; a browser holding a credential that
  can call it is a browser holding proxy admin. Lua procedures are the
  privileged layer.
- **Email as the identifier.** Declinable at the consent screen, mutable,
  absent on some self-hosted PDSes.
- **Entitlement authoritative in HappyView alone with no publishing story.**
  Superseded — see open items; the current design writes grants to the space
  and that is the record, but note the no-validation caveat.
- **Member read access to the registry space, `read` or `read_self`.**
  Dissolved: members are not space members at all. Applications live in the
  applicant's own PDS and everything in the registry is admin-authored, so
  space membership would buy a member nothing except a view of the roll.
  Members reach their own data through Lua procedures instead.

## Data model

Space: `network.sharedcomputer.registry` / `main`
Authority: network service DID (did:plc), set at creation, not migratable.
Mint policy: `managing-app`.
`appAccess`: allowList containing only the manage app.
Space membership: admins only.

Space collections (all admin-authored):

- `network.sharedcomputer.membership.grant` — admin-authored,
  rkey = `{did}:{tid}`. Carries status, groups, litellmUserId, grantedAt.
- `network.sharedcomputer.membership.revocation` — admin-authored,
  rkey = `{did}:{tid}`. Carries revokedAt. Append-only; a member is active
  iff their latest event across grant and revocation is a grant.
- `network.sharedcomputer.group` — admin-authored, rkey = slug.
  displayName, modelAccessGroup.

Indexed (non-space) records:

- `network.sharedcomputer.membership.request` — written by the applicant to
  their own PDS, indexed from the firehose. Public to the network, so it
  carries the bare assertion only — never an email. The applicant can edit or
  delete it; decision history lives in the registry space, so rejection is
  recorded admin-side, not by marking the request.

## Open items

1. **The space authority must be a service DID — blocking, above all others.**
   The test space was created under a personal DID, which makes that person
   the authority; grants under it would be authored by an identity no one
   else can act as. Space authority is set at creation and cannot be
   migrated, so the test space is disposable — build nothing real under it.
   The service identity is an ordinary atproto account owned by the network:
   did:plc on any PDS (portable later), org email, handle
   `sharedcomputer.network` via DNS TXT, and an org-held rotation key added
   to the PLC document — custody of that key is the board-level question.
   It must be a full account with a PDS repo, not a bare identity: it owns
   the admin roster record. Do not confuse it with HappyView's "Service
   Identity" feature, which is the view instance's own did:web for service
   auth. Until the real account exists, dev proceeds under a stand-in
   account; cutover = create the real space fresh, rewrite the roster, swap
   `SERVICE_DID`/`REGISTRY_SPACE_URI`/`VITE_SERVICE_DID`, and re-run
   `approveMember` per member (idempotent). Nothing real accumulates under
   the stand-in. Open governance
   question, board-level: rotation key custody. A holder of the did:plc
   rotation key can speak as the network — issue grants, revoke members,
   re-point the identity — and the key cannot be re-issued if lost. It is a
   more consequential secret than the LiteLLM master key, which can be
   rotated.
2. **Verify firehose ingestion of the application collection — partially
   resolved 2026-07-29.** SPA submissions work end to end, but through the
   procedure write path, which mirror-writes the index directly: no firehose
   involved and **no trigger fires**. Still unverified: a raw PDS write from
   another client being ingested, and record triggers firing for this
   collection at all. Matters for atproto-native applications and for
   admin-notification triggers. Test: write the record from a second
   account without the SPA. No longer blocks signup via the SPA.
3. **Lua can reach LiteLLM — resolved 2026-07-28.** `gatewayHealth` read
   `env.LITELLM_MASTER_KEY` and got a 200 from `/health/liveliness` via
   `http.get`. Secrets and egress both work. Caveat: that endpoint is
   unauthenticated, so key *validity* stays unproven until the provisioner
   key arrives and the script points at an authenticated route.
4. **Rauthy `sub` — resolved (v0.36.1 source).** It is Rauthy's internal
   24-character user ID, never the DID. The DID is stored as
   `federation_uid`, readable only via the admin API; no token claim carries
   it by default. Remaining decision: expose it as a custom attribute +
   custom scope (must be populated per user via the admin API, and only
   after first login creates the federated user), or treat `sub` as opaque
   and resolve to the DID server-side. Also verified: Rauthy hard-requires
   an email for atproto logins, and the atproto provider ships with
   `auto_onboarding: false`.
5. **Verify the OWUI → LiteLLM attribution join.** Send one message as a test
   member and confirm spend lands on the right user. Everything downstream
   depends on this and it fails silently.
6. **Confirm daily aggregate tables survive `disable_spend_logs`** on the
   pinned LiteLLM version. If they do, the usage view needs no snapshot cron.
7. **Space record validation** — confirm empirically that a garbage `$type`
   and undeclared fields are accepted. If so, record shape is a convention the
   wrapper upholds, not a guarantee.
8. **Email storage mechanism — parked.** The SPA captures a contact email at
   request time; it must live server-side, since the application record is
   public. Space credentials turned out to be read-only, so the
   credential-write plan is dead. Leading option: a plain script-local SQL
   table written via `db.raw` INSERT from a procedure (non-`happyview_`
   tables are unrestricted); PII stays out of records and spaces entirely.
   Decide retention when built. Blocks nothing else.
9. **rkey limits — resolved from source.** No length or charset validation
   on space record rkeys. The only constraints: non-empty and no `/` (the
   record URI is slash-joined). Omitted rkeys get a TID. Caution found
   nearby: `getRecord` looks up by (space, collection, rkey) ignoring the
   author, `LIMIT 1` — same-rkey records by different authors return an
   arbitrary one, so author-unique rkeys (ours are) are mandatory.
10. **Space credential for Lua — dissolved.** Lua reads space records
    in-process via `atproto.spaces.*` with no credential and no membership
    check; the script is the access boundary. Credentials (2 h TTL, minted
    via a 60 s delegation token, DPoP holder with full read membership only,
    read-only, revoked on member removal) matter only for external
    cross-service readers, which this design no longer has.
11. **Does HappyView accept atproto service-auth tokens? Source says yes,
    with conditions.** The Bearer JWT is verified against the issuer's DID
    doc (`#atproto` key), but `aud` must be `<instance DID>#<fragment>` and
    the fragment must name a registered service entry that allowlists the
    method. Open question: whether a standard PDS will mint a fragmented
    `aud` via `getServiceAuth` — needs a live test (instrument: `whoami`).
    If it works, the SPA can switch to the official
    `@atproto/oauth-client-browser` (automatic refresh, no HappyView SDK);
    service-auth callers cannot PDS-write through HappyView, which is fine
    because an official-client SPA writes the PDS directly.

## Build order

1. LiteLLM in front of llama-server, with pricing. **Verify usage accounting
   end to end before writing any UI** — including streamed responses, where a
   missing usage block silently produces estimated (wrong) token counts.
2. Open item 3 — prove Lua can reach LiteLLM with a secret from `env`.
3. Open item 2 — verify firehose ingestion of applications.
4. Service identity (open item 1), then the registry space fresh under it,
   collections, the admin roster record in the service DID's repo. The test
   space is disposable.
   Space creation happens in-app (an admin page wrapping
   `com.atproto.simplespace.createSpace`) — the dashboard has no spaces UI.
5. Procedures: `approveMember` first, since it is the one that must be right.
6. SPA: sign in, request membership, pending state, member dashboard.
7. OWUI SSO against Rauthy, gated on a group claim so unapproved applicants
   cannot walk in. Group assignment happens through the Rauthy admin API at
   approval time; the atproto provider ships with auto-onboarding off.
8. Key issuance — last. Serves a minority of members.

## Not in scope for v1

Per-key sub-caps. Usage history retention across a gateway swap. The community
knowledge base. Governance voting. Anything involving a second HappyView
instance.
