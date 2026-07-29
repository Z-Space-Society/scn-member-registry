import {
  approveMember,
  listRequests,
  type ApplicationRow,
  type XrpcLike,
} from "../membership";
import { esc, fmtDate, resolveHandle } from "../shell";

function row(app: ApplicationRow, i: number): string {
  return `
    <tr>
      <td><span id="handle-${i}" class="gc-mono">${esc(app.did)}</span></td>
      <td>${fmtDate(app.createdAt)}</td>
      <td>${app.note ? esc(app.note) : "<span class='gc-small'>(no note)</span>"}</td>
      <td class="num">
        <button class="gc-btn" data-approve="${esc(app.did)}">APPROVE</button>
      </td>
    </tr>
  `;
}

export async function renderAdminView(content: HTMLElement, xrpc: XrpcLike) {
  content.innerHTML = `<div class="gc-col"><p>Loading applications...</p></div>`;

  let apps: ApplicationRow[];
  try {
    apps = await listRequests(xrpc);
  } catch (e) {
    content.innerHTML = `
      <div class="gc-col">
        <section class="gc-panel">
          <div class="gc-panel-title">APPLICATIONS</div>
          <div class="gc-panel-body">
            <p class="gc-error">Could not list applications: <code>${esc((e as Error).message)}</code></p>
            <p class="gc-small">The listRequests lexicon and Lua script may not be deployed yet.</p>
          </div>
        </section>
      </div>`;
    return;
  }

  content.innerHTML = `
    <div class="gc-col" style="grid-column: 1 / -1;">
      <section class="gc-panel">
        <div class="gc-panel-title"><span>APPLICATIONS</span><span class="gc-mono" style="font-size: 11px; color: #99ccff;">${apps.length} ON FILE</span></div>
        <div class="gc-panel-body">
          ${
            apps.length === 0
              ? "<p>No applications yet.</p>"
              : `<table class="gc-table">
                  <thead><tr><th>APPLICANT</th><th>DATE</th><th>NOTE</th><th class="num"></th></tr></thead>
                  <tbody>${apps.map(row).join("")}</tbody>
                </table>`
          }
          <p id="admin-result" class="gc-small"></p>
          <p class="gc-small"><a href="#">← back to member area</a></p>
        </div>
      </section>
    </div>
  `;

  apps.forEach((app, i) => {
    resolveHandle(app.did).then((handle) => {
      const el = document.getElementById(`handle-${i}`);
      if (el && handle !== app.did) el.textContent = `${handle} (${app.did})`;
    });
  });

  content.querySelectorAll<HTMLButtonElement>("[data-approve]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const did = btn.dataset.approve!;
      const result = document.getElementById("admin-result")!;
      btn.disabled = true;
      try {
        const res = await approveMember(xrpc, did);
        result.textContent = `Approved ${did}${res.uri ? ` (${res.uri})` : ""}`;
      } catch (e) {
        btn.disabled = false;
        result.innerHTML = `<span class="gc-error">Approval failed: ${esc((e as Error).message)}</span>`;
      }
    });
  });
}
