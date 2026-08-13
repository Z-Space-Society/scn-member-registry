import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeMembers,
  approveMember,
  deriveMemberState,
  listMembers,
  didFromUri,
  getMyMembership,
  getMyRequest,
  listRequests,
  revokeMember,
  submitRequest,
  withdrawRequest,
  type Membership,
  type XrpcLike,
} from "../src/membership";
import { NSID } from "../src/lexicons";

const DID = "did:plc:kzvv6h2tqf4mdxr7wsc3ubna";

function fakeXrpc(impl: (nsid: string, params?: any, data?: any) => any): XrpcLike & {
  call: ReturnType<typeof vi.fn>;
} {
  return { call: vi.fn(async (n, p, d) => ({ data: impl(n, p, d) })) };
}

/** Stubs fetch for the DID-doc resolution + PDS getRecord pair. */
function stubPdsFetch(record: { value: unknown } | null) {
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
      if (record === null) {
        return new Response(
          JSON.stringify({ error: "RecordNotFound", message: "nope" }),
          { status: 400 }
        );
      }
      return new Response(JSON.stringify(record));
    })
  );
}

describe("submitRequest", () => {
  it("calls the submit procedure with the self-keyed uri", async () => {
    const xrpc = fakeXrpc(() => ({ uri: "at://x" }));
    const res = await submitRequest(xrpc, DID, "hello");

    expect(res.uri).toBe("at://x");
    expect(xrpc.call).toHaveBeenCalledWith(
      NSID.submitRequest,
      undefined,
      expect.objectContaining({
        uri: `at://${DID}/${NSID.request}/self`,
        note: "hello",
        createdAt: expect.any(String),
      })
    );
  });

  it("omits the note field when the note is empty or whitespace", async () => {
    const xrpc = fakeXrpc(() => ({ uri: "at://x" }));
    await submitRequest(xrpc, DID, "   ");
    const input = xrpc.call.mock.calls[0][2];
    expect("note" in input).toBe(false);
  });
});

describe("getMyRequest", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the record value from the PDS when the application exists", async () => {
    const value = { createdAt: "2026-07-28T00:00:00Z", note: "hi" };
    stubPdsFetch({ value });
    expect(await getMyRequest(DID)).toEqual(value);
  });

  it("returns null when no application exists", async () => {
    stubPdsFetch(null);
    expect(await getMyRequest(DID)).toBeNull();
  });
});

describe("withdrawRequest", () => {
  it("calls the withdraw procedure with the self-keyed uri", async () => {
    const xrpc = fakeXrpc(() => ({}));
    await withdrawRequest(xrpc, DID);
    expect(xrpc.call).toHaveBeenCalledWith(NSID.withdrawRequest, undefined, {
      uri: `at://${DID}/${NSID.request}/self`,
    });
  });
});

describe("didFromUri", () => {
  it("extracts the repo DID from a record uri", () => {
    expect(didFromUri(`at://${DID}/${NSID.request}/self`)).toBe(DID);
  });

  it("throws on a non-record uri", () => {
    expect(() => didFromUri("https://example.com")).toThrow(/not a record uri/);
  });
});

describe("listRequests", () => {
  it("maps flat index rows into application rows with derived DIDs", async () => {
    const xrpc = fakeXrpc(() => ({
      requests: [
        {
          uri: `at://${DID}/${NSID.request}/self`,
          createdAt: "2026-07-29T00:00:00Z",
          note: "hi",
        },
      ],
    }));
    const rows = await listRequests(xrpc, 25);
    expect(rows).toEqual([
      {
        did: DID,
        uri: `at://${DID}/${NSID.request}/self`,
        createdAt: "2026-07-29T00:00:00Z",
        note: "hi",
      },
    ]);
    expect(xrpc.call).toHaveBeenCalledWith(NSID.listRequests, { limit: 25 });
  });

  it("returns empty for an empty index", async () => {
    const xrpc = fakeXrpc(() => ({ requests: [] }));
    expect(await listRequests(xrpc)).toEqual([]);
  });
});

