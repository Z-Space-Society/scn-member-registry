/**
 * Direct public reads from a repo's own PDS. HappyView proxies
 * com.atproto.repo.* to the Bluesky AppView, which only serves collections
 * it indexes — custom-collection records must be read from the PDS itself.
 */

const pdsCache = new Map<string, string>();

export async function resolvePds(did: string): Promise<string> {
  const cached = pdsCache.get(did);
  if (cached) return cached;

  let doc: { service?: Array<{ id: string; serviceEndpoint?: string }> };
  if (did.startsWith("did:plc:")) {
    const res = await fetch(`https://plc.directory/${did}`);
    if (!res.ok) throw new Error(`could not resolve ${did}: HTTP ${res.status}`);
    doc = await res.json();
  } else if (did.startsWith("did:web:")) {
    const host = did.slice("did:web:".length).replace(/%3A/gi, ":");
    const res = await fetch(`https://${host}/.well-known/did.json`);
    if (!res.ok) throw new Error(`could not resolve ${did}: HTTP ${res.status}`);
    doc = await res.json();
  } else {
    throw new Error(`unsupported DID method: ${did}`);
  }

  const svc = (doc.service ?? []).find(
    (s) => s.id === "#atproto_pds" || s.id === `${did}#atproto_pds`
  );
  if (!svc?.serviceEndpoint) {
    throw new Error(`no PDS endpoint in DID document for ${did}`);
  }
  pdsCache.set(did, svc.serviceEndpoint);
  return svc.serviceEndpoint;
}

/** The part of a HappyView session this module needs, for testability. */
export interface SessionLike {
  did: string;
  fetchHandler(url: string, init: RequestInit): Promise<Response>;
}

/**
 * Reads the signed-in account's email from its own PDS.
 */
export async function fetchAccountEmail(
  session: SessionLike
): Promise<string | null> {
  try {
    const pds = await resolvePds(session.did);
    const res = await session.fetchHandler(
      `${pds}/xrpc/com.atproto.server.getSession`,
      { method: "GET" }
    );
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body.email === "string" ? body.email : null;
  } catch (e) {
    console.warn("email lookup failed:", e);
    return null;
  }
}

/**
 * Reads a record from the owner's PDS. Returns the record value, or null
 * when the record does not exist. Throws on anything else.
 */
export async function pdsGetRecord(
  did: string,
  collection: string,
  rkey: string
): Promise<unknown | null> {
  const pds = await resolvePds(did);
  const params = new URLSearchParams({ repo: did, collection, rkey });
  const res = await fetch(`${pds}/xrpc/com.atproto.repo.getRecord?${params}`);
  if (res.ok) {
    const body = await res.json();
    return body.value;
  }
  const body = await res.json().catch(() => ({}));
  if (body.error === "RecordNotFound") return null;
  throw new Error(`getRecord failed: ${body.message ?? `HTTP ${res.status}`}`);
}
