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
 * Validates a raw admin.list record value at the boundary and splits it into
 * the two views. Throws on malformed input: this record gates privileged
 * operations, so a shape surprise is a bug, never something to skip past.
 */
export function parseAdminList(value: unknown): AdminRoster {
  const record = value as { admins?: unknown };
  if (!record || !Array.isArray(record.admins)) {
    throw new Error("admin list record has no admins array");
  }

  const current: string[] = [];
  const ever: string[] = [];
  for (const raw of record.admins) {
    const entry = raw as AdminEntry;
    if (
      typeof entry?.did !== "string" ||
      !entry.did.startsWith("did:") ||
      typeof entry.addedAt !== "string"
    ) {
      throw new Error(`malformed admin entry: ${JSON.stringify(raw)}`);
    }
    ever.push(entry.did);
    if (!entry.removedAt) current.push(entry.did);
  }
  return { current, ever };
}
