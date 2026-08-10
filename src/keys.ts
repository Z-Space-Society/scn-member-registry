import { NSID } from "./lexicons";
import type { XrpcLike } from "./membership";

/**
 * Gateway API keys for the signed-in member.
 */

export interface ApiKey {
  /** The key's hash. Identifies it for revocation; not a credential. */
  token: string;
  /** Display form, e.g. `sk-...4f2a`. */
  masked?: string;
  alias?: string;
  spend: number;
  createdAt?: string;
  blocked: boolean;
}

export async function listMyKeys(xrpc: XrpcLike): Promise<ApiKey[]> {
  const res = await xrpc.call(NSID.listMyKeys);
  return res.data.keys ?? [];
}

/** Returns the secret, which the caller must show once and then discard. */
export async function issueKey(
  xrpc: XrpcLike,
  label: string
): Promise<{ key: string; alias: string }> {
  const res = await xrpc.call(NSID.issueKey, undefined, { label });
  return res.data;
}

export async function revokeKey(
  xrpc: XrpcLike,
  token: string
): Promise<void> {
  await xrpc.call(NSID.revokeKey, undefined, { token });
}

/**
 * Aliases are stored as `<owner>/<label>` so gateway admins can attribute a
 * key at a glance; members only ever see the custom part.
 */
export function keyLabel(alias?: string): string {
  if (!alias) return "(unnamed)";
  const cut = alias.indexOf("/");
  return cut === -1 ? alias : alias.slice(cut + 1);
}
