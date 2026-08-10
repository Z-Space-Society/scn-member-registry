-- Procedure: network.sharedcomputer.admin.revokeMember
-- Gateway access is cut off first, then the revocation record is written:
-- if the second half fails, the member has already lost access and a
-- retry only needs to finish the paperwork.


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

  local function escape(s)
    return (string.gsub(s, "[^%w%-%.%_%~%:]", function(c)
      return string.format("%%%02X", string.byte(c))
    end))
  end

  local function gateway(path, payload)
    local sent, response = pcall(http.post, env.LITELLM_BASE_URL .. path, {
      headers = {
        Authorization = "Bearer " .. env.LITELLM_PROVISIONER_KEY,
        ["Content-Type"] = "application/json",
      },
      body = json.encode(payload),
    })
    if not sent then
      log("revokeMember: egress failure reaching LiteLLM")
      error("litellm unreachable")
    end
    return response
  end

  -- Delete the member's keys. Without this they keep calling the gateway
  -- with credentials issued before the revocation.
  local list_ok, list_res = pcall(http.get,
    env.LITELLM_BASE_URL
      .. "/key/list?return_full_object=true&size=100&user_id="
      .. escape(subject), {
      headers = { Authorization = "Bearer " .. env.LITELLM_PROVISIONER_KEY },
    })
  if not list_ok or list_res.status ~= 200 then
    log("revokeMember: could not list member keys")
    error("litellm unreachable")
  end

  local tokens = {}
  for _, k in ipairs(json.decode(list_res.body).keys or {}) do
    if type(k) == "table" and k.user_id == subject and k.token then
      tokens[#tokens + 1] = k.token
    end
  end
  if #tokens > 0 then
    local del = gateway("/key/delete", { keys = toarray(tokens) })
    if del.status ~= 200 then
      log("revokeMember: /key/delete returned status " .. tostring(del.status)
        .. ": " .. string.sub(del.body or "", 1, 200))
      error("could not revoke member keys")
    end
  end

  -- Remove them from their team so tier model access goes too.
  local info_ok, info_res = pcall(http.get,
    env.LITELLM_BASE_URL .. "/user/info?user_id=" .. escape(subject), {
      headers = { Authorization = "Bearer " .. env.LITELLM_PROVISIONER_KEY },
    })
  if info_ok and info_res.status == 200 then
    local info = json.decode(info_res.body)
    local user = info.user_info or info
    for _, team_id in ipairs(user.teams or {}) do
      local removed = gateway("/team/member_delete", {
        team_id = team_id,
        user_id = subject,
      })
      if removed.status ~= 200
        and not string.find(removed.body or "", "not found", 1, true)
      then
        log("revokeMember: /team/member_delete returned status "
          .. tostring(removed.status) .. ": "
          .. string.sub(removed.body or "", 1, 200))
        error("could not remove member from team")
      end
    end
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

  return { ok = true, uri = wrote.uri, rkey = rkey, keysRevoked = #tokens }
end
