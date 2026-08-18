-- Procedure: network.sharedcomputer.membership.syncMembers
-- Every grant and revocation in the registry space, for a service rebuilding
-- its own membership cache. Same output as list_members.lua; the difference is
-- entirely in who may call it.
--
-- Why this is a second door rather than a wider list_members: the consumer that
-- needs it runs at boot, with nobody signed in, so it cannot present a
-- current-admin caller_did. A shared token is the only thing available. Keeping
-- the two doors separate means the human-auth read and the service read carry
-- different credentials, revocable independently, and the SPA's endpoint is not
-- touched by any of this.
--
-- READ-ONLY, and it must stay that way. Everything that writes to the registry
-- checks caller_did against the current admins; if this token ever gained a
-- write path it would be equivalent to admin authority over membership, which
-- is exactly what the roster check exists to prevent.

function handle()
  if not env.REGISTRY_SPACE_URI then
    error("REGISTRY_SPACE_URI missing from script env")
  end

  -- Fails closed when unconfigured. Comparing an unset env var against an
  -- unset input would succeed and leave the member roll readable by anyone,
  -- so absence is refused before anything is compared.
  if not env.RECONCILE_TOKEN or env.RECONCILE_TOKEN == "" then
    error("syncMembers is not configured: RECONCILE_TOKEN is unset")
  end

  -- Compared without short-circuiting on the first differing byte. The token
  -- is high-entropy so a timing oracle is a stretch, but the cost of not
  -- leaking one is a five-line loop.
  local function token_matches(presented, expected)
    if type(presented) ~= "string" then
      return false
    end
    if #presented ~= #expected then
      return false
    end
    -- Counted rather than bitwise-OR'd: `|` and `~` are Lua 5.3+, and this
    -- has no reason to care which version the runtime is.
    local diff = 0
    for i = 1, #expected do
      if string.byte(presented, i) ~= string.byte(expected, i) then
        diff = diff + 1
      end
    end
    return diff == 0
  end

  if not token_matches(input.token, env.RECONCILE_TOKEN) then
    error("forbidden: invalid service token")
  end

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
        -- alongside it — identical to list_members.lua and to the envelope
        -- approve_member pushes, minus `did`, which is not a field of the
        -- record but the leading half of the rkey. One lexicon, one shape,
        -- however a consumer happens to have reached it.
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
