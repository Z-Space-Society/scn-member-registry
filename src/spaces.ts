import type { XrpcLike } from "./membership";

/**
 * The registry space. Its authority is fixed at creation and cannot be
 * migrated, so it must be created by the service identity.
 */
export const REGISTRY_TYPE = "network.sharedcomputer.registry";
export const REGISTRY_SKEY = "main";

export interface SpaceSummary {
  uri: string;
  isOwner?: boolean;
}

export async function listSpaces(
  xrpc: XrpcLike,
  did: string
): Promise<SpaceSummary[]> {
  const res = await xrpc.call("com.atproto.space.listSpaces", { did, limit: 50 });
  return res.data.spaces ?? [];
}

/** Matches on type and skey, which together identify the registry space. */
export function findRegistrySpace(spaces: SpaceSummary[]): string | null {
  const suffix = `/${REGISTRY_TYPE}/${REGISTRY_SKEY}`;
  return spaces.find((s) => s.uri.endsWith(suffix))?.uri ?? null;
}

export async function createRegistrySpace(
  xrpc: XrpcLike,
  displayName = "SCN Registry"
): Promise<string> {
  const res = await xrpc.call("com.atproto.simplespace.createSpace", undefined, {
    type: REGISTRY_TYPE,
    skey: REGISTRY_SKEY,
    displayName,
    mintPolicy: "managing-app",
  });
  const uri = res.data.uri ?? res.data.space?.uri;
  if (!uri) throw new Error("createSpace returned no uri");
  return uri;
}
