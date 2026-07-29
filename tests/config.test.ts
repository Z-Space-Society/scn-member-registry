import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

const env = {
  VITE_HAPPYVIEW_URL: "https://view.sharedcomputer.network",
  VITE_HV_CLIENT_KEY: "hvc_test",
  VITE_OAUTH_REDIRECT_URI: "http://127.0.0.1:5173/oauth/callback",
  VITE_OAUTH_SCOPE: "atproto transition:generic",
};

describe("loadConfig", () => {
  it("builds a loopback client id from redirect and scope", () => {
    const cfg = loadConfig(env);
    expect(cfg.clientId).toBe(
      "http://localhost?redirect_uri=http%3A%2F%2F127.0.0.1%3A5173%2Foauth%2Fcallback&scope=atproto%20transition%3Ageneric"
    );
  });

  it("prefers an explicit client id when provided", () => {
    const cfg = loadConfig({
      ...env,
      VITE_OAUTH_CLIENT_ID: "https://manage.sharedcomputer.network/client.json",
    });
    expect(cfg.clientId).toBe(
      "https://manage.sharedcomputer.network/client.json"
    );
  });

  it.each(Object.keys(env))("throws when %s is missing", (key) => {
    const broken = { ...env, [key]: undefined };
    expect(() => loadConfig(broken)).toThrow(key);
  });
});
