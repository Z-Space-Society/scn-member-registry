import "./styles.css";
import { XrpcClient } from "@atproto/xrpc";
import { loadConfig } from "./config";
import { createOauthClient, initSession } from "./auth";
import { allLexicons } from "./lexicons";
import { renderShell, probeLamps, resolveHandle, type Identity } from "./shell";
import { renderMemberView, renderSignInView } from "./views/member";
import { renderAdminView } from "./views/admin";
import { type XrpcLike } from "./membership";

const cfg = loadConfig(import.meta.env);
const oauthClient = createOauthClient(cfg);
const root = document.getElementById("app")!;

function route(
  xrpc: XrpcLike | null,
  identity: Identity | null,
  callbackError?: string
) {
  const content = document.getElementById("content")!;
  if (!xrpc || !identity) {
    renderSignInView(
      content,
      (handle) => oauthClient.signIn(handle, { scope: cfg.oauthScope }),
      callbackError ? `Sign-in failed: ${callbackError}` : undefined
    );
    return;
  }
  if (location.hash === "#admin") {
    renderAdminView(content, xrpc, identity, cfg.serviceDid, cfg.registrySpaceUri);
  } else {
    renderMemberView(content, xrpc, identity, cfg.serviceDid);
  }
}

const { session, callbackError } = await initSession(oauthClient);

// The SDK strips the callback query params but leaves the path; without this
// the app lives at /oauth/callback after every sign-in.
if (location.pathname === "/oauth/callback") {
  history.replaceState(null, "", "/");
}

let xrpc: XrpcLike | null = null;
let identity: Identity | null = null;
if (session) {
  xrpc = new XrpcClient(session as any, allLexicons as any[]) as XrpcLike;
  identity = { did: session.did };
  (window as any).xrpc = xrpc;
  (window as any).session = session;
}

renderShell(root, identity);
probeLamps(cfg);
route(xrpc, identity, callbackError);

window.addEventListener("hashchange", () => route(xrpc, identity));

/**
 * Signing out must always work locally. The SDK throws before clearing
 * storage if the server rejects the session — which it does for a session
 * minted against an API client that no longer exists — so a failure there
 * would otherwise trap the user in a session they cannot leave.
 */
document.body.addEventListener("click", async (e) => {
  if ((e.target as HTMLElement).id !== "signout" || !identity) return;
  try {
    await oauthClient.logout(identity.did);
  } catch (err) {
    console.warn("server-side sign-out failed; clearing local session:", err);
    localStorage.clear();
  }
  location.hash = "";
  location.reload();
});

if (session && identity && xrpc) {
  const resolved = identity;
  const client = xrpc;

  resolveHandle(resolved.did).then((handle) => {
    const known = handle !== resolved.did ? handle : undefined;
    if (known) {
      resolved.handle = known;
      renderShell(root, resolved);
      probeLamps(cfg);
      route(client, resolved);
    }
  });
}
