-- Procedure: network.sharedcomputer.membership.issueKey
-- Issues a gateway key for the caller.
--
-- LiteLLM has no per-user key limit, so we set our own cap below.

local DEFAULT_MAX_KEYS = 5

function handle()
  if not caller_did then
    error("authentication required")
  end
  if not env.LITELLM_BASE_URL then
    error("LITELLM_BASE_URL missing from script env")
  end
  if not env.LITELLM_PROVISIONER_KEY then
    error("LITELLM_PROVISIONER_KEY missing from script env")
  end

  local label = input.label
  if type(label) ~= "string"
    or #label < 1
    or #label > 64
    or not string.find(label, "^[%w][%w %._%-]*$")
  then
    error("invalid input: label")
  end

  local ok, res = pcall(xrpc.query, "network.sharedcomputer.membership.getMine")
  if not ok or res.status ~= 200 then
    log("issueKey: membership check failed for caller")
    error("could not verify membership")
  end
  local membership = json.decode(res.body)
  if not membership.active then
    error("forbidden: not an active member")
  end

  local function escape(s)
    return (string.gsub(s, "[^%w%-%.%_%~%:]", function(c)
      return string.format("%%%02X", string.byte(c))
    end))
  end

  local max_keys = tonumber(env.MAX_KEYS_PER_MEMBER) or DEFAULT_MAX_KEYS
  local list_ok, list_res = pcall(http.get,
    env.LITELLM_BASE_URL
      .. "/key/list?return_full_object=true&size=100&user_id="
      .. escape(caller_did), {
      headers = { Authorization = "Bearer " .. env.LITELLM_PROVISIONER_KEY },
    })
  if not list_ok or list_res.status ~= 200 then
    log("issueKey: could not count existing keys")
    error("gateway unreachable")
  end
  local held = 0
  for _, k in ipairs(json.decode(list_res.body).keys or {}) do
    if type(k) == "table" and k.user_id == caller_did then
      held = held + 1
    end
  end
  if held >= max_keys then
    error("key limit reached (" .. max_keys .. "); revoke one first")
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
      log("issueKey: egress failure reaching LiteLLM")
      error("gateway unreachable")
    end
    return response
  end

  -- Scope the key to the member's team so it inherits the tier's model
  -- access. Members belong to at most one team.
  local team_id = nil
  local info_ok, info_res = pcall(http.get,
    env.LITELLM_BASE_URL .. "/user/info?user_id=" .. caller_did, {
      headers = { Authorization = "Bearer " .. env.LITELLM_PROVISIONER_KEY },
    })
  if info_ok and info_res.status == 200 then
    local info = json.decode(info_res.body)
    local user = info.user_info or info
    local teams = user.teams or {}
    if #teams > 0 then
      team_id = teams[1]
    end
  end

  -- Alias is `<handle>/<label>` so gateway admins can tell whose key is
  -- whose at a glance.
  local owner = caller_did
  local prof_ok, prof_res = pcall(http.get,
    "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor="
      .. escape(caller_did), {})
  if prof_ok and prof_res.status == 200 then
    local profile = json.decode(prof_res.body)
    if type(profile.handle) == "string" and profile.handle ~= "handle.invalid" then
      owner = profile.handle
    end
  end

  local alias = owner .. "/" .. label
  local payload = { user_id = caller_did, key_alias = alias }
  if team_id then
    payload.team_id = team_id
  end

  local key_res = gateway("/key/generate", payload)
  if key_res.status ~= 200 then
    if string.find(key_res.body or "", "already exists", 1, true) then
      error("a key with that name already exists")
    end
    log("issueKey: /key/generate returned status " .. tostring(key_res.status))
    error("gateway key issuance failed")
  end

  local created = json.decode(key_res.body)
  if type(created.key) ~= "string" then
    error("gateway returned no key")
  end

  return { key = created.key, alias = alias }
end
