# CLAUDE.md — architecture invariants

Living document. These are constraints that should not drift. If a change
appears to require breaking one of these, stop and raise it rather than
working around it.

## Identity

- **DID is the join key, everywhere, forever.** HappyView `caller_did`,
  LiteLLM `user_id`, record rkeys. Never key on handle or email.
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
- LiteLLM `user_id` **is** the member's DID. This is deliberate: it makes
  `/user/new` idempotent on retry, which is what makes approval safely
  repeatable without a transaction.
- Handle and email are pushed onto the LiteLLM user (`user_alias`,
  `user_email`) on every login, never stored here. atproto is authoritative;
  the copy in LiteLLM is a display and notification convenience that
  self-heals when either value changes upstream.

## Authority and trust

- **Author-based verification.** Space records carry the authenticated user's
  DID as author, always — the runtime enforces it and there is no way to write
  as someone else. Mint policy governs who can create repos in a space, never
  whose name goes on records. Readers ignore any record whose author is not on
  the admin roster.
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
- **Append-only.** Never delete a grant. Revocation is a new record in the
  revocation collection. A member is active iff there is a grant with no later
  revocation. This also means an admin who has left cannot be un-done by
  deleting their records — and nobody can quietly erase history.

## Secrets

- The gateway admin credential exists in exactly one place: HappyView Lua
  script `env` variables. Never in browser code, never in a record, never in a
  lexicon.
- That credential is a **revocable provisioner key** — a virtual key owned by
  a `proxy_admin` service user — not the LiteLLM master key. The master key
  stays offline as break-glass, so a compromised runtime costs one revocation
  rather than a proxy-wide rotation.
- The SPA holds a **public** API client key (`hvc_`) only. No client secret.
- Any operation requiring the provisioner key goes through a Lua procedure that
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
| Identity (DID, handle, email) | atproto / Rauthy |
| Admin roster | `admin.list` record in the service DID's repo |
| Membership application | the applicant's own PDS |
| Grant, revocation | HappyView registry space |
| Tier definitions (models, limits) | LiteLLM teams |
| Keys, budgets, spend counters | LiteLLM |
| Inference | llama-server behind LiteLLM |

Nothing is stored in two places. If a value appears to need duplicating,
it belongs in one of them and the other should hold a reference. A grant
records the team alias as it read at approval time for display, but LiteLLM
holds the authoritative team membership.

## Membership and tiers

- **Tiers are LiteLLM teams.** An admin picks one at approval; model access
  and per-member limits live on the team, so changing a tier is a LiteLLM-side
  change and nothing here moves.
- **Budgets belong to the LiteLLM user, not the key.** Members can issue their
  own keys, so a cap on a key would be no cap at all.
- **Approval mints no key.** A key's plaintext is returned once and would be
  unrecoverable, so an auto-created key is a row the member can never use.
  Members issue their own from the dashboard, where the secret appears once in
  their own browser and never passes through an admin.

## Rejected — do not re-propose

- **A client-only app with no privileged layer.** `/key/generate` accepts
  `user_id`, `models`, and `max_budget`; a browser holding a credential that
  can call it is a browser holding proxy admin. The Lua procedures are the
  privileged layer, and LiteLLM is the one leg that requires them.
- **Members as registry space members.** They would gain a view of the
  membership roll and a write surface, in exchange for nothing they cannot get
  from a scoped procedure.

## Naming

- NSIDs are `network.sharedcomputer.*` — reverse-DNS from a domain we control.
- Do not publish lexicons under a namespace we might abandon.

## Forensic cleanliness

- `turn_off_message_logging` and `disable_spend_logs` stay on. Member usage
  views read the daily aggregate tables, not request logs.
- LiteLLM UI settings override config file values at runtime with no restart.
  `store_prompts_in_spend_logs` must be asserted false periodically, not just
  set once in config.
- Never log prompt or completion content from Lua. `log()` output goes to the
  event log and is retained.

## Availability

- HappyView being down means: no signup, no approval, no usage view.
- It must never mean: inference stops. The inference path is
  OWUI → LiteLLM → llama-server and does not touch HappyView.
- Do not introduce a HappyView dependency into the request path.
