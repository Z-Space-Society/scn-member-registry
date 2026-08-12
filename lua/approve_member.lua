-- Procedure: network.sharedcomputer.admin.approveMember
-- Caller must be a current admin in the roster record. Writes the grant to
-- the registry space. The runtime records author_did = caller_did, so the
-- grant is authored by the approving admin. Re-approval writes a redundant
-- grant, which is harmless: membership is "latest event wins" — and it is
-- also how a tier change is recorded.
--
-- Requires the Lua spaces write API (atproto.spaces.get / put_record);
-- HappyView versions without it fail here with "attempt to call a nil
-- value (field 'get')".

-- The tier vocabulary. SCN owns these slugs; they are not sourced from any
-- gateway. The string recorded here is the one an Open WebUI group must be
-- named, so it stays greppable across systems.
local TIERS = {
  ["level-0"] = true, ["level-1"] = true, ["level-2"] = true,
  ["level-3"] = true, ["level-4"] = true, ["level-5"] = true,
  ["level-6"] = true, ["level-7"] = true, ["level-8"] = true,
  ["level-9"] = true,
}

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

  -- Write access: Current admins only (entries without removedAt). Departed
  -- admins keep their history but not their authority. When no roster record
  -- exists yet, env.BOOTSTRAP_ADMIN_DID is the sole admin.
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

  -- Validate the DID structure. It becomes part of a space record rkey.
  local subject = input.did
  if type(subject) ~= "string"
    or #subject > 512
    or not string.find(subject, "^did:[a-z]+:[%w%._:%%%-]+$")
  then
    error("invalid input: did")
  end

  -- Tier is required, and enforced *here* rather than left to the caller.
  -- An absent tier is a fail-open bug, not a harmless default: a consumer
  -- that turns it into an empty group claim makes Open WebUI remove nothing,
  -- so the member silently keeps whatever tier they had. Rejecting the write
  -- is what stops every downstream reader having to invent a tier.
  local tier = input.tier
  if type(tier) ~= "string" or not TIERS[tier] then
    error("invalid input: tier")
  end

  local space = atproto.spaces.get(env.REGISTRY_SPACE_URI)
  local rkey = subject .. ":" .. tostring(TID())
  local grant = {
    status = "active",
    grantedAt = os.date("!%Y-%m-%dT%H:%M:%SZ"),
    tier = tier,
  }

  local wrote = space:put_record{
    collection = "network.sharedcomputer.membership.grant",
    rkey = rkey,
    record = grant,
  }

  return { ok = true, uri = wrote.uri, rkey = rkey }
end
