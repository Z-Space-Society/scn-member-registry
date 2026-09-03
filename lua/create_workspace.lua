-- Procedure: network.sharedcomputer.workspace.create
--
-- Creates a Workspace owned by the caller. `createSpace` makes the caller the
-- authority — always and unavoidably, there is no authority argument — which is
-- why only the creator can manage members afterwards.
--
-- The caller must be an active cluster member. That gate is the reason this is
-- our procedure rather than a bare com.atproto.simplespace.createSpace: the
-- protocol reserves nothing, so anyone with a HappyView session could mint a
-- space of this type under their own DID. Such a space is invisible to every
-- SCN surface and discloses nothing (see CLAUDE.md, "a space type is a name,
-- not a possession"), but a Workspace SCN will actually show is gated here.
--
-- A new Workspace has exactly one member: the creator, added automatically by
-- the runtime. Nothing else is added — no delegation, no seeded roster.

function handle()
  if not caller_did then
    error("authentication required")
  end

  if not is_cluster_member(caller_did) then
    error("forbidden: not a cluster member")
  end

  local name = input.displayName
  if type(name) ~= "string" or #name < 1 or #name > 64 then
    error("invalid input: displayName")
  end

  local description = input.description
  if description ~= nil then
    if type(description) ~= "string" or #description > 300 then
      error("invalid input: description")
    end
  end

  -- The stable ID *is* the skey, and it is a TID. The authority DID cannot be
  -- transferred, so if a Workspace ever has to move it is re-minted under a new
  -- authority with this same skey and its identity travels with it. Durable
  -- references key off this, never off the URI — which also keeps them clear of
  -- the unsettled at:// versus ats:// question. Monotonic, so listings order by
  -- creation with no extra column.
  local id = tostring(TID())

  -- Config keys are snake_case at rest — read off the live registry space,
  -- which stores {"membership_public":false,"records_public":false}. The
  -- camelCase spelling in HappyView's XRPC docs would be dropped silently as an
  -- unknown key, leaving a Workspace on defaults nobody chose. Both are set
  -- explicitly for that reason rather than inherited.
  --
  -- mint_policy is deliberately NOT the registry space's "managing-app": that
  -- space carries it with a null managing_app_did, which is untested and
  -- harmless only because nothing mints its credentials. Workspace credentials
  -- will be minted, so "member-list" — whose enforcement is the route
  -- re-verifying membership — is the honest setting.
  local created = atproto.spaces.create{
    type = WORKSPACE_TYPE,
    skey = id,
    display_name = name,
    description = description,
    mint_policy = "member-list",
    config = {
      membership_public = false,
      records_public = false,
    },
  }

  -- Prefer the URI the runtime reports; compose it only as a fallback. They
  -- should agree — the authority is the caller — and if they ever do not, the
  -- runtime is right.
  local uri = (type(created) == "table" and (created.uri or (created.space and created.space.uri)))
    or workspace_uri(caller_did, id)

  return {
    ok = true,
    id = id,
    uri = uri,
    displayName = name,
  }
end
