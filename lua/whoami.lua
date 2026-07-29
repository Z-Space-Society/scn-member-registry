-- Query: network.sharedcomputer.admin.whoami
-- Debug instrument: reports whether the call carried an authenticated
-- identity. Used to probe which auth modes (HappyView DPoP session,
-- atproto service-auth JWT, client key only) populate caller_did.

function handle()
  return {
    authenticated = caller_did ~= nil,
    did = caller_did,
  }
end
