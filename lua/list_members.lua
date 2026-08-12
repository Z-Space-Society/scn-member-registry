-- Query: network.sharedcomputer.membership.listMembers
-- Returns grant and revocation events so the caller can resolve current
-- membership. Admin-only: the membership roll is not member-visible.
-- Only rkeys and author DIDs are returned; the caller filters authors
-- against the roster and applies latest-event-wins.

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

  -- Read access: current admins only. Fails closed, except before the first
  -- roster exists, when BOOTSTRAP_ADMIN_DID is the sole admin.
  local function require_current_admin(did)
    local res = db.query{
      did = env.SERVICE_DID,
      collection = "network.sharedcomputer.admin.list",
    }
    local roster = res.records and res.records[1]
    if not roster then
      if env.BOOTSTRAP_ADMIN_DID and did == env.BOOTSTRAP_ADMIN_DID then
        return
      end
      error("no admin roster record and caller is not BOOTSTRAP_ADMIN_DID")
    end
    for _, entry in ipairs(roster.admins or {}) do
      if entry.did == did and not entry.removedAt then
        return
      end
    end
    error("forbidden: caller is not a current admin")
  end

  require_current_admin(caller_did)

  local function collect(collection)
    local out = {}
    local cursor = nil
    repeat
      local page = atproto.spaces.query{
        space_uri = env.REGISTRY_SPACE_URI,
        collection = collection,
        limit = 100,
        cursor = cursor,
      }
      for _, rec in ipairs(page.records or {}) do
        -- The record verbatim, wrapped in the space metadata that arrives
        -- alongside it. This is the same envelope approve_member pushes to
        -- Corliss, minus `did` — which is not a field of the record, only the
        -- leading half of the rkey, so a consumer splits it back out on the
        -- last colon rather than trusting a copy.
        --
        -- Deliberately not projected down to the fields this repo's SPA
        -- happens to render: that dropped grantedAt/revokedAt, which a
        -- consumer reconciling its own cache from here needs, and it meant the
        -- push and the read returned two different shapes for one lexicon.
        out[#out + 1] = {
          rkey = rec.rkey,
          authorDid = rec.authorDid,
          record = rec.record or {},
        }
      end
      cursor = page.cursor
    until not cursor
    return out
  end

  return {
    grants = toarray(collect("network.sharedcomputer.membership.grant")),
    revocations = toarray(collect("network.sharedcomputer.membership.revocation")),
  }
end
