-- Query: network.sharedcomputer.membership.getMine
-- Return the caller's membership state from the registry space.

function handle()
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
  -- DID's repo. Grants by departed admins stay valid; write authority ends
  -- with space membership, not with this filter. When no roster record
  -- exists yet, env.BOOTSTRAP_ADMIN_DID is the sole admin so the first
  -- roster can be written. An existing-but-empty roster is a
  -- misconfiguration and fails closed.
  local function admin_set()
    local res = db.query{
      did = env.SERVICE_DID,
      collection = "network.sharedcomputer.admin.list",
    }
    local roster = res.records and res.records[1]
    if not roster then
      if env.BOOTSTRAP_ADMIN_DID then
        return { [env.BOOTSTRAP_ADMIN_DID] = true }
      end
      error("no admin roster record and no BOOTSTRAP_ADMIN_DID")
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
end
