-- Query: network.sharedcomputer.membership.listMyKeys
-- Lists the caller's gateway keys.

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

  local function escape(s)
    return (string.gsub(s, "[^%w%-%.%_%~%:]", function(c)
      return string.format("%%%02X", string.byte(c))
    end))
  end

  local url = env.LITELLM_BASE_URL
    .. "/key/list?return_full_object=true&size=100&user_id="
    .. escape(caller_did)

  local ok, res = pcall(http.get, url, {
    headers = { Authorization = "Bearer " .. env.LITELLM_PROVISIONER_KEY },
  })
  if not ok then
    log("listMyKeys: egress failure reaching LiteLLM")
    error("gateway unreachable")
  end
  if res.status ~= 200 then
    log("listMyKeys: /key/list returned status " .. tostring(res.status))
    error("gateway key query failed")
  end

  local body = json.decode(res.body)
  local keys = {}
  for _, k in ipairs(body.keys or {}) do
    if type(k) == "table" and k.user_id == caller_did then
      keys[#keys + 1] = {
        token = k.token,
        masked = k.key_name,
        alias = k.key_alias,
        spend = k.spend or 0,
        createdAt = k.created_at,
        blocked = k.blocked and true or false,
      }
    end
  end

  return { keys = toarray(keys) }
end
