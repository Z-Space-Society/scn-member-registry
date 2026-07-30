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

## Authority and trust

- **Author-based verification.** Space records carry the authenticated user's
  DID as author, always. Mint policy governs who can create repos in a space,
  never whose name goes on records. Readers filter `listRecords` by `repo` to
  the admin DID list and never read anything else.
- **The registry space is admin-only.** Members are never space members, and
  member-facing code never reads the space directly. Members reach their own
  data through Lua procedures that hold a space credential and scope by
  `caller_did`. Admin writes are direct space writes under the admin's own
  session; that is what author-based verification records.
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

- The LiteLLM master key exists in exactly one place: HappyView Lua script
  `env` variables. Never in browser code, never in a record, never in a
  lexicon.
- The SPA holds a **public** API client key (`hvc_`) only. No client secret.
- Any operation requiring the master key goes through a Lua procedure that
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
| Application, grant, revocation | HappyView registry space |
| Group definitions (tier to LiteLLM group mapping) | HappyView registry space |
| Keys, budgets, spend counters | LiteLLM |
| Inference | llama-server behind LiteLLM |

Nothing is stored in two places. If a value appears to need duplicating,
it belongs in one of them and the other should hold a reference.

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
