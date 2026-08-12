-- Query: network.sharedcomputer.admin.whoami (Debugging)
-- Report whether the call carried an authenticated identity.
-- Probes which auth modes (HappyView DPoP session, atproto
-- service-auth JWT, client key only) populate caller_did.

function handle()
  return {
    authenticated = caller_did ~= nil,
    did = caller_did,
  }
end
