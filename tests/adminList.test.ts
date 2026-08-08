import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getRoster,
  isCurrentAdmin,
  parseAdminList,
  rosterUri,
  saveRoster,
  setSpaceAccess,
  withAdminAdded,
  withAdminRemoved,
} from "../src/adminList";
import { NSID } from "../src/lexicons";

const A = "did:plc:tmxbvcho3zysvtadtextctxw";
const B = "did:web:example.com";

describe("parseAdminList", () => {
  it("puts active admins in both views", () => {
    const roster = parseAdminList({
      admins: [{ did: A, addedAt: "2026-07-28T00:00:00Z" }],
      updatedAt: "2026-07-28T00:00:00Z",
    });
    expect(roster).toEqual({ current: [A], ever: [A] });
  });

  it("keeps removed admins in ever but not current", () => {
    const roster = parseAdminList({
      admins: [
        { did: A, addedAt: "2026-01-01T00:00:00Z" },
        {
          did: B,
          addedAt: "2026-01-01T00:00:00Z",
          removedAt: "2026-06-01T00:00:00Z",
        },
      ],
      updatedAt: "2026-07-28T00:00:00Z",
    });
    expect(roster.current).toEqual([A]);
    expect(roster.ever).toEqual([A, B]);
  });

  it("accepts an empty roster", () => {
    expect(parseAdminList({ admins: [], updatedAt: "x" })).toEqual({
      current: [],
      ever: [],
    });
  });

  it("throws when the admins array is missing", () => {
    expect(() => parseAdminList({})).toThrow(/no admins array/);
    expect(() => parseAdminList(null)).toThrow(/no admins array/);
  });

  it("throws on an entry with a non-DID subject", () => {
    expect(() =>
      parseAdminList({ admins: [{ did: "hadsie.com", addedAt: "x" }] })
    ).toThrow(/malformed admin entry/);
  });

  it("throws on an entry missing addedAt", () => {
    expect(() => parseAdminList({ admins: [{ did: A }] })).toThrow(
      /malformed admin entry/
    );
  });
});

describe("isCurrentAdmin", () => {
  it("is true for a listed admin without removedAt", () => {
    expect(isCurrentAdmin([{ did: A, addedAt: "x" }], A)).toBe(true);
  });

  it("is false for a removed admin", () => {
    expect(
      isCurrentAdmin([{ did: A, addedAt: "x", removedAt: "y" }], A)
    ).toBe(false);
  });

  it("is false for an unlisted DID", () => {
    expect(isCurrentAdmin([{ did: A, addedAt: "x" }], B)).toBe(false);
  });
});

describe("withAdminAdded", () => {
  const now = "2026-07-29T00:00:00Z";

  it("appends a new entry", () => {
    expect(withAdminAdded([], A, now)).toEqual([{ did: A, addedAt: now }]);
  });

  it("rejects a DID that is already a current admin", () => {
    const entries = [{ did: A, addedAt: "2026-01-01T00:00:00Z" }];
    expect(() => withAdminAdded(entries, A, now)).toThrow(/already a current admin/);
  });

  it("re-adds a previously removed admin as a fresh entry", () => {
    const entries = [
      { did: A, addedAt: "2026-01-01T00:00:00Z", removedAt: "2026-06-01T00:00:00Z" },
    ];
    const next = withAdminAdded(entries, A, now);
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({ did: A, addedAt: now });
  });

  it("rejects a non-DID", () => {
    expect(() => withAdminAdded([], "hadsie.com", now)).toThrow(/not a DID/);
  });
});

describe("withAdminRemoved", () => {
  const now = "2026-07-29T00:00:00Z";

  it("stamps removedAt without deleting the entry", () => {
    const entries = [{ did: A, addedAt: "2026-01-01T00:00:00Z" }];
    expect(withAdminRemoved(entries, A, now)).toEqual([
      { did: A, addedAt: "2026-01-01T00:00:00Z", removedAt: now },
    ]);
  });

  it("rejects removing someone who is not a current admin", () => {
    expect(() => withAdminRemoved([], A, now)).toThrow(/not a current admin/);
    const removed = [
      { did: A, addedAt: "x", removedAt: "2026-06-01T00:00:00Z" },
    ];
    expect(() => withAdminRemoved(removed, A, now)).toThrow(/not a current admin/);
  });
});

describe("getRoster / saveRoster", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubPdsFetch(body: unknown, status = 200) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("https://plc.directory/")) {
          return new Response(
            JSON.stringify({
              service: [
                { id: "#atproto_pds", serviceEndpoint: "https://pds.test" },
              ],
            })
          );
        }
        return new Response(JSON.stringify(body), { status });
      })
    );
  }

  it("reads and validates the roster from the service DID's PDS", async () => {
    stubPdsFetch({
      value: { admins: [{ did: A, addedAt: "x" }], updatedAt: "x" },
    });
    expect(await getRoster("did:plc:servicedid")).toEqual([
      { did: A, addedAt: "x" },
    ]);
  });

  it("returns null when no roster record exists", async () => {
    stubPdsFetch({ error: "RecordNotFound", message: "nope" }, 400);
    expect(await getRoster("did:plc:servicedid")).toBeNull();
  });

  it("writes the roster to the caller's repo at rkey self", async () => {
    const xrpc = { call: vi.fn(async () => ({ data: {} })) };
    const admins = [{ did: A, addedAt: "x" }];
    await saveRoster(xrpc, B, admins);
    expect(xrpc.call).toHaveBeenCalledWith(
      NSID.setRoster,
      undefined,
      expect.objectContaining({ uri: rosterUri(B), admins })
    );
  });
});

describe("setSpaceAccess", () => {
  it("calls the procedure with did and access", async () => {
    const xrpc = { call: vi.fn(async () => ({ data: { ok: true, member: true } })) };
    await setSpaceAccess(xrpc, A, "write");
    expect(xrpc.call).toHaveBeenCalledWith(NSID.setSpaceAccess, undefined, {
      did: A,
      access: "write",
    });
  });
});
