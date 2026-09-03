-- Query: network.sharedcomputer.workspace.listMembers
--
-- Who is in one Workspace. Member-gated: a non-member is refused, which is what
-- membership_public = false means in practice for this door. Query dispatch is
-- unauthenticated, so the checks below are the access control.
--
-- Returns DIDs, never handles. DID is the join key everywhere; Corliss already
-- owns handle resolution and this script has no business duplicating it.
--
-- The relay will eventually need this list and cannot present a caller_did — the
-- same shape that made syncMembers a token-gated query. When that lands,
-- generalise that door rather than inventing a second mechanism.

function handle()
  if not caller_did then
    error("authentication required")
  end

  local w = require_workspace_uri(params.workspace)

  -- Delegation-resolved by the runtime, so this stays correct if a later phase
  -- introduces delegated membership.
  if not space_access(w.uri, caller_did) then
    error("forbidden: not a member of this workspace")
  end

  -- Module-level and positional. There is no space:list_members method, and the
  -- named-table form that atproto.spaces.query takes is rejected here.
  local members = atproto.spaces.list_members(w.uri)

  local out = {}
  for _, m in ipairs(members or {}) do
    out[#out + 1] = {
      did = m.did,
      access = m.access,
      isCreator = m.did == w.authority,
    }
  end

  return {
    creatorDid = w.authority,
    members = toarray(out),
  }
end
