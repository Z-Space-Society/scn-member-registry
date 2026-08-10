import { describe, expect, it, vi } from "vitest";
import { issueKey, keyLabel, listMyKeys, revokeKey } from "../src/keys";
import { NSID } from "../src/lexicons";

const DID = "did:plc:kzvv6h2tqf4mdxr7wsc3ubna";

function fakeXrpc(impl: () => any) {
  return { call: vi.fn(async () => ({ data: impl() })) };
}

describe("keyLabel", () => {
  it("strips the DID prefix members never chose", () => {
    expect(keyLabel(`${DID}/opencode`)).toBe("opencode");
  });

  it("keeps a label that has a slash of its own", () => {
    expect(keyLabel(`${DID}/my/tool`)).toBe("my/tool");
  });

  it("returns an unprefixed alias unchanged", () => {
    expect(keyLabel("legacy-key")).toBe("legacy-key");
  });

  it("names an aliasless key", () => {
    expect(keyLabel(undefined)).toBe("(unnamed)");
  });
});

describe("listMyKeys", () => {
  it("returns the keys array", async () => {
    const keys = [
      { token: "abc", masked: "sk-...4f2a", alias: `${DID}/x`, spend: 0, blocked: false },
    ];
    const xrpc = fakeXrpc(() => ({ keys }));
    expect(await listMyKeys(xrpc)).toEqual(keys);
    expect(xrpc.call).toHaveBeenCalledWith(NSID.listMyKeys);
  });

  it("defaults to empty when the field is missing", async () => {
    expect(await listMyKeys(fakeXrpc(() => ({})))).toEqual([]);
  });
});

describe("issueKey", () => {
  it("sends the label and returns the secret", async () => {
    const xrpc = fakeXrpc(() => ({ key: "sk-secret", alias: `${DID}/agent` }));
    const result = await issueKey(xrpc, "agent");
    expect(result.key).toBe("sk-secret");
    expect(xrpc.call).toHaveBeenCalledWith(NSID.issueKey, undefined, {
      label: "agent",
    });
  });
});

describe("revokeKey", () => {
  it("sends the token", async () => {
    const xrpc = fakeXrpc(() => ({ ok: true }));
    await revokeKey(xrpc, "abc123");
    expect(xrpc.call).toHaveBeenCalledWith(NSID.revokeKey, undefined, {
      token: "abc123",
    });
  });

  it("propagates a refusal rather than swallowing it", async () => {
    const xrpc = {
      call: async () => {
        throw new Error("forbidden: not your key");
      },
    };
    await expect(revokeKey(xrpc, "abc123")).rejects.toThrow(/not your key/);
  });
});
