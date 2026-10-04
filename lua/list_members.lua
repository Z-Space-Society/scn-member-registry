-- Query: network.sharedcomputer.membership.listMembers
-- Everyone ever granted membership, and whether they are a member now.
-- Callable by a current admin, or by a service holding a MEMBERS_TOKEN_* token.

local GRANT = "network.sharedcomputer.membership.grant"
local REVOCATION = "network.sharedcomputer.membership.revocation"
local ADMIN_LIST = "network.sharedcomputer.admin.list"
local MIN_TOKEN_LENGTH = 32

function handle()
  if not env.REGISTRY_SPACE_URI then
    error("REGISTRY_SPACE_URI missing from script env")
  end
  if not env.SERVICE_DID then
    error("SERVICE_DID missing from script env")
  end

  -- Error out when there are no admins to check grants against. An empty list
  -- would tell consumers that every member was revoked.
  local res = db.query{ did = env.SERVICE_DID, collection = ADMIN_LIST }
  local roster = res.records and res.records[1]
  if not roster and not env.BOOTSTRAP_ADMIN_DID then
    error("no admin roster record and no BOOTSTRAP_ADMIN_DID")
  end
  if roster and #(roster.admins or {}) == 0 then
    error("admin roster is empty")
  end

  -- Constant-time, so response timing doesn't leak the token.
  local function token_matches(presented, expected)
    if type(presented) ~= "string" or #presented ~= #expected then
      return false
    end
    local diff = 0
    for i = 1, #expected do
      if string.byte(presented, i) ~= string.byte(expected, i) then
        diff = diff + 1
      end
    end
    return diff == 0
  end

  -- Any MEMBERS_TOKEN_* script variable is a valid token. Short values are
  -- ignored so a blank or test value can't match.
  local function is_service_token(presented)
    local matched = false
    for key, value in pairs(env) do
      if string.sub(key, 1, 14) == "MEMBERS_TOKEN_"
        and type(value) == "string" and #value >= MIN_TOKEN_LENGTH
        and token_matches(presented, value) then
        matched = true
      end
    end
    return matched
  end

  local function is_current_admin(did)
    if not roster then
      return did == env.BOOTSTRAP_ADMIN_DID
    end
    for _, entry in ipairs(roster.admins) do
      if entry.did == did and not entry.removedAt then
        return true
      end
    end
    return false
  end

  if params.token ~= nil then
    if not is_service_token(params.token) then
      error("forbidden: invalid service token")
    end
  elseif not caller_did then
    error("authentication required")
  elseif not is_current_admin(caller_did) then
    error("forbidden: caller is not a current admin")
  end

  -- A UTC timestamp trimmed to the second, so timestamps compare as strings.
  local function utc(value)
    if type(value) ~= "string" then
      return nil
    end
    local second, rest = string.match(value, "^(%d%d%d%d%-%d%d%-%d%dT%d%d:%d%d:%d%d)(.*)$")
    if second and (string.match(rest, "^[%.%d]*Z$") or string.match(rest, "^[%.%d]*%+00:00$")) then
      return second
    end
    return nil
  end

  -- Was the author an admin when they wrote the event?
  local function was_admin_at(did, when)
    if not when then
      return false
    end
    if not roster then
      return did == env.BOOTSTRAP_ADMIN_DID
    end
    for _, entry in ipairs(roster.admins) do
      local added = utc(entry.addedAt)
      local removed = utc(entry.removedAt)
      if entry.did == did and added and added <= when
        and (entry.removedAt == nil or (removed and when < removed)) then
        return true
      end
    end
    return false
  end

  -- Each DID's latest event by an admin. Check authority before picking the
  -- latest, or a forged later event could hide a real one.
  local function latest(collection, time_field)
    local out, cursor = {}, nil
    repeat
      local page = atproto.spaces.query{
        space_uri = env.REGISTRY_SPACE_URI,
        collection = collection,
        limit = 100,
        cursor = cursor,
      }
      for _, rec in ipairs(page.records or {}) do
        local record = rec.record or {}
        local did, tid = string.match(rec.rkey or "", "^(.+):([2-7a-z]+)$")
        if did and #tid == 13 and was_admin_at(rec.authorDid, utc(record[time_field])) then
          if not out[did] or tid > out[did].tid then
            out[did] = { tid = tid, record = record }
          end
        end
      end
      cursor = page.cursor
    until not cursor
    return out
  end

  local grants = latest(GRANT, "grantedAt")
  local revocations = latest(REVOCATION, "revokedAt")
  local active_only = params.activeOnly == true or params.activeOnly == "true"

  local dids = {}
  for did in pairs(grants) do
    dids[#dids + 1] = did
  end
  table.sort(dids)

  local members = {}
  for _, did in ipairs(dids) do
    local grant, revocation = grants[did], revocations[did]
    -- A revocation in the same TID as the grant revokes it.
    local active = not revocation or revocation.tid < grant.tid
    if active or not active_only then
      members[#members + 1] = {
        did = did,
        active = active,
        tier = grant.record.tier,
        grantedAt = grant.record.grantedAt,
        revokedAt = not active and revocation.record.revokedAt or nil,
      }
    end
  end

  return { members = toarray(members) }
end
