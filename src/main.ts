import "./styles.css";
import { XrpcClient } from "@atproto/xrpc";
import { loadConfig } from "./config";
import { createOauthClient, initSession } from "./auth";
import { allLexicons } from "./lexicons";
import { renderShell, probeLamps, resolveHandle, type Identity } from "./shell";
import { renderMemberView, renderSignInView } from "./views/member";
import { renderAdminView } from "./views/admin";
import type { XrpcLike } from "./membership";

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
    renderAdminView(content, xrpc);
  } else {
    renderMemberView(content, xrpc, identity);
  }
}

const { session, callbackError } = await initSession(oauthClient);

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

document.body.addEventListener("click", async (e) => {
  if ((e.target as HTMLElement).id === "signout" && identity) {
    await oauthClient.logout(identity.did);
    location.hash = "";
    location.reload();
  }
});

if (identity) {
  resolveHandle(identity.did).then((handle) => {
    if (handle !== identity!.did) {
      identity!.handle = handle;
      renderShell(root, identity);
      probeLamps(cfg);
      route(xrpc, identity);
    }
  });
}
