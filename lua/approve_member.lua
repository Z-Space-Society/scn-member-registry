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

  -- Push the event to Corliss, which caches membership to resolve access at
  -- login. Best-effort by design, on two counts. Unset env means no consumer
  -- is wired up yet, which is a normal state, not an error. And a push that
  -- fails is logged rather than raised: the space record *is* the membership
  -- event, and Corliss holds a cache of it. A stale cache is repairable by
  -- reconciliation; a grant that errored back to the admin after already
  -- being written to the space is not repairable from here.
  local function notify_corliss(payload)
    if not env.CORLISS_PUSH_URL or not env.CORLISS_PUSH_TOKEN then
      return
    end
    local ok, res = pcall(http.post, env.CORLISS_PUSH_URL, {
      headers = {
        Authorization = "Bearer " .. env.CORLISS_PUSH_TOKEN,
        ["Content-Type"] = "application/json",
      },
      body = json.encode(payload),
    })
    if not ok then
      log("membership push: egress failure reaching Corliss")
    elseif res.status < 200 or res.status >= 300 then
      log("membership push: status " .. tostring(res.status) .. ": "
        .. string.sub(res.body or "", 1, 200))
    end
  end

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

  -- The envelope carries exactly the space metadata a reader gets alongside
  -- the record from atproto.spaces.query — did, rkey, authorDid — wrapped
  -- around the record verbatim. So reconciliation reading the space fills the
  -- identical shape, and there is no second schema to keep in step with the
  -- lexicon. The rkey's TID is the ordering key: grantedAt is only
  -- second-resolution, so it cannot distinguish two events in the same second
  -- and cannot stop a retried stale grant resurrecting a revoked member.
  notify_corliss{
    event = "grant",
    did = subject,
    rkey = rkey,
    authorDid = caller_did,
    record = grant,
  }

  return { ok = true, uri = wrote.uri, rkey = rkey }
end
