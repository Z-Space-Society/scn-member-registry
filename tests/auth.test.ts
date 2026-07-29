import { describe, expect, it } from "vitest";
import { initSession, type OauthClientLike } from "../src/auth";

const SESSION = { did: "did:plc:tmxbvcho3zysvtadtextctxw" } as any;

function fakeClient(init: () => Promise<any>): OauthClientLike {
  return { init, signIn: async () => undefined, logout: async () => undefined };
}

describe("initSession", () => {
  it("returns a null session when nothing is stored", async () => {
    const result = await initSession(fakeClient(async () => undefined));
    expect(result).toEqual({ session: null });
  });

  it("returns the session from a completed init", async () => {
    const result = await initSession(
      fakeClient(async () => ({ session: SESSION }))
    );
    expect(result.session).toBe(SESSION);
    expect(result.callbackError).toBeUndefined();
  });

  it("surfaces a failed OAuth callback instead of throwing", async () => {
    const err = Object.assign(new Error("token exchange failed"), {
      name: "OAuthCallbackError",
    });
    const result = await initSession(
      fakeClient(async () => {
        throw err;
      })
    );
    expect(result.session).toBeNull();
    expect(result.callbackError).toBe("token exchange failed");
  });

  it("rethrows errors that are not callback failures", async () => {
    await expect(
      initSession(
        fakeClient(async () => {
          throw new Error("storage exploded");
        })
      )
    ).rejects.toThrow("storage exploded");
  });
});
