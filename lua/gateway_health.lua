-- Query: network.sharedcomputer.admin.gatewayHealth
-- Confirms if the Lua layer can reach LiteLLM using
-- secrets from script env.

function handle()
  if not env.LITELLM_BASE_URL then
    error("LITELLM_BASE_URL missing from script env")
  end
  if not env.LITELLM_MASTER_KEY then
    error("LITELLM_MASTER_KEY missing from script env")
  end

  -- http.get throws on DNS failure but not on HTTP error statuses.
  local ok, res = pcall(http.get, env.LITELLM_BASE_URL .. "/health/liveliness", {
    headers = { Authorization = "Bearer " .. env.LITELLM_MASTER_KEY },
  })

  if not ok then
    log("gatewayHealth: egress failure reaching LiteLLM")
    return { ok = false, error = "egress" }
  end

  return { ok = res.status == 200, status = res.status }
end
