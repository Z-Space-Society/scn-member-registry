-- Procedure: network.sharedcomputer.membership.syncProfile
-- Refreshes the caller's display details on their own LiteLLM user: the
-- atproto handle as user_alias, the account email as user_email.

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

  local payload = { user_id = caller_did }
  local any = false

  if input.email ~= nil and input.email ~= "" then
    local email = input.email
    if type(email) ~= "string"
      or #email > 320
      or string.find(email, "%s")
      or not string.find(email, "^[^@]+@[^@]+%.[^@]+$")
    then
      error("invalid input: email")
    end
    payload.user_email = email
    any = true
  end

  -- Handles are lowercase domain names: dotted, final segment letter-initial.
  if input.handle ~= nil and input.handle ~= "" then
    local h = input.handle
    if type(h) ~= "string"
      or #h > 253
      or not string.find(h, "^[a-z0-9][a-z0-9%.%-]*%.[a-z][a-z0-9%-]*$")
    then
      error("invalid input: handle")
    end
    payload.user_alias = h
    any = true
  end

  if not any then
    return { ok = true }
  end

  local ok, res = pcall(http.post, env.LITELLM_BASE_URL .. "/user/update", {
    headers = {
      Authorization = "Bearer " .. env.LITELLM_PROVISIONER_KEY,
      ["Content-Type"] = "application/json",
    },
    body = json.encode(payload),
  })
  if not ok then
    log("syncProfile: egress failure reaching LiteLLM")
    return { ok = false }
  end
  if res.status ~= 200 then
    log("syncProfile: /user/update returned status " .. tostring(res.status))
    return { ok = false }
  end

  return { ok = true }
end
