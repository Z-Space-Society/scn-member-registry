-- Prepended to every deployed script by scripts/deploy.mjs.
--
-- HappyView deploys each script as one standalone body with no module system,
-- so shared helpers have to be concatenated in. Purely additive: the eight
-- cluster scripts keep their own inline helpers and simply never call these,
-- which is what makes adopting the prelude a no-op for anything in production.
--
-- Globals rather than locals, because a `local` at the top of the prelude would
-- not be visible to the script body appended after it.

WORKSPACE_TYPE = "network.sharedcomputer.workspace"

GRANT_COLLECTION = "network.sharedcomputer.membership.grant"
REVOCATION_COLLECTION = "network.sharedcomputer.membership.revocation"
ADMIN_LIST_COLLECTION = "network.sharedcomputer.admin.list"

--- Validate a DID's structure. Same expression approve_member.lua uses, kept
--- identical on purpose: a DID that is acceptable to one script and not another
--- is a bug that only shows up at the seam between them.
function require_did(did)
  if type(did) ~= "string"
    or #did > 512
    or not string.find(did, "^did:[a-z]+:[%w%._:%%%-]+$")
  then
    error("invalid input: did")
  end
  return did
end

--- Parse and validate a Workspace space URI, returning its parts.
---
--- Every workspace script takes its space from the caller, and this is the
--- guard that makes that safe: it refuses any URI whose type component is not
--- WORKSPACE_TYPE, so these scripts structurally cannot be pointed at the
--- registry space. The runtime would refuse the write anyway — the registry
--- space's authority is the service DID — but a caller should never get that
--- far, and defence in depth here costs one line.
---
--- Matches on the type component rather than the scheme: HappyView supports
--- both at:// and ats:// while the spec settles, so pinning the scheme would
--- break the day upstream picks one.
---
--- The authority DID is the URI's first component. That is worth knowing
--- because it is not readable off a space handle, and it is what gives us
--- `isCreator` and a decent "only the creator can do this" message for free.
function require_workspace_uri(uri)
  if type(uri) ~= "string" or #uri > 1024 then
    error("invalid input: workspace")
  end
  local authority, type_nsid, skey =
    string.match(uri, "^ats?://([^/]+)/space/([^/]+)/([^/]+)$")
  if not authority or type_nsid ~= WORKSPACE_TYPE then
    error("invalid input: not a workspace uri")
  end
  return { uri = uri, authority = authority, id = skey }
end

--- Compose a space URI from its parts. There is no `uri` column in
--- happyview_spaces — a URI is a projection of (authority_did, type_nsid,
--- skey) — so composing it is how the storage actually works, not a shortcut.
function workspace_uri(authority, id)
  return "at://" .. authority .. "/space/" .. WORKSPACE_TYPE .. "/" .. id
end

--- Every DID ever listed as an admin, from the roster record in the service
--- DID's repo. Ever-admins rather than current admins: a grant written by an
--- admin who has since left stays valid, because removing an admin ends their
--- authority going forward and must not un-write what they already approved.
function ever_admins()
  if not env.SERVICE_DID then
    error("SERVICE_DID missing from script env")
  end
  local res = db.query{
    did = env.SERVICE_DID,
    collection = ADMIN_LIST_COLLECTION,
  }
  local roster = res.records and res.records[1]
  if not roster then
    if env.BOOTSTRAP_ADMIN_DID then
      return { [env.BOOTSTRAP_ADMIN_DID] = true }
    end
    error("no admin roster record and no BOOTSTRAP_ADMIN_DID")
  end
  local set, count = {}, 0
  for _, entry in ipairs(roster.admins or {}) do
    set[entry.did] = true
    count = count + 1
  end
  if count == 0 then
    -- An existing-but-empty roster fails closed. The BOOTSTRAP_ADMIN_DID
    -- escape covers an *absent* record only.
    error("admin roster is empty")
  end
  return set
end

--- is_member(did, cluster).
---
--- NOT `atproto.spaces.is_member` on the registry space. Cluster members are
--- deliberately not registry-space members — that space's member list is the
--- admins — so cluster membership is latest-event-wins over the grant and
--- revocation log, exactly as get_my_membership.lua resolves it for the caller.
---
--- This is the outer gate: a Workspace member must be a cluster member. The two
--- senses of "membership" answer to one name and two mechanisms, and that is
--- worth remembering rather than smoothing over.
function is_cluster_member(did)
  if not env.REGISTRY_SPACE_URI then
    error("REGISTRY_SPACE_URI missing from script env")
  end

  local admins = ever_admins()
  local prefix = did .. ":"

  -- TIDs compare lexicographically and rkeys are `{did}:{tid}`, so the
  -- subject's events match on rkey prefix alone and the latest is a max.
  local function latest_tid(collection)
    local best, cursor = nil, nil
    repeat
      local page = atproto.spaces.query{
        space_uri = env.REGISTRY_SPACE_URI,
        collection = collection,
        limit = 100,
        cursor = cursor,
      }
      for _, rec in ipairs(page.records or {}) do
        if admins[rec.authorDid]
          and string.sub(rec.rkey, 1, #prefix) == prefix then
          local tid = string.sub(rec.rkey, #prefix + 1)
          if not best or tid > best then best = tid end
        end
      end
      cursor = page.cursor
    until not cursor
    return best
  end

  local grant = latest_tid(GRANT_COLLECTION)
  if not grant then return false end

  local revocation = latest_tid(REVOCATION_COLLECTION)
  -- `>=` not `>`: a revocation in the same TID as a grant revokes. Ordering by
  -- the rkey's TID rather than by grantedAt/revokedAt is what stops a retried
  -- stale grant resurrecting a revoked member.
  if revocation and revocation >= grant then return false end

  return true
end

--- The caller's effective access to a space, resolving delegations, or nil.
---
--- `get_access` is module-level and positional — there is no `space:get_access`
--- method, though `space:is_member(did)` does exist. It returns the access
--- level rather than a bool, which is `is_member(did, resource) -> access|none`
--- as the protocol shapes it, so prefer it wherever the level might matter.
function space_access(uri, did)
  return atproto.spaces.get_access(uri, did)
end
