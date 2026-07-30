import type { Config } from "./config";
import { NSID } from "./lexicons";

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function fmtDate(iso?: string): string {
  if (!iso) return "?";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "?" : d.toISOString().slice(0, 10);
}

/** Best-effort DID to handle, via the public Bluesky AppView. */
export async function resolveHandle(did: string): Promise<string> {
  try {
    const res = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`
    );
    if (!res.ok) return did;
    const profile = await res.json();
    return profile.handle ?? did;
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
          <div class="gc-banner-title">OPERATOR</div>
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
          <span class="inline-flex items-center gap-2"><span id="lamp-gateway" class="gc-lamp"></span><span class="gc-lamp-label">GATEWAY</span></span>
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
 * Lights the GATEWAY and VIEW lamps from the public gatewayHealth query:
 * a response at all means VIEW is up; body.ok means the gateway is too.
 */
export async function probeLamps(cfg: Config) {
  const gateway = document.getElementById("lamp-gateway");
  const view = document.getElementById("lamp-view");
  if (!gateway || !view) return;
  try {
    const res = await fetch(`${cfg.happyviewUrl}/xrpc/${NSID.gatewayHealth}`, {
      headers: { "X-Client-Key": cfg.clientKey },
    });
    view.classList.add(res.ok ? "gc-lamp--ok" : "gc-lamp--warn");
    const body = res.ok ? await res.json() : { ok: false };
    gateway.classList.add(body.ok ? "gc-lamp--ok" : "gc-lamp--warn");
  } catch {
    view.classList.add("gc-lamp--warn");
    gateway.classList.add("gc-lamp--warn");
  }
}
