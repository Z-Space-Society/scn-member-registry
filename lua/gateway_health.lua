-- Query: network.sharedcomputer.admin.gatewayHealth
-- Proves the Lua layer can reach LiteLLM AND that the provisioner key is
-- valid: /user/list is admin-gated, so a 200 means egress, secrets, and key
-- role all work. The key must never appear in log() output or the returned
-- table.

function handle()
  if not env.LITELLM_BASE_URL then
    error("LITELLM_BASE_URL missing from script env")
  end
  if not env.LITELLM_PROVISIONER_KEY then
    error("LITELLM_PROVISIONER_KEY missing from script env")
  end

  -- http.get throws on DNS failure but not on HTTP error statuses.
  local ok, res = pcall(http.get, env.LITELLM_BASE_URL .. "/user/list", {
    headers = { Authorization = "Bearer " .. env.LITELLM_PROVISIONER_KEY },
  })

  if not ok then
    log("gatewayHealth: egress failure reaching LiteLLM")
    return { ok = false, error = "egress" }
  end

  return { ok = res.status == 200, status = res.status }
end
