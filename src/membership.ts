import { assertDid } from "./did";
import { NSID } from "./lexicons";
import { pdsGetRecord } from "./pds";
import { resolveMembership } from "./rkey";

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
  did: string
): Promise<MembershipRequest | null> {
  const value = await pdsGetRecord(did, NSID.request, "self");
  return value as MembershipRequest | null;
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
  const m = /^at:\/\/([^/]+)\//.exec(uri);
  if (!m) throw new Error(`not a record uri: ${uri}`);
  return assertDid(m[1]);
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

export interface MembershipEvent {
  rkey: string;
  authorDid: string;
}

export interface MembershipEvents {
  grants: MembershipEvent[];
  revocations: MembershipEvent[];
}

/** Grant and revocation events from the registry space. Admin-only. */
export async function listMembers(xrpc: XrpcLike): Promise<MembershipEvents> {
  const res = await xrpc.call(NSID.listMembers);
  return {
    grants: res.data.grants ?? [],
    revocations: res.data.revocations ?? [],
  };
}

/**
 * Resolves which DIDs are currently members. Events authored by anyone who
 * is not (or was not) an admin are ignored.
 */
export function activeMembers(
  events: MembershipEvents,
  everAdmins: Iterable<string>
): Set<string> {
  const admins = new Set(everAdmins);
  const byAdmin = (e: MembershipEvent) => admins.has(e.authorDid);
  const state = resolveMembership(
    events.grants.filter(byAdmin).map((e) => e.rkey),
    events.revocations.filter(byAdmin).map((e) => e.rkey)
  );
  return new Set(
    [...state.entries()].filter(([, s]) => s.active).map(([did]) => did)
  );
}

export interface ProfileSync {
  email?: string;
  handle?: string;
}

/**
 * Refreshes the member's handle and email on their LiteLLM user.
 */
export async function syncProfile(
  xrpc: XrpcLike,
  profile: ProfileSync
): Promise<boolean> {
  const input: Record<string, string> = {};
  if (profile.email) input.email = profile.email;
  if (profile.handle) input.handle = profile.handle;
  if (Object.keys(input).length === 0) return false;

  try {
    const res = await xrpc.call(NSID.syncProfile, undefined, input);
    return Boolean(res.data?.ok);
  } catch (e) {
    console.warn("profile sync failed:", e);
    return false;
  }
}

export interface Team {
  teamId: string;
  alias: string;
}

/** LiteLLM teams available as membership tiers. */
export async function listTeams(xrpc: XrpcLike): Promise<Team[]> {
  const res = await xrpc.call(NSID.listTeams);
  return res.data.teams ?? [];
}

export interface ApproveOptions {
  team?: Team;
  email?: string;
}

/** Approves a member: roster-gated Lua procedure, grant authored by caller. */
export async function approveMember(
  xrpc: XrpcLike,
  did: string,
  options: ApproveOptions = {}
): Promise<{ ok: boolean; uri?: string }> {
  const input: Record<string, unknown> = { did };
  if (options.team) {
    input.teamId = options.team.teamId;
    input.teamLabel = options.team.alias;
  }
  if (options.email) input.email = options.email;
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
