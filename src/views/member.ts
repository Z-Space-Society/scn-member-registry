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
import { formatInt, getMyUsage, sortUsageRows, type Usage } from "../usage";
import {
  issueKey,
  keyLabel,
  listMyKeys,
  revokeKey,
  type ApiKey,
} from "../keys";
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
    if (grant?.groups?.length) {
      rows.push(
        `<div class="gc-card-row"><span>TIER</span><span>${esc(grant.groups.join(", "))}</span></div>`
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

function usagePanel(): string {
  return `
    <section class="gc-panel">
      <div class="gc-panel-title"><span>USAGE REPORT</span><span id="usage-range" class="gc-mono text-[11px] text-[#99ccff]"></span></div>
      <div class="gc-panel-body" id="usage-body"><p>Loading usage...</p></div>
    </section>
  `;
}

function usageTable(usage: Usage): string {
  const rows = sortUsageRows(usage.rows);
  if (rows.length === 0) {
    return `<p>No gateway usage recorded in this period.</p>`;
  }
  const cells = rows
    .map(
      (r) => `
      <tr>
        <td>${esc(r.date)}</td>
        <td>${r.model ? esc(r.model) : "<span class='gc-small'>(no model)</span>"}</td>
        <td class="num">${formatInt(r.promptTokens)}</td>
        <td class="num">${formatInt(r.completionTokens)}</td>
        <td class="num">${formatInt(r.requests)}</td>
      </tr>`
    )
    .join("");
  const t = usage.totals;
  return `
    <table class="gc-table">
      <thead>
        <tr>
          <th>DATE</th><th>MODEL</th>
          <th class="num">IN TOKENS</th><th class="num">OUT TOKENS</th><th class="num">REQUESTS</th>
        </tr>
      </thead>
      <tbody>
        ${cells}
        <tr>
          <td colspan="2"><strong>TOTAL — ${rows.length} LINE${rows.length === 1 ? "" : "S"}</strong></td>
          <td class="num"><strong>${formatInt(t.promptTokens)}</strong></td>
          <td class="num"><strong>${formatInt(t.completionTokens)}</strong></td>
          <td class="num"><strong>${formatInt(t.requests)}</strong></td>
        </tr>
      </tbody>
    </table>
  `;
}

async function loadUsage(xrpc: XrpcLike) {
  const body = document.getElementById("usage-body");
  if (!body) return;
  try {
    const usage = await getMyUsage(xrpc);
    body.innerHTML = usageTable(usage);
    const range = document.getElementById("usage-range");
    if (range) range.textContent = `${usage.startDate} → ${usage.endDate}`;
  } catch (e) {
    console.warn("usage lookup failed:", e);
    body.innerHTML = `<p class="gc-small">Usage is unavailable right now.</p>`;
  }
}

function keysPanel(): string {
  return `
    <section class="gc-panel">
      <div class="gc-panel-title gc-panel-title--gray">API KEYS (for members who write their own tools)</div>
      <div class="gc-panel-body" id="keys-body"><p>Loading keys...</p></div>
    </section>
  `;
}

function keysTable(keys: ApiKey[]): string {
  const rows =
    keys.length === 0
      ? `<tr><td colspan="4" class="gc-small">No keys yet. You only need one to call the gateway from your own tools.</td></tr>`
      : keys
          .map(
            (k) => `
        <tr>
          <td>${esc(keyLabel(k.alias))}</td>
          <td>${esc(k.masked ?? "")}</td>
          <td>${fmtDate(k.createdAt)}</td>
          <td class="num"><button class="gc-btn" data-revoke="${esc(k.token)}">REVOKE</button></td>
        </tr>`
          )
          .join("");
  return `
    <table class="gc-table">
      <thead>
        <tr><th>LABEL</th><th>KEY</th><th>CREATED</th><th class="num"></th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="mt-3">
      <input id="key-label" class="gc-input" placeholder="what is it for?" maxlength="64">
      <button id="issue-key" class="gc-btn mt-2">ISSUE NEW KEY</button>
      <span id="keys-error" class="gc-error"></span>
    </p>
    <div id="new-key"></div>
  `;
}

function newKeyNotice(key: string): string {
  return `
    <div class="gc-panel gc-note mt-3">
      <div class="gc-panel-body">
        <p><strong>Copy this now.</strong> It will never be shown again.</p>
        <p class="gc-mono break-all">${esc(key)}</p>
      </div>
    </div>
  `;
}

async function loadKeys(xrpc: XrpcLike) {
  const body = document.getElementById("keys-body");
  if (!body) return;
  let keys: ApiKey[];
  try {
    keys = await listMyKeys(xrpc);
  } catch (e) {
    console.warn("key lookup failed:", e);
    body.innerHTML = `<p class="gc-small">Keys are unavailable right now.</p>`;
    return;
  }
  body.innerHTML = keysTable(keys);

  const showError = (msg: string) => {
    const el = document.getElementById("keys-error");
    if (el) el.textContent = ` ${msg}`;
  };

  document.getElementById("issue-key")?.addEventListener("click", async () => {
    const input = document.getElementById("key-label") as HTMLInputElement;
    const label = input.value.trim();
    if (!label) return showError("Give the key a name first.");
    try {
      const { key } = await issueKey(xrpc, label);
      await loadKeys(xrpc);
      const slot = document.getElementById("new-key");
      if (slot) slot.innerHTML = newKeyNotice(key);
    } catch (e) {
      showError((e as Error).message);
    }
  });

  body.querySelectorAll<HTMLButtonElement>("[data-revoke]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Revoke this key? Anything using it stops working.")) return;
      btn.disabled = true;
      try {
        await revokeKey(xrpc, btn.dataset.revoke!);
        await loadKeys(xrpc);
      } catch (e) {
        btn.disabled = false;
        showError((e as Error).message);
      }
    });
  });
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
  if (state.kind === "active") main.push(usagePanel(), keysPanel());

  content.innerHTML = `
    <div class="gc-col">${main.join("")}</div>
    <aside class="gc-aside">
      ${membershipCard(state, identity)}
      <div id="admin-link"></div>
      <p class="text-center m-0"><button id="signout" class="gc-btn">SIGN OUT</button></p>
    </aside>
  `;

  if (state.kind === "active") {
    loadUsage(xrpc);
    loadKeys(xrpc);
  }

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
