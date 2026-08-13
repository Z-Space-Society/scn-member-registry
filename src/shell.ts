import type { Config } from "./config";

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function fmtDate(iso?: string): string {
  if (!iso) return "?";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "?" : d.toISOString().slice(0, 10);
}

/**
 * Best-effort DID to handle, via the public Bluesky AppView. Falls back to
 * the DID when the handle is unknown.
 */
export async function resolveHandle(did: string): Promise<string> {
  try {
    const res = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`
    );
    if (!res.ok) return did;
    const profile = await res.json();
    const handle = profile.handle;
    if (typeof handle !== "string" || handle === "handle.invalid") return did;
    return handle;
  } catch {
    return did;
  }
}

export interface Identity {
  did: string;
  handle?: string;
}

export function renderShell(root: HTMLElement, identity: Identity | null) {
  root.innerHTML = `
    <div class="gc-page">
      <div class="gc-frame">
        <header class="gc-banner">
          <div class="gc-banner-title">SCN OPERATOR</div>
          <div class="gc-banner-sub">~ * ~ sharedcomputer.network member area ~ * ~</div>
          <div class="gc-banner-identity">
            ${
              identity
                ? `<span class="gc-chip">${esc(identity.handle ?? identity.did)}</span>
                   <span class="gc-did">${esc(identity.did)}</span>`
                : `<span class="gc-chip">visitor</span>`
            }
          </div>
        </header>
        <div class="gc-rainbow gc-rainbow--animated"></div>
        <div class="gc-statusbar">
          <strong>SYSTEM STATUS:</strong>
          <span class="inline-flex items-center gap-2"><span id="lamp-view" class="gc-lamp"></span><span class="gc-lamp-label">VIEW</span></span>
          <span class="inline-flex items-center gap-2"><span class="gc-lamp"></span><span class="gc-lamp-label">CHAT</span> <span class="gc-small">(soon)</span></span>
        </div>
        <div id="content" class="gc-main"></div>
        <div class="gc-rainbow"></div>
        <footer class="gc-footer">
          operator desk staffed weekdays 09:00–17:00 · vancouver, bc
        </footer>
      </div>
    </div>
  `;
}

/**
 * Lights the VIEW lamp by reaching the HappyView instance at all.
 *
 * `no-cors` because this is cross-origin and the answer wanted is only
 * "reachable": an opaque response still resolves, and an unreachable host
 * still rejects. Reading the body would need CORS headers we do not control
 * and would tell us nothing more.
 *
 * (There was a GATEWAY lamp here, fed by a gateway-health query. It went with
 * the rest of the gateway integration — the registry has no opinion on
 * whether inference is up.)
 */
export async function probeLamps(cfg: Config) {
  const view = document.getElementById("lamp-view");
  if (!view) return;
  try {
    await fetch(cfg.happyviewUrl, { mode: "no-cors" });
    view.classList.add("gc-lamp--ok");
  } catch {
    view.classList.add("gc-lamp--warn");
  }
}
