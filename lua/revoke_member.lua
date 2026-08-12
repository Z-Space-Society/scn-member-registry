-- Procedure: network.sharedcomputer.admin.revokeMember
-- Caller must be a current admin in the roster record. Writes a revocation
-- to the registry space, authored by the calling admin.
--
-- Revocation is a *registry* event only. Nothing here reaches a gateway:
-- cutting off inference access is the job of whatever consumes membership
-- (see the push wiring), and keeping it out of here is what lets the registry
-- stay a pure record of who decided what, when.

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

  -- See approve_member.lua for why this is best-effort and why it fires after
  -- the space write. Revocation is the direction where a dropped push matters
  -- most — it leaves Corliss believing a removed member is still active — so
  -- reconciliation is what closes this, not a retry here.
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

  local subject = input.did
  if type(subject) ~= "string"
    or #subject > 512
    or not string.find(subject, "^did:[a-z]+:[%w%._:%%%-]+$")
  then
    error("invalid input: did")
  end

  local reason = nil
  if input.reason ~= nil and input.reason ~= "" then
    if type(input.reason) ~= "string" or #input.reason > 300 then
      error("invalid input: reason")
    end
    reason = input.reason
  end

  local space = atproto.spaces.get(env.REGISTRY_SPACE_URI)
  local rkey = subject .. ":" .. tostring(TID())
  local revocation = {
    revokedAt = os.date("!%Y-%m-%dT%H:%M:%SZ"),
  }
  if reason then
    revocation.reason = reason
  end

  local wrote = space:put_record{
    collection = "network.sharedcomputer.membership.revocation",
    rkey = rkey,
    record = revocation,
  }

  notify_corliss{
    event = "revoke",
    did = subject,
    rkey = rkey,
    authorDid = caller_did,
    record = revocation,
  }

  return { ok = true, uri = wrote.uri, rkey = rkey }
end
