import {
  deriveMemberState,
  getMyMembership,
  getMyRequest,
  submitRequest,
  withdrawRequest,
  type MembershipRequest,
  type MemberViewState,
  type XrpcLike,
} from "../membership";
import { getRoster, isCurrentAdmin } from "../adminList";
import { esc, fmtDate, resolveHandle, type Identity } from "../shell";

/** Whether the signed-in user should see the admin area link. */
async function showAdminLink(
  identity: Identity,
  serviceDid?: string
): Promise<boolean> {
  if (!serviceDid) return false;
  if (identity.did === serviceDid) return true;
  try {
    const roster = await getRoster(serviceDid);
    return roster ? isCurrentAdmin(roster, identity.did) : false;
  } catch (e) {
    console.warn("roster lookup for admin link failed:", e);
    return false;
  }
}

function stamp(state: MemberViewState["kind"]): string {
  const variants: Record<string, [string, string]> = {
    active: ["approved", "APPROVED"],
    pending: ["pending", "PENDING"],
    unknown: ["visitor", "UNKNOWN"],
    apply: ["visitor", "VISITOR"],
  };
  const [variant, label] = variants[state];
  return `<div class="gc-stamp gc-stamp--${variant}">${label}</div>`;
}

function membershipCard(state: MemberViewState, identity: Identity): string {
  const rows: string[] = [];
  if (state.kind === "active") {
    const grant = state.membership.grant;
    rows.push(
      `<div class="gc-card-row"><span>JOINED</span><span>${fmtDate(grant?.grantedAt)}</span></div>`,
      `<div class="gc-card-row"><span>BY</span><span id="granted-by">${esc(state.membership.grantedBy ?? "?")}</span></div>`
    );
    if (grant?.tier) {
      rows.push(
        `<div class="gc-card-row"><span>TIER</span><span>${esc(grant.tier)}</span></div>`
      );
    }
  } else if (state.kind === "pending") {
    rows.push(
      `<div class="gc-card-row"><span>APPLIED</span><span>${fmtDate(state.request.createdAt)}</span></div>`
    );
  }
  return `
    <div class="gc-panel">
      <div class="gc-panel-body text-center">
        <div class="text-xs font-bold text-[#000080] mb-2">MEMBERSHIP RECORD</div>
        <div class="gc-card">
          <div class="gc-card-handle">${esc(identity.handle ?? identity.did)}</div>
          ${stamp(state.kind)}
          ${rows.length ? `<div class="gc-card-rows">${rows.join("")}</div>` : ""}
        </div>
      </div>
    </div>
  `;
}

function applicationPanel(request: MembershipRequest): string {
  return `
    <section class="gc-panel gc-panel--gray">
      <div class="gc-panel-title">YOUR APPLICATION</div>
      <div class="gc-panel-body">
        <p>Submitted ${fmtDate(request.createdAt)}. An operator will review it; approval unlocks chat.</p>
        ${request.note ? `<blockquote class="gc-mono">${esc(request.note)}</blockquote>` : ""}
        <button id="withdraw" class="gc-btn">WITHDRAW APPLICATION</button>
        <span id="withdraw-error" class="gc-error"></span>
      </div>
    </section>
  `;
}

function applyPanel(): string {
  return `
    <section class="gc-panel gc-panel--gray">
      <div class="gc-panel-title">REQUEST MEMBERSHIP</div>
      <div class="gc-panel-body">
        <p>Applying writes a <strong>public</strong> record to your own atproto repo. Keep the note short; never put contact details in it.</p>
        <form id="apply">
          <p><label>Introduction (optional, public)<br>
            <textarea id="note" class="gc-textarea" rows="3" maxlength="300"></textarea>
          </label></p>
          <button type="submit" class="gc-btn">REQUEST MEMBERSHIP</button>
          <span class="gc-new gc-blink">JOIN!</span>
        </form>
        <p id="apply-error" class="gc-error"></p>
      </div>
    </section>
  `;
}

/**
 * What an approved member sees here. Keys and usage used to live on this
 * page; they are gateway surfaces and moved out with the rest of the gateway
 * integration, to be rebuilt where the member's session already exists. The
 * registry's job ends at recording that this person is a member, at a tier.
 */
