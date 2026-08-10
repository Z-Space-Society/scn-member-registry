-- Query: network.sharedcomputer.admin.listTeams
-- Lists LiteLLM teams so an admin can pick a tier when approving.

function handle()
  if not caller_did then
    error("authentication required")
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

  local ok, res = pcall(http.get, env.LITELLM_BASE_URL .. "/team/list", {
    headers = { Authorization = "Bearer " .. env.LITELLM_PROVISIONER_KEY },
  })
  if not ok then
    log("listTeams: egress failure reaching LiteLLM")
    error("gateway unreachable")
  end
  if res.status ~= 200 then
    log("listTeams: /team/list failed with status " .. tostring(res.status))
    error("gateway team query failed")
  end

  local body = json.decode(res.body)
  local raw = body.teams or body
  local teams = {}
  for _, t in ipairs(raw or {}) do
    if t.team_id then
      teams[#teams + 1] = { teamId = t.team_id, alias = t.team_alias or t.team_id }
    end
  end

  return { teams = toarray(teams) }
end
