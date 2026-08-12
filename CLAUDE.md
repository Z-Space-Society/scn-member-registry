# CLAUDE.md — architecture invariants

Living document. These are constraints that should not drift. If a change
appears to require breaking one of these, stop and raise it rather than
working around it.

## Identity

- **DID is the join key, everywhere, forever.** HappyView `caller_did`, record
  rkeys, and the user id of anything downstream. Never key on handle or email.
- Rauthy `sub` is an opaque internal ID, not the DID. The DID lives in the
  Rauthy user's `federation_uid`, reachable via the admin API or a custom
  claim. Resolve `sub` to the DID at the boundary; never treat `sub` as the
  DID.
- Handles are mutable and display-only. Refresh on every login; never store as
  a foreign key.
- Email is required at signup (`transition:email`): Rauthy will not create an
  atproto-federated user without one, so a member without email could never
  reach chat. It remains a notification channel and a lookup convenience,
  never an identifier.
- Whatever consumes membership keys its own user records on the DID too. That
  is what makes provisioning idempotent on retry, and therefore what makes
  approval safely repeatable without a transaction.

## Authority and trust

- **Author-based verification.** Space records carry the authenticated user's
  DID as author, always — the runtime enforces it and there is no way to write
  as someone else. Mint policy governs who can create repos in a space, never
  whose name goes on records. Readers ignore any record whose author is not on
  the admin roster — asking whether the author was a **current admin at the
  time of the record**, not whether they are one now. Removing an admin ends
  their authority going forward and leaves their past grants standing; the
  only way to un-grant is a revocation record. The alternative reading makes
  membership a function of the roster's present state, so one roster edit
  silently de-members everyone that admin ever approved with nothing in the
  event log to show for it.
- **The registry space is admin-only.** Members are never space members, and
  member-facing code never reads the space directly. Members reach their own
  data through Lua procedures that read the space in-process
  (`atproto.spaces.*`, which performs no authorization of its own) and scope
  every read to `caller_did` — the script is the access boundary. Admin writes
  happen under the admin's own session; that is what author-based verification
  records.
- **Applications live in the applicant's own PDS**, as public indexed records
  picked up from the firehose — never in the registry space. A non-member
  cannot write to the space, and the record carries the bare assertion only:
  no contact details, because it is world-readable.
- **Grant and revocation rkeys are `{memberDid}:{tid}`.** Append-only means
  rkeys must be unique per event, so keying on the DID alone collides on
  re-grant. Encoding subject and time in the rkey also lets a listing resolve
  the whole roll without fetching each record.
- **The space authority is a service DID (did:plc), never a person's.**
  Authority is set at space creation and cannot be migrated. The rotation key
  can speak as the network and cannot be re-issued if lost; its custody is a
  board-level question.
- Grants and revocations are **admin-authored only**. Applications are
  **member-authored only**. Never blur these.
- **Read grants from the space, never from the index.** The grant and
  revocation lexicons are published, so HappyView's firehose indexer
  recognises those records — and anyone can publish a record of that shape to
  their own PDS. What makes a grant authoritative is that it is *in the
  registry space*, written by an admin who holds space write access. A
  consumer that resolves membership from the index instead has handed out
  self-service membership. Every reader here uses `atproto.spaces.query`;
  keep it that way, and hold future consumers to it.
- **Append-only.** Never delete a grant. Revocation is a new record in the
  revocation collection. A member is active iff there is a grant with no later
  revocation. This also means an admin who has left cannot be un-done by
  deleting their records — and nobody can quietly erase history.
- **The push is a cache update, not a second source of truth.** On grant and
  revoke the Lua POSTs `{event, did, rkey, authorDid, record}` to
  `env.CORLISS_PUSH_URL`. Those envelope fields are exactly what
  `atproto.spaces.query` returns alongside a record, so a consumer
  reconciling from the space fills the identical shape and there is no second
  schema to drift from the lexicon. Order events by the rkey's TID, never by
  `grantedAt`/`revokedAt`: those are second-resolution, so they cannot
  separate two events in one second and cannot stop a retried stale grant
  resurrecting a revoked member. The push fires *after* the space write and
  never fails the call — the record is the event, and a stale cache is the
  recoverable state.

## Secrets

- **No gateway credential lives in this repo or its runtime.** There was one —
  a LiteLLM provisioner key in the Lua script `env` — and it left along with
  the gateway integration. The registry provisions nothing, so it needs no
  credential that can act on anyone's behalf. Do not reintroduce one: a
  privileged credential here would make script-deploy access equivalent to
  gateway admin, on top of what it already means below.
