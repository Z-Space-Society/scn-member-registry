import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAccountEmail } from "../src/pds";

const DID = "did:plc:kzvv6h2tqf4mdxr7wsc3ubna";

function stubDidDoc() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          service: [
            { id: "#atproto_pds", serviceEndpoint: "https://pds.test" },
          ],
        })
      )
    )
  );
}

function session(handler: (url: string) => Promise<Response>) {
  return { did: DID, fetchHandler: vi.fn(async (url: string) => handler(url)) };
}

describe("fetchAccountEmail", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the email from the account's own PDS", async () => {
    stubDidDoc();
    const s = session(async () =>
      new Response(JSON.stringify({ did: DID, email: "a@example.com" }))
    );
    expect(await fetchAccountEmail(s)).toBe("a@example.com");
    expect(s.fetchHandler).toHaveBeenCalledWith(
      "https://pds.test/xrpc/com.atproto.server.getSession",
      { method: "GET" }
    );
  });

  it("returns null when the account has no email", async () => {
    stubDidDoc();
    const s = session(async () => new Response(JSON.stringify({ did: DID })));
    expect(await fetchAccountEmail(s)).toBeNull();
  });

  it("returns null when the scope was not granted", async () => {
    stubDidDoc();
    const s = session(async () => new Response("nope", { status: 403 }));
    expect(await fetchAccountEmail(s)).toBeNull();
  });

  it("returns null rather than throwing when the PDS call fails", async () => {
    stubDidDoc();
    const s = session(async () => {
      throw new Error("network down");
    });
    expect(await fetchAccountEmail(s)).toBeNull();
  });

  it("returns null when the DID cannot be resolved", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 }))
    );
    const s = session(async () => new Response("{}"));
    expect(await fetchAccountEmail(s)).toBeNull();
  });
});
