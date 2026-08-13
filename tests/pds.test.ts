import { afterEach, describe, expect, it, vi } from "vitest";
import { pdsGetRecord } from "../src/pds";

/**
 * resolvePds memoizes per DID for the life of the module, so each test uses a
 * distinct one — otherwise a cache hit skips the DID-document fetch and every
 * queued response lands one position early.
 */
let n = 0;
const nextDid = () => `did:plc:kzvv6h2tqf4mdxr7wsc3ubn${n++}`;

const DID_DOC = JSON.stringify({
  service: [{ id: "#atproto_pds", serviceEndpoint: "https://pds.test" }],
});

/**
 * Both calls go through the same global fetch: first the DID document, then
 * the record itself. Queueing the responses keeps the order explicit.
 */
function stubFetch(...responses: Response[]) {
  const queue = [...responses];
  const fetch = vi.fn(async (_url: string | URL | Request) =>
    queue.shift() ?? new Response("", { status: 500 })
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pdsGetRecord", () => {
  it("returns the record value from the owner's PDS", async () => {
    const did = nextDid();
    const fetch = stubFetch(
      new Response(DID_DOC),
      new Response(JSON.stringify({ value: { note: "hello" } }))
    );
    expect(await pdsGetRecord(did, "some.collection", "self")).toEqual({
      note: "hello",
    });
    // Resolved endpoint, repo/collection/rkey as query params.
    const url = String(fetch.mock.calls[1][0]);
    expect(url).toContain("https://pds.test/xrpc/com.atproto.repo.getRecord");
    expect(url).toContain(`repo=${encodeURIComponent(did)}`);
    expect(url).toContain("rkey=self");
  });

  it("returns null when the record does not exist", async () => {
    const did = nextDid();
    stubFetch(
      new Response(DID_DOC),
      new Response(JSON.stringify({ error: "RecordNotFound" }), { status: 400 })
    );
    expect(await pdsGetRecord(did, "some.collection", "self")).toBeNull();
  });

  // A missing record is a normal state; anything else is not, and must not be
  // flattened into "they have not applied".
  it("throws on any other error", async () => {
    const did = nextDid();
    stubFetch(
      new Response(DID_DOC),
      new Response(JSON.stringify({ error: "InternalServerError" }), {
        status: 500,
      })
    );
    await expect(pdsGetRecord(did, "some.collection", "self")).rejects.toThrow();
  });
});
