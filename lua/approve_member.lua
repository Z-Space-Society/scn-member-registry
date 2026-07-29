-- Procedure: network.sharedcomputer.admin.approveMember
-- Caller must be a current admin in the roster record. Provisions the
-- member in LiteLLM (idempotent: user_id is the DID), then writes the grant
-- to the registry space. The runtime records author_did = caller_did, so the
-- grant is authored by the approving admin. Re-approval writes a redundant
-- grant, which is harmless: membership is "latest event wins".
--
-- Not deployable until the registry space exists (open item 1) and the
-- LiteLLM provisioner key is set.

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
  if not env.LITELLM_BASE_URL then
    error("LITELLM_BASE_URL missing from script env")
  end
  if not env.LITELLM_PROVISIONER_KEY then
    error("LITELLM_PROVISIONER_KEY missing from script env")
  end

  -- Write access: Current admins only (entries without removedAt). Departed
  -- admins keep their history but not their authority.
  local function require_current_admin(did)
    local res = db.query{
      did = env.SERVICE_DID,
      collection = "network.sharedcomputer.admin.list",
    }
    local roster = res.records and res.records[1]
    if not roster then
      error("admin roster record not found for service DID")
    end
    for _, entry in ipairs(roster.admins or {}) do
      if entry.did == did and not entry.removedAt then
        return
      end
    end
    error("forbidden: caller is not a current admin")
  end

  require_current_admin(caller_did)

  local subject = input.did
  if type(subject) ~= "string" or string.sub(subject, 1, 4) ~= "did:" then
    error("invalid input: did")
  end

  -- Provision the LiteLLM user. user_id = DID makes this retryable: an
  -- "already exists" response is success, anything else fails loudly.
  local ok, res = pcall(http.post, env.LITELLM_BASE_URL .. "/user/new", {
    headers = {
      Authorization = "Bearer " .. env.LITELLM_PROVISIONER_KEY,
      ["Content-Type"] = "application/json",
    },
    body = json.encode({ user_id = subject }),
  })
  if not ok then
    log("approveMember: egress failure reaching LiteLLM")
    error("litellm unreachable")
  end
  if res.status ~= 200 then
    local exists = string.find(res.body or "", "already exist", 1, true)
    if not exists then
      log("approveMember: /user/new failed with status " .. tostring(res.status))
      error("litellm provisioning failed")
    end
  end

  local space = atproto.spaces.get(env.REGISTRY_SPACE_URI)
  local rkey = subject .. ":" .. tostring(TID())
  local grant = {
    status = "active",
    litellmUserId = subject,
    grantedAt = os.date("!%Y-%m-%dT%H:%M:%SZ"),
    groups = toarray(input.group and { input.group } or {}),
  }

  local wrote = space:put_record{
    collection = "network.sharedcomputer.membership.grant",
    rkey = rkey,
    record = grant,
  }

  return { ok = true, uri = wrote.uri, rkey = rkey }
end
