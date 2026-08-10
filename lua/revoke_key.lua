-- Procedure: network.sharedcomputer.membership.revokeKey
-- Revokes one of the caller's own keys.

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

  local token = input.token
  if type(token) ~= "string"
    or #token < 8
    or #token > 128
    or not string.find(token, "^%w+$")
  then
    error("invalid input: token")
  end

  local function escape(s)
    return (string.gsub(s, "[^%w%-%.%_%~%:]", function(c)
      return string.format("%%%02X", string.byte(c))
    end))
  end

  local list_ok, list_res = pcall(http.get,
    env.LITELLM_BASE_URL
      .. "/key/list?return_full_object=true&size=100&user_id="
      .. escape(caller_did), {
      headers = { Authorization = "Bearer " .. env.LITELLM_PROVISIONER_KEY },
    })
  if not list_ok or list_res.status ~= 200 then
    log("revokeKey: could not list caller keys")
    error("gateway unreachable")
  end

  local owned = false
  for _, k in ipairs(json.decode(list_res.body).keys or {}) do
    if type(k) == "table" and k.token == token and k.user_id == caller_did then
      owned = true
    end
  end
  if not owned then
    log("revokeKey: caller attempted to revoke a key they do not own")
    error("forbidden: not your key")
  end

  local del_ok, del_res = pcall(http.post, env.LITELLM_BASE_URL .. "/key/delete", {
    headers = {
      Authorization = "Bearer " .. env.LITELLM_PROVISIONER_KEY,
      ["Content-Type"] = "application/json",
    },
    body = json.encode({ keys = toarray({ token }) }),
  })
  if not del_ok then
    log("revokeKey: egress failure reaching LiteLLM")
    error("gateway unreachable")
  end
  if del_res.status ~= 200 then
    log("revokeKey: /key/delete returned status " .. tostring(del_res.status))
    error("gateway key revocation failed")
  end

  return { ok = true }
end
