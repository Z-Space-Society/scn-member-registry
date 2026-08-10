-- Procedure: network.sharedcomputer.admin.approveMember
-- Caller must be a current admin in the roster record. Provisions the member
-- in LiteLLM (idempotent: user_id is the DID), then writes the grant to the
-- registry space. The runtime records author_did = caller_did, so the grant
-- is authored by the approving admin. Re-approval writes a redundant grant,
-- which is harmless: membership is "latest event wins".
--
-- Requires the Lua spaces write API (atproto.spaces.get / put_record);
-- HappyView versions without it fail here with "attempt to call a nil
-- value (field 'get')".

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

  -- Validate the DID structure. It becomes a LiteLLM user_id and part of
  -- a space record rkey.
  local subject = input.did
  if type(subject) ~= "string"
    or #subject > 512
    or not string.find(subject, "^did:[a-z]+:[%w%._:%%%-]+$")
  then
    error("invalid input: did")
  end

  -- Same shape check syncProfile applies, so an admin cannot push junk into
  -- the gateway's notification field.
  local email = nil
  if input.email ~= nil and input.email ~= "" then
    if type(input.email) ~= "string"
      or #input.email > 320
      or string.find(input.email, "%s")
      or not string.find(input.email, "^[^@]+@[^@]+%.[^@]+$")
    then
      error("invalid input: email")
    end
    email = input.email
  end

  local team_id = nil
  if input.teamId ~= nil and input.teamId ~= "" then
    if type(input.teamId) ~= "string" or #input.teamId > 128 then
      error("invalid input: teamId")
    end
    team_id = input.teamId
  end

  local team_label = nil
  if input.teamLabel ~= nil and input.teamLabel ~= "" then
    if type(input.teamLabel) ~= "string" or #input.teamLabel > 200 then
      error("invalid input: teamLabel")
    end
    team_label = input.teamLabel
  end

  local function gateway(path, payload)
    local ok, res = pcall(http.post, env.LITELLM_BASE_URL .. path, {
      headers = {
        Authorization = "Bearer " .. env.LITELLM_PROVISIONER_KEY,
        ["Content-Type"] = "application/json",
      },
      body = json.encode(payload),
    })
    if not ok then
      log("approveMember: egress failure reaching LiteLLM")
      error("litellm unreachable")
    end
    return res
  end

  -- Provision the LiteLLM user. user_id = DID. an "already exists"
  -- response is success, anything else fails.
  local new_user = { user_id = subject, auto_create_key = false }
  if email then
    new_user.user_email = email
  end

  local res = gateway("/user/new", new_user)
  if res.status ~= 200 then
    local exists = string.find(res.body or "", "already exist", 1, true)
    if not exists then
      log("approveMember: /user/new failed with status " .. tostring(res.status)
        .. ": " .. string.sub(res.body or "", 1, 200))
      error("litellm provisioning failed")
    end
  end

  if team_id then
    -- Drop any other team first, then add to the requested team.
    local info_ok, info_res = pcall(http.get,
      env.LITELLM_BASE_URL .. "/user/info?user_id=" .. subject, {
        headers = { Authorization = "Bearer " .. env.LITELLM_PROVISIONER_KEY },
      })
    if info_ok and info_res.status == 200 then
      local info = json.decode(info_res.body)
      local user = info.user_info or info
      for _, existing in ipairs(user.teams or {}) do
        if existing ~= team_id then
          local left = gateway("/team/member_delete", {
            team_id = existing,
            user_id = subject,
          })
          if left.status ~= 200
            and not string.find(left.body or "", "not found", 1, true)
          then
            log("approveMember: /team/member_delete returned status "
              .. tostring(left.status) .. ": "
              .. string.sub(left.body or "", 1, 200))
            error("could not move member off their previous team")
          end
        end
      end
    end

    local member = { user_id = subject, role = "user" }
    if email then
      member.user_email = email
    end
    local team_res = gateway("/team/member_add", {
      team_id = team_id,
      member = member,
    })
    if team_res.status ~= 200 then
      local already = string.find(team_res.body or "", "already", 1, true)
      if not already then
        -- Include the gateway's reason.
        log("approveMember: /team/member_add failed with status "
          .. tostring(team_res.status) .. ": "
          .. string.sub(team_res.body or "", 1, 200))
        error("litellm team assignment failed")
      end
    end
  end

  local space = atproto.spaces.get(env.REGISTRY_SPACE_URI)
  local rkey = subject .. ":" .. tostring(TID())
  -- `groups` records the tier as it was named at approval time; LiteLLM
  -- is the source of truth for team membership.
  local grant = {
    status = "active",
    litellmUserId = subject,
    grantedAt = os.date("!%Y-%m-%dT%H:%M:%SZ"),
    groups = toarray(team_label and { team_label } or {}),
  }
  if team_id then
    grant.litellmTeamId = team_id
  end

  local wrote = space:put_record{
    collection = "network.sharedcomputer.membership.grant",
    rkey = rkey,
    record = grant,
  }

  return { ok = true, uri = wrote.uri, rkey = rkey }
end
