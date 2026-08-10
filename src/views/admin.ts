import {
  activeMembers,
  approveMember,
  listMembers,
  listRequests,
  type ApplicationRow,
  type XrpcLike,
} from "../membership";
import {
  getRoster,
  isCurrentAdmin,
  saveRoster,
  setSpaceAccess,
  withAdminAdded,
  withAdminRemoved,
  type AdminEntry,
} from "../adminList";
import {
  createRegistrySpace,
  findRegistrySpace,
  listSpaces,
} from "../spaces";
import { esc, fmtDate, resolveHandle, type Identity } from "../shell";

/**
 * Space setup panel, shown only to the service identity.
 */
function spacePanel(
  uri: string | null | Error,
  configured?: string
): string {
  let body: string;
  if (uri instanceof Error) {
    body = `<p class="gc-error">Could not list spaces: <code>${esc(uri.message)}</code></p>
            <p class="gc-small">If this says the spaces feature is disabled, run <code>npm run deploy</code>.</p>`;
  } else if (uri) {
    const matches = configured === uri;
    body = `
      <p>Registry space exists:</p>
      <p><code class="gc-mono">${esc(uri)}</code></p>
      ${
        matches
          ? `<p class="gc-small">Matches your configured REGISTRY_SPACE_URI.</p>`
          : `<p class="gc-error">Not yet configured. Put this in .env as
             <code>VITE_REGISTRY_SPACE_URI</code> and run <code>npm run deploy</code>
             so the Lua scripts can read it.</p>`
      }
    `;
  } else {
    body = `
      <p>No registry space yet. Creating it fixes this identity as its
      authority permanently — the space cannot be migrated later.</p>
      <button id="create-space" class="gc-btn">CREATE REGISTRY SPACE</button>
      <span id="space-error" class="gc-error"></span>
    `;
  }
  return `
    <section class="gc-panel">
      <div class="gc-panel-title"><span>REGISTRY SPACE</span></div>
      <div class="gc-panel-body">${body}</div>
    </section>
  `;
}

function row(app: ApplicationRow, i: number, isMember: boolean): string {
  return `
    <tr>
      <td><span id="handle-${i}" class="gc-mono">${esc(app.did)}</span></td>
      <td>${fmtDate(app.createdAt)}</td>
      <td>${app.note ? esc(app.note) : "<span class='gc-small'>(no note)</span>"}</td>
      <td class="num">${
        isMember
          ? "<strong>MEMBER</strong>"
          : `<button class="gc-btn" data-approve="${esc(app.did)}">APPROVE</button>`
      }</td>
    </tr>
  `;
}

function rosterRow(entry: AdminEntry, i: number): string {
  const status = entry.removedAt
    ? `removed ${fmtDate(entry.removedAt)}`
    : "ACTIVE";
  return `
    <tr>
      <td><span id="roster-handle-${i}">...</span></td>
      <td class="gc-mono">${esc(entry.did)}</td>
      <td>${fmtDate(entry.addedAt)}</td>
      <td>${esc(status)}</td>
      <td class="num">${
        entry.removedAt
          ? ""
          : `<button class="gc-btn" data-remove-admin="${esc(entry.did)}">REMOVE</button>`
      }</td>
    </tr>
  `;
}

