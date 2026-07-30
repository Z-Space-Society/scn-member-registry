import { afterEach, describe, expect, it, vi } from "vitest";
import {
  approveMember,
  deriveMemberState,
  didFromUri,
  getMyMembership,
  getMyRequest,
  listRequests,
  submitRequest,
  withdrawRequest,
  type Membership,
  type XrpcLike,
} from "../src/membership";
import { NSID } from "../src/lexicons";

const DID = "did:plc:tmxbvcho3zysvtadtextctxw";

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

describe("approveMember", () => {
  it("passes the subject did and optional group to the procedure", async () => {
    const xrpc = fakeXrpc(() => ({ ok: true, uri: "ats://x" }));
    const res = await approveMember(xrpc, DID, "standard");
    expect(res.ok).toBe(true);
    expect(xrpc.call).toHaveBeenCalledWith(NSID.approveMember, undefined, {
      did: DID,
      group: "standard",
    });
  });

  it("omits group when not given", async () => {
    const xrpc = fakeXrpc(() => ({ ok: true }));
    await approveMember(xrpc, DID);
    expect(xrpc.call.mock.calls[0][2]).toEqual({ did: DID });
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
