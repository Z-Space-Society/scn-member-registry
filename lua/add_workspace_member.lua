-- Procedure: network.sharedcomputer.workspace.addMember
--
-- Adds a cluster member to a Workspace at `write`. There is no access
-- parameter: members hold write, there are no roles, and the member list *is*
-- the access control list. Its absence is a decision, not an omission.
--
-- Only the creator can call this. That is HappyView's constraint, not ours —
-- add_member accepts the space authority or an instance superuser and nothing
-- else, invites go through the same check, and managing-app policy runs after
-- an unconditional membership check so it can only ever narrow. The practical
-- failure mode is "Boris asks Jacob to add Scott", accepted and deferred.

function handle()
  if not caller_did then
    error("authentication required")
  end

  local w = require_workspace_uri(input.workspace)
  local subject = require_did(input.did)

  -- Pre-checked for the message only; the runtime's own authority check is
  -- still the gate. The authority DID is the URI's first component, which is
  -- the only way to get it — it is not readable off a space handle.
  if w.authority ~= caller_did then
    error("forbidden: only the workspace's creator can add members")
  end

  -- The outer gate. Without this a member could pull an arbitrary internet DID
  -- into cluster-hosted storage. The cost is that a Workspace cannot be shared
  -- outside the cluster, which is deliberate for Phase 1.
  if not is_cluster_member(subject) then
    error("forbidden: that DID is not a cluster member")
  end

  -- Idempotent, like set_space_access.lua: adding twice is a no-op rather than
  -- an error, so a retried request is safe.
  if not space_access(w.uri, subject) then
    local space = atproto.spaces.get(w.uri)
    space:add_member{ did = subject, access = "write" }
  end

  return { ok = true, member = true }
end