function rosterPanel(
  roster: AdminEntry[] | null | Error,
  identity: Identity,
  serviceDid?: string,
  saved = false
): string {
  const savedNotice = saved
    ? `<p class="gc-small">Roster saved to the service repo. The index can lag behind; this view reflects your write.</p>`
    : "";
  let body: string;
  if (!serviceDid) {
    body = `<p class="gc-small">Set <code>VITE_SERVICE_DID</code> to manage the admin roster.</p>`;
  } else if (roster instanceof Error) {
    body = `<p class="gc-error">Could not load the roster: <code>${esc(roster.message)}</code></p>`;
  } else if (roster === null) {
    body = `
      <p>No roster record exists yet. Until one does, only the bootstrap admin
      (script env <code>BOOTSTRAP_ADMIN_DID</code>) has authority.</p>
      <button id="create-roster" class="gc-btn">CREATE ROSTER WITH ME ON IT</button>
      <span id="roster-error" class="gc-error"></span>
    `;
  } else {
    body = `
      <table class="gc-table">
        <thead><tr><th>HANDLE</th><th>DID</th><th>ADDED</th><th>STATUS</th><th class="num"></th></tr></thead>
        <tbody>${roster.map(rosterRow).join("")}</tbody>
      </table>
      <p class="mt-3">
        <input id="new-admin-did" class="gc-input" placeholder="did:plc:...">
        <button id="add-admin" class="gc-btn mt-2">ADD ADMIN</button>
        <span id="roster-error" class="gc-error"></span>
      </p>
    `;
  }
  const foreignWarning =
    serviceDid && identity.did !== serviceDid
      ? `<p class="gc-small gc-error">You are not signed in as the service DID: roster writes would land in your own repo and be ignored.</p>`
      : "";
  return `
    <section class="gc-panel">
      <div class="gc-panel-title"><span>ADMIN ROSTER</span></div>
      <div class="gc-panel-body">${foreignWarning}${savedNotice}${body}</div>
    </section>
  `;
}