- **`CORLISS_PUSH_TOKEN` is not a counter-example to that.** It authorises one
  verb — "assert a membership event" — at a consumer that treats the result as
  a cache. It mints nothing, reads nothing, and acts on no one's behalf. If it
  leaks, the blast radius is a wrong cache until reconciliation reads the
  space again, not a standing capability. That is the line: credentials that
  *act* stay out; a write-only notification token to a system we own is a
  different thing. Keep it that way — if the push endpoint ever grows a read
  side, this bullet stops being true.
- The SPA holds a **public** API client key (`hvc_`) only. No client secret.
- Any operation writing to the registry goes through a Lua procedure that
  first checks `caller_did` against the current admins in the roster record
  (`network.sharedcomputer.admin.list` in the service DID's repo, anchored by
  `env.SERVICE_DID`). Roster reads fail closed, with one exception: when no
  roster record exists yet, `env.BOOTSTRAP_ADMIN_DID` is the sole admin so
  the first roster can be written. An existing-but-empty roster still fails
  closed.
- Deployed Lua scripts can write HappyView's space tables directly (`db.raw`
  accepts INSERT on allowed tables, including space records and members).
  Script deployment — dashboard or Admin API — is therefore equivalent to
  authority over the registry. Guard that access like the master key, and
  never interpolate caller input into raw SQL.

## What is authoritative where

| Concern | Home |
|---|---|
| Identity (DID, handle, email) | atproto, brokered by Corliss |
| Admin roster | `admin.list` record in the service DID's repo |
| Membership application | the applicant's own PDS |
| Grant, revocation, tier | HappyView registry space |
| Who is currently a member | derived, never stored — see below |
| Entitlements a tier buys | outside this repo, keyed by the tier slug |
| Keys, budgets, spend, inference | outside this repo |

Nothing is stored in two places. If a value appears to need duplicating, it
belongs in one of them and the other should hold a reference.

The membership push is the one thing that looks like an exception and is not.
Current membership is *derived* — latest-event-wins over the grants and
revocations — so a consumer holding it has a cache of a computation, not a
second copy of a fact. Which is why the rule is that a consumer may serve
access decisions from that cache but must never write back to it as though it
were a source, and must be able to rebuild it from the space alone.

The grant records **one** thing about resources: the tier slug. What that slug
entitles someone to — which models, which limits — is decided by whatever
enforces it, and this repo neither knows nor asks. That boundary is the whole
point: the registry is a record of who decided what, when.

## Membership and tiers

- **Tiers are SCN-owned slugs**, `level-0` through `level-9`, defined in
  `lua/approve_member.lua` and `src/tiers.ts`. They are not sourced from any
  gateway: taking the vocabulary from whatever enforces it would rebuild the
  dependency this repo exists without.
- **A slug, not an integer.** `level-0` is the free tier and the most common
  one, and `0` is falsy in JavaScript — `if (grant.tier)` would silently drop
  exactly the members it matters most for. The slug is also the exact string a
  consumer's group must be *named*, since that match is by name, so the binding
  stays greppable instead of hidden in a format string.
- **Tier is required on a grant, enforced at write time.** A grant with no tier
  is a fail-open bug, not a harmless default: a consumer that turns it into an
  empty group claim causes Open WebUI to remove nothing, so the member silently
  keeps the tier they had. Rejecting the write is what stops every downstream
  reader having to invent a tier.
- **A tier change is a re-approval.** It writes a fresh grant and
  latest-event-wins resolves it — no record is ever edited.
- **Display names map from the slug, never replace it.**

## Rejected — do not re-propose

- **A client-only app with no privileged layer.** The Lua procedures are where
  admin authority is checked against the roster before anything is written. A
  browser that could write the registry directly would be a browser holding
  admin.
- **Sourcing the tier vocabulary from whatever enforces entitlements.** It
  would rebuild the registry-to-gateway dependency that removing the gateway
  integration exists to delete.
- **Members as registry space members.** They would gain a view of the
  membership roll and a write surface, in exchange for nothing they cannot get
  from a scoped procedure.

## Naming

- NSIDs are `network.sharedcomputer.*` — reverse-DNS from a domain we control.
- Do not publish lexicons under a namespace we might abandon.

## Forensic cleanliness

- Nothing here sees prompts or completions, and it should stay that way — the
  registry records decisions about people, not their use of the system.
- `log()` output goes to the event log and is retained. Never log anything from
  Lua that would not be safe to keep.

## Availability

- HappyView being down means: no signup, no approval, no roster change.
- It must never mean: inference stops. The inference path is
  OWUI → LiteLLM → llama-server and does not touch HappyView.
- Do not introduce a HappyView dependency into the request path.
