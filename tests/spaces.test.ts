import { describe, expect, it, vi } from "vitest";
import {
  createRegistrySpace,
  findRegistrySpace,
  listSpaces,
  REGISTRY_SKEY,
  REGISTRY_TYPE,
} from "../src/spaces";

const SERVICE = "did:plc:n4mzxx6z4ehnswc7znswtfr2";
const REGISTRY_URI = `ats://${SERVICE}/space/${REGISTRY_TYPE}/${REGISTRY_SKEY}`;

describe("findRegistrySpace", () => {
  it("finds the registry space among other spaces", () => {
    expect(
      findRegistrySpace([
        { uri: `ats://${SERVICE}/space/com.example.other/main` },
        { uri: REGISTRY_URI },
      ])
    ).toBe(REGISTRY_URI);
  });

  it("returns null when no registry space exists", () => {
    expect(findRegistrySpace([{ uri: `ats://${SERVICE}/space/x/main` }])).toBeNull();
  });

  it("ignores a registry space with a different skey", () => {
    expect(
      findRegistrySpace([{ uri: `ats://${SERVICE}/space/${REGISTRY_TYPE}/dev` }])
    ).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(findRegistrySpace([])).toBeNull();
  });
});

describe("listSpaces", () => {
  it("passes the did and returns the spaces array", async () => {
    const xrpc = {
      call: vi.fn(async () => ({ data: { spaces: [{ uri: REGISTRY_URI }] } })),
    };
    expect(await listSpaces(xrpc, SERVICE)).toEqual([{ uri: REGISTRY_URI }]);
    expect(xrpc.call).toHaveBeenCalledWith("com.atproto.space.listSpaces", {
      did: SERVICE,
      limit: 50,
    });
  });

  it("returns empty when the response has no spaces field", async () => {
    const xrpc = { call: async () => ({ data: {} }) };
    expect(await listSpaces(xrpc, SERVICE)).toEqual([]);
  });
});

describe("createRegistrySpace", () => {
  it("creates the space with the registry type, skey, and mint policy", async () => {
    const xrpc = { call: vi.fn(async () => ({ data: { uri: REGISTRY_URI } })) };
    expect(await createRegistrySpace(xrpc)).toBe(REGISTRY_URI);
    expect(xrpc.call).toHaveBeenCalledWith(
      "com.atproto.simplespace.createSpace",
      undefined,
      expect.objectContaining({
        type: REGISTRY_TYPE,
        skey: REGISTRY_SKEY,
        mintPolicy: "managing-app",
      })
    );
  });

  it("accepts a nested space.uri response shape", async () => {
    const xrpc = { call: async () => ({ data: { space: { uri: REGISTRY_URI } } }) };
    expect(await createRegistrySpace(xrpc)).toBe(REGISTRY_URI);
  });

  it("throws when the response carries no uri", async () => {
    const xrpc = { call: async () => ({ data: {} }) };
    await expect(createRegistrySpace(xrpc)).rejects.toThrow(/no uri/);
  });
});
