-- Procedure: network.sharedcomputer.admin.setSpaceAccess
-- Grants or revokes registry space write membership for an admin. The space
-- runtime enforces that only the space authority (the service DID) can add
-- or remove members. Removing a member also revokes their outstanding space
-- credentials.

function handle()
  if not caller_did then
    error("authentication required")
  end
  if not env.REGISTRY_SPACE_URI then
    error("REGISTRY_SPACE_URI missing from script env")
  end

  local did = input.did
  if type(did) ~= "string" or string.sub(did, 1, 4) ~= "did:" then
    error("invalid input: did")
  end

  local space = atproto.spaces.get(env.REGISTRY_SPACE_URI)

  if input.access == "write" then
    if not space:is_member(did) then
      space:add_member{ did = did, access = "write" }
    end
    return { ok = true, member = true }
  end

  if input.access == "none" then
    if space:is_member(did) then
      space:remove_member{ did = did }
    end
    return { ok = true, member = false }
  end

  error("invalid input: access must be 'write' or 'none'")
end
