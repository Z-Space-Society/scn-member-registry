-- Query: network.sharedcomputer.membership.getMyUsage
-- Returns the caller's own gateway usage from LiteLLM's daily aggregate
-- tables.

local DAY = 24 * 60 * 60

function handle()
  -- A nil in a query table would return the entire gateway's usage.
  if not caller_did then
    error("authentication required")
  end
  if not env.LITELLM_BASE_URL then
    error("LITELLM_BASE_URL missing from script env")
  end
  if not env.LITELLM_PROVISIONER_KEY then
    error("LITELLM_PROVISIONER_KEY missing from script env")
  end

  -- The sandbox has no urlencode; DIDs are safe apart from exotic did:web
  -- forms, so percent-escape anything outside the unreserved set plus colon.
  local function escape(s)
    return (string.gsub(s, "[^%w%-%.%_%~%:]", function(c)
      return string.format("%%%02X", string.byte(c))
    end))
  end

  local function ymd(ts)
    return os.date("!%Y-%m-%d", ts)
  end

  -- Sanitize date strings.
    local function date_or(value, fallback)
    if value == nil or value == "" then
      return fallback
    end
    if type(value) ~= "string" or not string.find(value, "^%d%d%d%d%-%d%d%-%d%d$") then
      error("invalid input: date must be YYYY-MM-DD")
    end
    return value
  end

  local now_ts = os.time()
  local end_date = date_or(params.endDate, ymd(now_ts))
  local start_date = date_or(params.startDate, ymd(now_ts - 29 * DAY))

  local url = env.LITELLM_BASE_URL
    .. "/user/daily/activity?user_id=" .. escape(caller_did)
    .. "&start_date=" .. escape(start_date)
    .. "&end_date=" .. escape(end_date)
    .. "&page_size=100"

  local ok, res = pcall(http.get, url, {
    headers = { Authorization = "Bearer " .. env.LITELLM_PROVISIONER_KEY },
  })
  if not ok then
    log("getMyUsage: egress failure reaching LiteLLM")
    error("gateway unreachable")
  end
  if res.status ~= 200 then
    log("getMyUsage: daily activity failed with status " .. tostring(res.status))
    error("gateway usage query failed")
  end

  local body = json.decode(res.body)

  -- One row per (day, model). Days whose requests never reached a model —
  -- failures, mostly — still get a row so usage is not silently missing.
  local rows = {}
  for _, day in ipairs(body.results or {}) do
    local models = day.breakdown and day.breakdown.models or {}
    local seen = false
    for model, entry in pairs(models) do
      local m = entry.metrics or {}
      seen = true
      rows[#rows + 1] = {
        date = day.date,
        model = model,
        promptTokens = m.prompt_tokens or 0,
        completionTokens = m.completion_tokens or 0,
        totalTokens = m.total_tokens or 0,
        spend = m.spend or 0,
        requests = m.api_requests or 0,
      }
    end
    if not seen then
      local m = day.metrics or {}
      if (m.api_requests or 0) > 0 then
        rows[#rows + 1] = {
          date = day.date,
          promptTokens = m.prompt_tokens or 0,
          completionTokens = m.completion_tokens or 0,
          totalTokens = m.total_tokens or 0,
          spend = m.spend or 0,
          requests = m.api_requests or 0,
        }
      end
    end
  end

  local meta = body.metadata or {}
  return {
    rows = toarray(rows),
    totals = {
      promptTokens = meta.total_prompt_tokens or 0,
      completionTokens = meta.total_completion_tokens or 0,
      totalTokens = meta.total_tokens or 0,
      spend = meta.total_spend or 0,
      requests = meta.total_api_requests or 0,
    },
    startDate = start_date,
    endDate = end_date,
  }
end
