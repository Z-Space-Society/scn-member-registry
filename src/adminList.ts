import { NSID } from "./lexicons";
import { pdsGetRecord } from "./pds";
import type { XrpcLike } from "./membership";

/**
 * The admin roster lives in a `network.sharedcomputer.admin.list` record in
 * the service DID's own repo. Entries are never deleted: `removedAt` ends
 * write authority, but grants authored before removal remain valid, so the
 * two views of the roster differ.
 */

export interface AdminEntry {
  did: string;
  addedAt: string;
  removedAt?: string;
}

export interface AdminRoster {
  /** Admins allowed to act now: the write gate. */
  current: string[];
  /** Everyone ever listed: the read filter for grant authorship. */
  ever: string[];
}

/**
 * Validates a raw admin.list record value at the boundary. Throws on
 * malformed input: this record gates privileged operations, so a shape
 * surprise is a bug, never something to skip past.
 */
export function parseAdminEntries(value: unknown): AdminEntry[] {
  const record = value as { admins?: unknown };
  if (!record || !Array.isArray(record.admins)) {
    throw new Error("admin list record has no admins array");
  }
  return record.admins.map((raw) => {
    const entry = raw as AdminEntry;
    if (
      typeof entry?.did !== "string" ||
      !entry.did.startsWith("did:") ||
      typeof entry.addedAt !== "string"
    ) {
      throw new Error(`malformed admin entry: ${JSON.stringify(raw)}`);
    }
    return entry;
  });
}

/** Splits a validated roster into its two views. */
export function parseAdminList(value: unknown): AdminRoster {
  const entries = parseAdminEntries(value);
  return {
    current: entries.filter((e) => !e.removedAt).map((e) => e.did),
    ever: entries.map((e) => e.did),
  };
}

export function rosterUri(ownerDid: string): string {
  return `at://${ownerDid}/${NSID.adminList}/self`;
}

/** The roster from the service DID's repo, or null when none exists yet. */
export async function getRoster(
  serviceDid: string
): Promise<AdminEntry[] | null> {
  const value = await pdsGetRecord(serviceDid, NSID.adminList, "self");
  return value === null ? null : parseAdminEntries(value);
}

/**
 * Writes the roster to the caller's own repo. Only meaningful when the
 * caller is the DID that env.SERVICE_DID anchors; readers ignore rosters in
 * any other repo.
 */
export async function saveRoster(
  xrpc: XrpcLike,
  ownerDid: string,
  admins: AdminEntry[]
): Promise<void> {
  await xrpc.call(NSID.setRoster, undefined, {
    uri: rosterUri(ownerDid),
    admins,
    updatedAt: new Date().toISOString(),
  });
}

/** Whether a DID is a current (non-removed) admin. */
export function isCurrentAdmin(entries: AdminEntry[], did: string): boolean {
  return entries.some((e) => e.did === did && !e.removedAt);
}

export function withAdminAdded(
  entries: AdminEntry[],
  did: string,
  addedAt: string
): AdminEntry[] {
  if (!did.startsWith("did:")) throw new Error(`not a DID: ${did}`);
  if (entries.some((e) => e.did === did && !e.removedAt)) {
    throw new Error(`already a current admin: ${did}`);
  }
  return [...entries, { did, addedAt }];
}

/** Ends an admin's authority by stamping removedAt. Entries are never deleted. */
export function withAdminRemoved(
  entries: AdminEntry[],
  did: string,
  removedAt: string
): AdminEntry[] {
  let found = false;
  const next = entries.map((e) => {
    if (e.did === did && !e.removedAt) {
      found = true;
      return { ...e, removedAt };
    }
    return e;
  });
  if (!found) throw new Error(`not a current admin: ${did}`);
  return next;
}
