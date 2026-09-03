-- Query: network.sharedcomputer.workspace.listMine
--
-- Every Workspace the caller is a member of. Scoped to caller_did and nothing
-- else — there is no `did` parameter, because the answer is always about the
-- caller. Query dispatch is unauthenticated, so the caller_did check below is
-- not ceremony; it *is* the access control.
--
-- This is the one place member-registry reads HappyView's own tables. There is
-- no listing-by-DID on the Lua spaces API — the surface is accept_invite,
-- get_access, query, create, list_members, get, is_member — so a raw query is
-- the only in-process option. The alternative was Corliss calling
-- com.atproto.space.listSpaces as the member, which works but puts a
-- HappyView-native call into the client contract; keeping the contract ours is
-- what makes a future move off HappyView a Lua rewrite rather than a client
-- rewrite. Schema coupling is the price, and it is confined to this script.
--
-- Both values are BOUND, never interpolated. Non-negotiable.

function handle()
  if not caller_did then
    error("authentication required")
  end

  local limit = tonumber(params.limit) or 50
  if limit < 1 then limit = 1 end
  if limit > 100 then limit = 100 end

  -- happyview_spaces has no uri column: a URI is a projection of
  -- (authority_did, type_nsid, skey), which is why the stable ID is the skey
  -- and why composing the URI here is how the storage actually works.
  --
  -- is_delegation = 0 because Phase 1 uses no delegation. When that changes,
  -- the walk belongs in this query rather than in a new mechanism.
  local rows = db.raw(
    "SELECT s.skey, s.display_name, s.description, s.authority_did, "
      .. "m.access, "
      .. "(SELECT count(*) FROM happyview_space_members mc "
      .. " WHERE mc.space_id = s.id) AS member_count "
      .. "FROM happyview_spaces s "
      .. "JOIN happyview_space_members m ON m.space_id = s.id "
      .. "WHERE m.member_did = $1 "
      .. "AND s.type_nsid = $2 "
      .. "AND m.is_delegation = 0 "
      .. "ORDER BY s.skey DESC "
      .. "LIMIT $3",
    { caller_did, WORKSPACE_TYPE, limit })

  local out = {}
  for _, row in ipairs(rows or {}) do
    out[#out + 1] = {
      id = row.skey,
      uri = workspace_uri(row.authority_did, row.skey),
      displayName = row.display_name,
      description = row.description,
      access = row.access,
      isCreator = row.authority_did == caller_did,
      memberCount = tonumber(row.member_count) or 0,
    }
  end

  -- TID skeys sort by creation, so DESC is newest-first for free.
  return { workspaces = toarray(out) }
end