describe("activeMembers", () => {
  const ADMIN = "did:plc:admin";
  const OUTSIDER = "did:plc:outsider";
  const t1 = "3mrqo575gjaaa";
  const t2 = "3mrqo575gjbbb";

  it("returns DIDs with an admin-authored grant", () => {
    const events = {
      grants: [{ rkey: `${DID}:${t1}`, authorDid: ADMIN }],
      revocations: [],
    };
    expect([...activeMembers(events, [ADMIN]).keys()]).toEqual([DID]);
  });

  it("excludes a DID whose latest event is a revocation", () => {
    const events = {
      grants: [{ rkey: `${DID}:${t1}`, authorDid: ADMIN }],
      revocations: [{ rkey: `${DID}:${t2}`, authorDid: ADMIN }],
    };
    expect(activeMembers(events, [ADMIN]).size).toBe(0);
  });

  it("ignores grants authored by someone who was never an admin", () => {
    const events = {
      grants: [{ rkey: `${DID}:${t1}`, authorDid: OUTSIDER }],
      revocations: [],
    };
    expect(activeMembers(events, [ADMIN]).size).toBe(0);
  });

  it("honors grants from a departed admin", () => {
    const events = {
      grants: [{ rkey: `${DID}:${t1}`, authorDid: ADMIN }],
      revocations: [],
    };
    expect(activeMembers(events, [ADMIN]).has(DID)).toBe(true);
  });

  it("returns empty for no events", () => {
    expect(activeMembers({ grants: [], revocations: [] }, [ADMIN]).size).toBe(0);
  });

  it("reports the tier recorded on the winning grant", () => {
    const events = {
      grants: [
        { rkey: `${DID}:${t1}`, authorDid: ADMIN, tier: "level-2" },
      ],
      revocations: [],
    };
    expect(activeMembers(events, [ADMIN]).get(DID)).toEqual({
      tier: "level-2",
    });
  });

  it("prefers the newest grant's tier after a tier change", () => {
    const events = {
      grants: [
        { rkey: `${DID}:${t1}`, authorDid: ADMIN, tier: "level-2" },
        { rkey: `${DID}:${t2}`, authorDid: ADMIN, tier: "level-5" },
      ],
      revocations: [],
    };
    expect(activeMembers(events, [ADMIN]).get(DID)?.tier).toBe("level-5");
  });

  // approveMember rejects a tierless grant at write time, so this only
  // happens for records written before tier was required. Surface the gap as
  // undefined rather than inventing a tier: a caller that silently defaulted
  // would hand out an entitlement nobody granted.
  it("leaves the tier undefined when the grant recorded none", () => {
    const events = {
      grants: [{ rkey: `${DID}:${t1}`, authorDid: ADMIN }],
      revocations: [],
    };
    expect(activeMembers(events, [ADMIN]).get(DID)).toEqual({
      tier: undefined,
    });
  });
});

describe("listMembers", () => {
  it("defaults missing arrays to empty", async () => {
    const xrpc = fakeXrpc(() => ({}));
    expect(await listMembers(xrpc)).toEqual({ grants: [], revocations: [] });
  });
});

describe("approveMember", () => {
  it("sends the did and the tier slug", async () => {
    const xrpc = fakeXrpc(() => ({ ok: true, uri: "ats://x" }));
    const res = await approveMember(xrpc, DID, "level-3");
    expect(res.ok).toBe(true);
    expect(xrpc.call).toHaveBeenCalledWith(NSID.approveMember, undefined, {
      did: DID,
      tier: "level-3",
    });
  });

  it("sends the free tier like any other", async () => {
    const xrpc = fakeXrpc(() => ({ ok: true }));
    await approveMember(xrpc, DID, "level-0");
    expect(xrpc.call.mock.calls[0][2]).toEqual({ did: DID, tier: "level-0" });
  });

  it("rejects a malformed DID before calling the server", async () => {
    const xrpc = fakeXrpc(() => ({ ok: true }));
    await expect(approveMember(xrpc, "nope", "level-1")).rejects.toThrow();
    expect(xrpc.call).not.toHaveBeenCalled();
  });
});

describe("getMyMembership", () => {
  it("returns the membership payload", async () => {
    const xrpc = fakeXrpc(() => ({ active: true, grantedBy: DID }));
    expect(await getMyMembership(xrpc)).toEqual({ active: true, grantedBy: DID });
  });
});

describe("deriveMemberState", () => {
  const request = { createdAt: "2026-07-29T00:00:00Z" };
  const inactive: Membership = { active: false };
  const active: Membership = { active: true, grantedBy: DID };

  it("yields apply when nothing exists", () => {
    expect(deriveMemberState(null, inactive)).toEqual({ kind: "apply" });
  });

  it("yields pending when an application exists without a grant", () => {
    expect(deriveMemberState(request, inactive)).toEqual({
      kind: "pending",
      request,
    });
  });

  it("yields active when the membership is active", () => {
    expect(deriveMemberState(request, active)).toEqual({
      kind: "active",
      membership: active,
      request,
    });
  });

  it("yields unknown with the application preserved when the lookup fails", () => {
    const state = deriveMemberState(request, new Error("boom"));
    expect(state).toEqual({ kind: "unknown", request, error: "boom" });
  });
});

describe("revokeMember", () => {
  it("sends the did and an optional reason", async () => {
    const xrpc = fakeXrpc(() => ({ ok: true }));
    const res = await revokeMember(xrpc, DID, "left the co-op");
    expect(res.ok).toBe(true);
    expect(xrpc.call).toHaveBeenCalledWith(NSID.revokeMember, undefined, {
      did: DID,
      reason: "left the co-op",
    });
  });

  it("omits the reason when not given", async () => {
    const xrpc = fakeXrpc(() => ({ ok: true }));
    await revokeMember(xrpc, DID);
    expect(xrpc.call.mock.calls[0][2]).toEqual({ did: DID });
  });

  it("rejects a malformed DID before calling the server", async () => {
    const xrpc = fakeXrpc(() => ({ ok: true }));
    await expect(revokeMember(xrpc, "did:plc:a/b")).rejects.toThrow(/not a DID/);
    expect(xrpc.call).not.toHaveBeenCalled();
  });
});
