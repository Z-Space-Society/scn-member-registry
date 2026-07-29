import { NSID } from "./lexicons";

/**
 * The membership application is a public record in the applicant's own PDS
 * (rkey `self`, one application per account). It carries the bare assertion
 * only — contact details never go in it.
 */

export interface MembershipRequest {
  note?: string;
  createdAt: string;
}

export interface XrpcLike {
  call(
    nsid: string,
    params?: Record<string, unknown>,
    data?: unknown
  ): Promise<{ data: any }>;
}

/**
 * The record URI with rkey `self`: one application per account. HappyView's
 * write procedures take the rkey from this and scope it to the caller's own
 * repo.
 */
export function requestUri(did: string): string {
  return `at://${did}/${NSID.request}/self`;
}

export async function submitRequest(
  xrpc: XrpcLike,
  did: string,
  note?: string
): Promise<{ uri: string }> {
  const input: Record<string, unknown> = {
    uri: requestUri(did),
    createdAt: new Date().toISOString(),
  };
  if (note?.trim()) input.note = note.trim();

  const res = await xrpc.call(NSID.submitRequest, undefined, input);
  return { uri: res.data.uri };
}

/** Returns the caller's application, or null if they have not applied. */
export async function getMyRequest(
  xrpc: XrpcLike,
  did: string
): Promise<MembershipRequest | null> {
  try {
    const res = await xrpc.call("com.atproto.repo.getRecord", {
      repo: did,
      collection: NSID.request,
      rkey: "self",
    });
    return res.data.value as MembershipRequest;
  } catch (e) {
    if ((e as { error?: string })?.error === "RecordNotFound") return null;
    throw e;
  }
}

/** Withdraws the application by deleting the record from the applicant's PDS. */
export async function withdrawRequest(
  xrpc: XrpcLike,
  did: string
): Promise<void> {
  await xrpc.call(NSID.withdrawRequest, undefined, { uri: requestUri(did) });
}

export interface Membership {
  active: boolean;
  grantedBy?: string;
  grant?: { grantedAt?: string; groups?: string[] };
}

/** The caller's membership state, resolved by the getMine Lua query. */
export async function getMyMembership(xrpc: XrpcLike): Promise<Membership> {
  const res = await xrpc.call(NSID.getMine);
  return res.data as Membership;
}

export interface ApplicationRow {
  did: string;
  uri: string;
  createdAt?: string;
  note?: string;
}

/** Extracts the repo DID from an at:// record uri. Throws on garbage. */
export function didFromUri(uri: string): string {
  const m = /^at:\/\/(did:[^/]+)\//.exec(uri);
  if (!m) throw new Error(`not a record uri: ${uri}`);
  return m[1];
}

/** Lists membership applications from the index (public records). */
export async function listRequests(
  xrpc: XrpcLike,
  limit = 50
): Promise<ApplicationRow[]> {
  const res = await xrpc.call(NSID.listRequests, { limit });
  const rows: Array<{ uri: string; createdAt?: string; note?: string }> =
    res.data.requests ?? [];
  return rows.map((r) => ({
    did: didFromUri(r.uri),
    uri: r.uri,
    createdAt: r.createdAt,
    note: r.note,
  }));
}

/** Approves a member: roster-gated Lua procedure, grant authored by caller. */
export async function approveMember(
  xrpc: XrpcLike,
  did: string,
  group?: string
): Promise<{ ok: boolean; uri?: string }> {
  const input: Record<string, unknown> = { did };
  if (group) input.group = group;
  const res = await xrpc.call(NSID.approveMember, undefined, input);
  return res.data;
}

export type MemberViewState =
  | { kind: "apply" }
  | { kind: "pending"; request: MembershipRequest }
  | { kind: "active"; membership: Membership; request: MembershipRequest | null }
  | {
      kind: "unknown";
      request: MembershipRequest | null;
      error: string;
    };

/**
 * Collapses application + membership lookups into one view state. A
 * membership lookup failure downgrades to "unknown" rather than hiding the
 * application state: the member sees their pending status plus a notice.
 */
export function deriveMemberState(
  request: MembershipRequest | null,
  membership: Membership | Error
): MemberViewState {
  if (membership instanceof Error) {
    return { kind: "unknown", request, error: membership.message };
  }
  if (membership.active) return { kind: "active", membership, request };
  if (request) return { kind: "pending", request };
  return { kind: "apply" };
}