function activePanel(): string {
  return `
    <section class="gc-panel gc-panel--gray">
      <div class="gc-panel-title">MEMBERSHIP ACTIVE</div>
      <div class="gc-panel-body">
        <p>Your membership is on record. Keys, usage and chat live in the
        member area — this desk handles the roll itself.</p>
      </div>
    </section>
  `;
}

export async function renderMemberView(
  content: HTMLElement,
  xrpc: XrpcLike,
  identity: Identity,
  serviceDid?: string
) {
  content.innerHTML = `<div class="gc-col"><p>Loading...</p></div>`;

  const [request, membership] = await Promise.all([
    getMyRequest(identity.did).catch((e) => {
      console.warn("application lookup failed:", e);
      return null;
    }),
    getMyMembership(xrpc).catch((e: Error) => e),
  ]);
  const state = deriveMemberState(request, membership);

  const main: string[] = [];
  if (state.kind === "apply") main.push(applyPanel());
  if (state.kind === "pending" || (state.kind === "unknown" && state.request)) {
    main.push(applicationPanel((state as { request: MembershipRequest }).request));
  }
  if (state.kind === "unknown") {
    console.warn("membership lookup failed:", state.error);
    main.push(
      `<p class="gc-small">Membership status is unknown right now (the status service did not respond).</p>`
    );
  }
  if (state.kind === "active") main.push(activePanel());

  content.innerHTML = `
    <div class="gc-col">${main.join("")}</div>
    <aside class="gc-aside">
      ${membershipCard(state, identity)}
      <div id="admin-link"></div>
      <p class="text-center m-0"><button id="signout" class="gc-btn">SIGN OUT</button></p>
    </aside>
  `;

  showAdminLink(identity, serviceDid).then((show) => {
    const slot = document.getElementById("admin-link");
    if (show && slot) {
      slot.innerHTML = `<p class="text-center m-0"><a href="#admin">OPERATOR DESK →</a></p>`;
    }
  });

  if (state.kind === "active" && state.membership.grantedBy) {
    resolveHandle(state.membership.grantedBy).then((handle) => {
      const el = document.getElementById("granted-by");
      if (el) el.textContent = handle;
    });
  }

  document.getElementById("apply")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const note = (document.getElementById("note") as HTMLTextAreaElement).value;
    try {
      await submitRequest(xrpc, identity.did, note);
      renderMemberView(content, xrpc, identity, serviceDid);
    } catch (err) {
      document.getElementById("apply-error")!.textContent =
        `Submission failed: ${(err as Error).message}`;
    }
  });

  document.getElementById("withdraw")?.addEventListener("click", async () => {
    try {
      await withdrawRequest(xrpc, identity.did);
      renderMemberView(content, xrpc, identity, serviceDid);
    } catch (err) {
      document.getElementById("withdraw-error")!.textContent =
        ` ${(err as Error).message}`;
    }
  });
}

export function renderSignInView(
  content: HTMLElement,
  onSignIn: (handle: string) => void,
  notice?: string
) {
  content.innerHTML = `
    <div class="gc-col">
      <section class="gc-panel gc-panel--gray">
        <div class="gc-panel-title">SIGN IN</div>
        <div class="gc-panel-body">
          <p>Sign in with your atproto account (Bluesky handle or DID).</p>
          <form id="signin">
            <p><input id="handle" class="gc-input" placeholder="you.example.com" required></p>
            <button type="submit" class="gc-btn">SIGN IN</button>
          </form>
          ${notice ? `<p class="gc-error">${esc(notice)}</p>` : ""}
        </div>
      </section>
    </div>
    <aside class="gc-aside">
      <div class="gc-panel">
        <div class="gc-panel-body">
          <div class="text-xs font-bold text-[#000080] mb-2">SHARED COMPUTER NETWORK</div>
          <p class="m-0 text-[13px]">Community-run AI inference on shared hardware. Members sign in with the identity they already own.</p>
        </div>
      </div>
    </aside>
  `;
  document.getElementById("signin")!.addEventListener("submit", (e) => {
    e.preventDefault();
    onSignIn((document.getElementById("handle") as HTMLInputElement).value.trim());
  });
}
