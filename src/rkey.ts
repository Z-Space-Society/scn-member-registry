import { assertDid, isDid } from "./did";

/**
 * Grant and revocation rkeys are `{memberDid}:{tid}`. The rkey alone carries
 * subject and ordering, so membership for the whole roll is resolvable from
 * listRecords output (rkeys only) with no per-record fetches.
 */

const S32_ALPHABET = "234567abcdefghijklmnopqrstuvwxyz";
const TID_RE = /^[2-7a-z]{13}$/;

let lastMicros = 0;

/** Returns a 13-char base32-sortable atproto TID for the current time. */
export function tidNow(): string {
  let micros = Date.now() * 1000;
  if (micros <= lastMicros) micros = lastMicros + 1;
  lastMicros = micros;

  const clockId = BigInt(Math.floor(Math.random() * 1024));
  let n = (BigInt(micros) << 10n) | clockId;

  let out = "";
  for (let i = 0; i < 13; i++) {
    out = S32_ALPHABET[Number(n & 31n)] + out;
    n >>= 5n;
  }
  return out;
}

export interface EventKey {
  did: string;
  tid: string;
}

export function eventRkey(did: string, tid: string = tidNow()): string {
  assertDid(did);
  if (!TID_RE.test(tid)) throw new Error(`not a TID: ${tid}`);
  return `${did}:${tid}`;
}

/**
 * Splits an event rkey back into subject DID and TID. Throws on malformed
 * input: the registry is admin-authored, so a bad rkey is a pipeline bug,
 * not a value to skip over.
 */
export function parseEventRkey(rkey: string): EventKey {
  const cut = rkey.lastIndexOf(":");
  const did = rkey.slice(0, cut);
  const tid = rkey.slice(cut + 1);
  if (cut < 0 || !isDid(did) || !TID_RE.test(tid)) {
    throw new Error(`malformed event rkey: ${rkey}`);
  }
  return { did, tid };
}

export interface MembershipState {
  active: boolean;
  /** TID of the deciding (latest) event. */
  tid: string;
  /** rkey of the latest grant, for fetching the grant record directly. */
  grantRkey?: string;
}

/**
 * Resolves membership from grant and revocation rkeys: a member is active iff
 * their latest event is a grant. TIDs compare lexicographically. On the
 * (pathological) exact tie, revocation wins.
 */
export function resolveMembership(
  grantRkeys: string[],
  revocationRkeys: string[]
): Map<string, MembershipState> {
  const state = new Map<string, MembershipState>();

  const apply = (rkeys: string[], isGrant: boolean) => {
    for (const rkey of rkeys) {
      const { did, tid } = parseEventRkey(rkey);
      const prev = state.get(did);
      const wins =
        !prev || tid > prev.tid || (tid === prev.tid && !isGrant);
      if (wins) {
        state.set(did, {
          active: isGrant,
          tid,
          grantRkey: isGrant ? rkey : prev?.grantRkey,
        });
      }
    }
  };

  // Grants first, so that when a revocation wins, prev.grantRkey is already
  // the member's latest grant.
  apply(grantRkeys, true);
  apply(revocationRkeys, false);
  return state;
}