export async function renderAdminView(
  content: HTMLElement,
  xrpc: XrpcLike,
  identity: Identity,
  serviceDid?: string,
  registrySpaceUri?: string,
  rosterJustSaved?: AdminEntry[]
) {
  content.innerHTML = `<div class="gc-col"><p>Loading applications...</p></div>`;
  const isServiceIdentity = Boolean(serviceDid && identity.did === serviceDid);

  const [apps, roster, space, events] = await Promise.all([
    listRequests(xrpc).catch((e: Error) => e),
    rosterJustSaved
      ? Promise.resolve(rosterJustSaved)
      : serviceDid
        ? getRoster(serviceDid).catch((e: Error) => e)
        : Promise.resolve(null),
    isServiceIdentity
      ? listSpaces(xrpc, identity.did)
          .then(findRegistrySpace)
          .catch((e: Error) => e)
      : Promise.resolve(null),
    listMembers(xrpc).catch((e: Error) => {
      console.warn("member lookup failed:", e);
      return null;
    }),
  ]);

  // Applicants already granted membership; null means the lookup failed, in
  // which case every row keeps its APPROVE button (approval is idempotent).
  const members =
    events && Array.isArray(roster)
      ? activeMembers(events, roster.map((e) => e.did))
      : null;

  const appsPanel =
    apps instanceof Error
      ? `<section class="gc-panel">
          <div class="gc-panel-title">APPLICATIONS</div>
          <div class="gc-panel-body">
            <p class="gc-error">Could not list applications: <code>${esc(apps.message)}</code></p>
            <p class="gc-small">The listRequests lexicon and Lua script may not be deployed yet.</p>
          </div>
        </section>`
      : `<section class="gc-panel">
          <div class="gc-panel-title"><span>APPLICATIONS</span><span class="gc-mono text-[11px] text-[#99ccff]">${apps.length} ON FILE</span></div>
          <div class="gc-panel-body">
            ${
              apps.length === 0
                ? "<p>No applications yet.</p>"
                : `<table class="gc-table">
                    <thead><tr><th>APPLICANT</th><th>DATE</th><th>NOTE</th><th class="num"></th></tr></thead>
                    <tbody>${apps
                      .map((a, i) => row(a, i, Boolean(members?.has(a.did))))
                      .join("")}</tbody>
                  </table>`
            }
            <p id="admin-result" class="gc-small"></p>
          </div>
        </section>`;

  content.innerHTML = `
    <div class="gc-col col-span-full">
      ${appsPanel}
      ${rosterPanel(roster, identity, serviceDid, Boolean(rosterJustSaved))}
      ${isServiceIdentity ? spacePanel(space, registrySpaceUri) : ""}
      <p class="gc-small"><a href="#">← back to member area</a></p>
    </div>
  `;

  document.getElementById("create-space")?.addEventListener("click", async () => {
    const btn = document.getElementById("create-space") as HTMLButtonElement;
    btn.disabled = true;
    try {
      await createRegistrySpace(xrpc);
      renderAdminView(content, xrpc, identity, serviceDid, registrySpaceUri);
    } catch (e) {
      btn.disabled = false;
      document.getElementById("space-error")!.textContent = ` ${(e as Error).message}`;
    }
  });

  const rosterError = (msg: string) => {
    const el = document.getElementById("roster-error");
    if (el) el.textContent = ` ${msg}`;
  };
  const entries = Array.isArray(roster) ? roster : [];
  const save = async (next: AdminEntry[]) => {
    await saveRoster(xrpc, identity.did, next);
    rerenderWith(next);
  };

  document.getElementById("create-roster")?.addEventListener("click", async () => {
    try {
      await save([{ did: identity.did, addedAt: new Date().toISOString() }]);
    } catch (e) {
      rosterError((e as Error).message);
    }
  });

  // Adding an admin is two halves: the roster entry (authorization) and
  // space write membership (ability). Re-adding an existing admin skips the
  // roster write and just syncs space access, which makes a half-completed
  // add repairable by clicking ADD again.
  const rerenderWith = (next: AdminEntry[]) =>
    renderAdminView(content, xrpc, identity, serviceDid, registrySpaceUri, next);

  // Space membership sync can fail independently of the roster write (the
  // deployed HappyView may lack the Lua spaces write API). The roster is the
  // authority record, so keep its result and surface the sync failure with
  // the fallback instructions.
  const syncAccess = async (did: string, access: "write" | "none", next: AdminEntry[]) => {
    try {
      await setSpaceAccess(xrpc, did, access);
      rerenderWith(next);
    } catch (e) {
      rosterError(
        `Roster updated, but space access sync failed (${(e as Error).message}). ` +
          `Use the invite flow (createInvite/acceptInvite) to ${access === "write" ? "grant" : "revoke"} space membership.`
      );
    }
  };

  document.getElementById("add-admin")?.addEventListener("click", async () => {
    const did = (document.getElementById("new-admin-did") as HTMLInputElement).value.trim();
    const already = isCurrentAdmin(entries, did);
    let next = entries;
    try {
      if (!already) {
        next = withAdminAdded(entries, did, new Date().toISOString());
        await saveRoster(xrpc, identity.did, next);
      }
    } catch (e) {
      rosterError((e as Error).message);
      return;
    }
    await syncAccess(did, "write", next);
  });

  content.querySelectorAll<HTMLButtonElement>("[data-remove-admin]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const did = btn.dataset.removeAdmin!;
      if (did === identity.did && !confirm("Remove yourself from the roster?")) return;
      let next: AdminEntry[];
      try {
        next = withAdminRemoved(entries, did, new Date().toISOString());
        await saveRoster(xrpc, identity.did, next);
      } catch (e) {
        rosterError((e as Error).message);
        return;
      }
      await syncAccess(did, "none", next);
    });
  });

  if (!(apps instanceof Error)) {
    apps.forEach((app, i) => {
      resolveHandle(app.did).then((handle) => {
        const el = document.getElementById(`handle-${i}`);
        if (el && handle !== app.did) el.textContent = `${handle} (${app.did})`;
      });
    });
  }

  if (Array.isArray(roster)) {
    roster.forEach((entry, i) => {
      resolveHandle(entry.did).then((handle) => {
        const el = document.getElementById(`roster-handle-${i}`);
        if (el) el.textContent = handle !== entry.did ? handle : "?";
      });
    });
  }

  content.querySelectorAll<HTMLButtonElement>("[data-approve]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const did = btn.dataset.approve!;
      const result = document.getElementById("admin-result")!;
      btn.disabled = true;
      result.textContent = `Approving ${did}...`;
      try {
        await approveMember(xrpc, did);
        renderAdminView(content, xrpc, identity, serviceDid, registrySpaceUri);
      } catch (e) {
        btn.disabled = false;
        result.innerHTML = `<span class="gc-error">Approval failed: ${esc((e as Error).message)}</span>`;
      }
    });
  });
}
