-- Query: network.sharedcomputer.membership.getMine
-- Returns the caller's membership state from the registry space. Members are
-- not space members; this reads the space in-process via atproto.spaces,
-- which performs no authorization of its own. This script is the access
-- boundary: it returns only the caller's own state, nothing else.

-- caller_did is nil for anonymous queries. Guard before anything else.
if not caller_did then
  error("authentication required")
end
if not env.REGISTRY_SPACE_URI then
  error("REGISTRY_SPACE_URI missing from script env")
end
if not env.SERVICE_DID then
  error("SERVICE_DID missing from script env")
end

local GRANT = "network.sharedcomputer.membership.grant"
local REVOCATION = "network.sharedcomputer.membership.revocation"

-- Every DID ever listed as an admin, from the roster record in the service
-- DID's repo (indexed, so db.query sees it). Grants by departed admins stay
-- valid; write authority ends with space membership, not with this filter.
-- Fails closed on a missing or empty roster.
local function admin_set()
  local res = db.query{
    did = env.SERVICE_DID,
    collection = "network.sharedcomputer.admin.list",
  }
  local roster = res.records and res.records[1]
  if not roster then
    error("admin roster record not found for service DID")
  end
  local set = {}
  local count = 0
  for _, entry in ipairs(roster.admins or {}) do
    set[entry.did] = true
    count = count + 1
  end
  if count == 0 then
    error("admin roster is empty")
  end
  return set
end

local admins = admin_set()
local prefix = caller_did .. ":"

-- Latest event wins. TIDs compare lexicographically, and rkeys are
-- `{did}:{tid}`, so the caller's events match on rkey prefix alone.
local function latest(collection)
  local best = nil
  local cursor = nil
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
        if not best or tid > best.tid then
          best = { tid = tid, record = rec.record, author = rec.authorDid }
        end
      end
    end
    cursor = page.cursor
  until not cursor
  return best
end

local grant = latest(GRANT)
if not grant then
  return { active = false }
end

local revocation = latest(REVOCATION)
if revocation and revocation.tid >= grant.tid then
  return { active = false }
end

return {
  active = true,
  grantedBy = grant.author,
  grant = grant.record,
}
