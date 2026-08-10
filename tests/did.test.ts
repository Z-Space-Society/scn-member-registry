import { describe, expect, it } from "vitest";
import { assertDid, isDid } from "../src/did";

describe("isDid", () => {
  it.each([
    "did:plc:kzvv6h2tqf4mdxr7wsc3ubna",
    "did:web:view.sharedcomputer.network",
    "did:web:localhost%3A3000",
    "did:key:zQ3shVKnC2Q8Y38Dz7T1KACCvFNhUn94dosZ24aCKmUdvp1Pk",
  ])("accepts %s", (did) => {
    expect(isDid(did)).toBe(true);
  });

  it("rejects a DID containing a slash, which would break record uris", () => {
    expect(isDid("did:plc:abc/../../evil")).toBe(false);
  });

  it.each([
    ["markup", "did:plc:<script>alert(1)</script>"],
    ["a quote", 'did:plc:a"b'],
    ["whitespace", "did:plc:a b"],
    ["a newline", "did:plc:a\nb"],
    ["an empty identifier", "did:plc:"],
    ["no method", "did::abc"],
    ["an uppercase method", "did:PLC:abc"],
    ["a bare prefix", "did:"],
    ["a handle", "alice.example.com"],
  ])("rejects %s", (_label, value) => {
    expect(isDid(value)).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isDid(undefined)).toBe(false);
    expect(isDid(null)).toBe(false);
    expect(isDid(42)).toBe(false);
    expect(isDid({ did: "did:plc:abc" })).toBe(false);
  });

  it("rejects an absurdly long DID", () => {
    expect(isDid(`did:plc:${"a".repeat(600)}`)).toBe(false);
  });
});

describe("assertDid", () => {
  it("returns the value when valid", () => {
    expect(assertDid("did:plc:abc")).toBe("did:plc:abc");
  });

  it("throws on anything invalid", () => {
    expect(() => assertDid("did:plc:a/b")).toThrow(/not a DID/);
  });
});
