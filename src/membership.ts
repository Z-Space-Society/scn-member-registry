import { assertDid } from "./did";
import { NSID } from "./lexicons";
import { pdsGetRecord } from "./pds";
import { resolveMembership } from "./rkey";
import type { Tier } from "./tiers";

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
  grant?: { grantedAt?: string; tier?: string };
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

/**
 * A grant or revocation as it sits in the registry space: the record verbatim,
 * wrapped in the metadata the space returns alongside it. The subject DID is
 * not a field — it is the leading half of the rkey (see `parseEventRkey`).
 *
 * The same shape `approve_member.lua` pushes to the membership consumer, so
 * one parser serves both the push and a reconciliation read.
 */
export interface MembershipEvent {
  rkey: string;
  authorDid: string;
  record: {
    /** Grants only: the tier slug recorded at approval time. */
    tier?: string;
    grantedAt?: string;
    revokedAt?: string;
    reason?: string;
  };
}

export interface MemberSummary {
  /** The tier slug from the grant that made this member active. */
  tier?: string;
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
): Map<string, MemberSummary> {
  const admins = new Set(everAdmins);
  const byAdmin = (e: MembershipEvent) => admins.has(e.authorDid);
  const grants = events.grants.filter(byAdmin);
  const state = resolveMembership(
    grants.map((e) => e.rkey),
    events.revocations.filter(byAdmin).map((e) => e.rkey)
  );

  const byRkey = new Map(grants.map((g) => [g.rkey, g]));
  const members = new Map<string, MemberSummary>();
  for (const [did, s] of state) {
    if (!s.active) continue;
    const grant = s.grantRkey ? byRkey.get(s.grantRkey) : undefined;
    members.set(did, { tier: grant?.record?.tier });
  }
  return members;
}

/**
 * Approves a member at a tier: roster-gated Lua procedure, grant authored by
 * the caller. Also how a tier change is made — a fresh grant, resolved by
 * latest-event-wins.
 *
 * `tier` is required rather than optional. The Lua rejects a missing one too;
 * this is the near half of the same guard, so a caller gets a type error
 * instead of a runtime one.
 */
export async function approveMember(
  xrpc: XrpcLike,
  did: string,
  tier: Tier
): Promise<{ ok: boolean; uri?: string }> {
  const res = await xrpc.call(NSID.approveMember, undefined, {
    did: assertDid(did),
    tier,
  });
  return res.data;
}

/** Records a revocation in the registry space, authored by the calling admin. */
export async function revokeMember(
  xrpc: XrpcLike,
  did: string,
  reason?: string
): Promise<{ ok: boolean }> {
  const input: Record<string, unknown> = { did: assertDid(did) };
  if (reason) input.reason = reason;
  const res = await xrpc.call(NSID.revokeMember, undefined, input);
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
