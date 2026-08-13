/**
 * Local lexicon definitions for XrpcClient. It validates NSIDs against these
 * before sending, so every method we call needs at least a minimal entry, and
 * every query parameter must be declared or the client rejects it client-side.
 */

export const NSID = {
  adminList: "network.sharedcomputer.admin.list",
  request: "network.sharedcomputer.membership.request",
  submitRequest: "network.sharedcomputer.membership.submitRequest",
  withdrawRequest: "network.sharedcomputer.membership.withdrawRequest",
  listRequests: "network.sharedcomputer.membership.listRequests",
  listMembers: "network.sharedcomputer.membership.listMembers",
  approveMember: "network.sharedcomputer.admin.approveMember",
  revokeMember: "network.sharedcomputer.admin.revokeMember",
  setRoster: "network.sharedcomputer.admin.setRoster",
  setSpaceAccess: "network.sharedcomputer.admin.setSpaceAccess",
  grant: "network.sharedcomputer.membership.grant",
  revocation: "network.sharedcomputer.membership.revocation",
  getMine: "network.sharedcomputer.membership.getMine",
} as const;

const proc = (id: string) => ({
  lexicon: 1,
  id,
  defs: { main: { type: "procedure" } },
});

const query = (id: string, props: Record<string, string> = {}) => ({
  lexicon: 1,
  id,
  defs: {
    main: {
      type: "query",
      parameters: {
        type: "params",
        properties: Object.fromEntries(
          Object.entries(props).map(([k, t]) => [k, { type: t }])
        ),
      },
    },
  },
});

/** PDS repo methods, proxied through the HappyView session. */
export const repoLexicons = [
  proc("com.atproto.repo.createRecord"),
  proc("com.atproto.repo.putRecord"),
  proc("com.atproto.repo.deleteRecord"),
  query("com.atproto.repo.getRecord", {
    repo: "string",
    collection: "string",
    rkey: "string",
  }),
  query("com.atproto.server.getServiceAuth", {
    aud: "string",
    exp: "integer",
    lxm: "string",
  }),
];

/** HappyView space methods (experimental API). */
export const spaceLexicons = [
  proc("com.atproto.simplespace.createSpace"),
  proc("com.atproto.simplespace.updateSpace"),
  proc("com.atproto.simplespace.deleteSpace"),
  proc("com.atproto.simplespace.updateConfig"),
  proc("com.atproto.space.createRecord"),
  proc("com.atproto.space.putRecord"),
  proc("com.atproto.space.deleteRecord"),
  query("com.atproto.space.listSpaces", {
    did: "string",
    limit: "integer",
    cursor: "string",
  }),
  query("com.atproto.space.getSpace", { space: "string" }),
  query("com.atproto.space.getRecord", {
    space: "string",
    author: "string",
    collection: "string",
    rkey: "string",
  }),
  query("com.atproto.space.listRecords", {
    space: "string",
    repo: "string",
    collection: "string",
    limit: "integer",
    cursor: "string",
  }),
  query("com.atproto.simplespace.getConfig", { space: "string" }),
  proc("dev.happyview.space.createInvite"),
  proc("dev.happyview.space.acceptInvite"),
];

/** Our endpoints: Lua-backed queries and record-write procedures. */
export const scnLexicons = [
  query(NSID.getMine),
  query(NSID.listRequests, { limit: "integer", cursor: "string" }),
  query(NSID.listMembers),
  proc(NSID.submitRequest),
  proc(NSID.withdrawRequest),
  proc(NSID.approveMember),
  proc(NSID.revokeMember),
  proc(NSID.setRoster),
  proc(NSID.setSpaceAccess),
];

export const allLexicons = [...repoLexicons, ...spaceLexicons, ...scnLexicons];
