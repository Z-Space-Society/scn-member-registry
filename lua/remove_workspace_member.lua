-- Procedure: network.sharedcomputer.workspace.removeMember
--
-- Removes a member from a Workspace. Creator-only, for the same reason
-- addMember is — so there is no "leave a Workspace" in Phase 1, because a
-- member cannot remove themselves and the creator is refused below.
--
-- Two behaviours worth carrying into the UI copy rather than discovering:
-- HappyView revokes the member's outstanding space credentials before removing
-- them, and removal stops future sync but does not unshare the past. A departed
-- member keeps whatever replica they already hold. That is inherent to CRDTs;
-- say it plainly rather than implying removal is retroactive.

function handle()
  if not caller_did then
    error("authentication required")
  end

  local w = require_workspace_uri(input.workspace)
  local subject = require_did(input.did)

  if w.authority ~= caller_did then
    error("forbidden: only the workspace's creator can remove members")
  end

  -- A Workspace whose creator is not a member is a space its owner can manage
  -- and cannot read. Refuse rather than produce that state.
  if subject == w.authority then
    error("the creator cannot be removed from their own workspace")
  end

  -- Idempotent both ways, so retrying a half-finished change is safe and is the
  -- documented recovery.
  if space_access(w.uri, subject) then
    local space = atproto.spaces.get(w.uri)
    space:remove_member{ did = subject }
  end

  return { ok = true, member = false }
end
