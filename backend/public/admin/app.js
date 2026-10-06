(() => {
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const naira = (k) => "₦" + (k / 100).toLocaleString();
const fmt = (d) => new Date(d).toLocaleString();
const badge = (s) => `<span class="b ${esc(s)}">${esc(s)}</span>`;
let token = sessionStorage.getItem("t"), refresh = sessionStorage.getItem("r"), current = "dashboard";
let uf = {}, locStack = [];

function toast(m, bad) { const t = $("#toast"); t.textContent = m; t.className = "show" + (bad ? " bad" : ""); setTimeout(() => (t.className = ""), 3500); }
const raw = (p, o, tok) => fetch("/api/" + p, { ...o, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined });

async function api(p, o = {}) {
  let r = await raw(p, o, token);
  if (r.status === 401 && refresh) {
    const rr = await raw("auth/refresh", { method: "POST", body: { refreshToken: refresh } });
    if (rr.ok) { token = (await rr.json()).accessToken; sessionStorage.setItem("t", token); r = await raw(p, o, token); }
  }
  if (r.status === 401) { logout(); throw new Error("Session expired"); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || (d.fieldErrors && Object.entries(d.fieldErrors).map(([k, v]) => k + ": " + v).join("; ")) || "Request failed");
  return d;
}

const table = (cols, rows) => `<div class="tw"><table><thead><tr>${cols.map((c) => `<th>${c[0]}</th>`).join("")}</tr></thead><tbody>${
  rows.map((r) => `<tr>${cols.map((c) => `<td>${c[1](r)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${cols.length}" class="muted">Nothing here yet</td></tr>`}</tbody></table></div>`;
const btn = (act, data, label, cls = "") => `<button class="btn sm ${cls}" data-act="${act}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(" ")}>${label}</button>`;

// ───── Views ─────
const views = {
  async dashboard(el) {
    const s = await api("admin/stats");
    const c = (n, l) => `<div class="card"><b>${n}</b><span class="muted">${l}</span></div>`;
    el.innerHTML = `<h2>Overview</h2><div class="cards">${c(s.owners, "Owners")}${c(s.managers, "Managers")}${c(s.tenants, "Tenants")}${c(s.pendingKyc, "Pending verifications")}${c(s.pendingProperties, "Properties awaiting review")}${c(s.suspended, "Suspended / banned")}</div>
      <p class="muted">Property approvals, payments and tickets appear here as those phases are built.</p>`;
  },

  async kyc(el) {
    const status = el.dataset.ks || "PENDING";
    const rows = await api("admin/kyc?status=" + status);
    el.innerHTML = `<h2>Verification queue</h2><div class="row"><select id="ks">${["PENDING", "VERIFIED", "REJECTED", "UNVERIFIED"].map((s) => `<option ${s === status ? "selected" : ""}>${s}</option>`).join("")}</select></div>` +
      table([["Name", (r) => esc(r.user.fullName)], ["Role", (r) => esc(r.user.role)], ["ID type", (r) => esc(r.idType)], ["Submitted", (r) => fmt(r.createdAt)], ["Status", (r) => badge(r.status)], ["", (r) => btn("kycopen", { id: r.id }, "Review")]], rows);
    $("#ks").onchange = (e) => { el.dataset.ks = e.target.value; show("kyc"); };
  },

  async accounts(el) {
    const rows = await api("admin/accounts?status=PENDING_REVIEW");
    el.innerHTML = `<h2>Payment accounts to review</h2><p class="muted">Bank accounts tenants will pay rent into. Review those whose account name differs from the holder's verified name, or whose number is already used by another user.</p>` +
      table([["Holder", (r) => esc(r.user.fullName) + " (" + esc(r.user.role) + ")"], ["KYC", (r) => badge(r.user.kyc?.status || "UNVERIFIED")], ["Bank", (r) => esc(r.bankName)], ["Account name", (r) => esc(r.accountName)], ["Ends in", (r) => esc(r.last4)],
        ["Used by other users", (r) => (r.usedByOtherUsers ? `<b style="color:var(--bad)">${r.usedByOtherUsers}</b>` : "No")],
        ["", (r) => btn("accreveal", { id: r.id }, "Show number", "ghost") + " " + btn("accdec", { id: r.id, d: "APPROVED" }, "Approve") + " " + btn("accdec", { id: r.id, d: "REJECTED" }, "Reject", "danger")]], rows);
  },

  async disputes(el) {
    const rows = await api("admin/tokens?status=DISPUTED");
    el.innerHTML = `<h2>Payment disputes</h2><p class="muted">The platform never holds rent money. Decide from the evidence: confirm the payment (tenant gets the unit) or cancel (unit is freed; any refund is settled between tenant and owner).</p>` +
      table([["Code", (r) => esc(r.code)], ["Unit", (r) => esc(r.unit.title) + "<br><span class=\"muted\">" + esc(r.unit.property.name) + "</span>"], ["Tenant", (r) => esc(r.tenant.fullName) + "<br><span class=\"muted\">" + esc(r.tenant.phone) + "</span>"],
        ["Landlord", (r) => esc(r.unit.property.owner.fullName) + "<br><span class=\"muted\">" + esc(r.unit.property.owner.phone) + "</span>"], ["Amount", (r) => naira(r.totalKobo)],
        ["Paid to", (r) => (r.payTo ? esc(r.payTo.name) + " · " + esc(r.payTo.bankName) + " …" + esc(r.payTo.last4) : "—")], ["Tenant's reference", (r) => esc(r.claimReference || "—")], ["Why disputed", (r) => esc(r.disputeReason || "—")],
        ["", (r) => (r.hasProof ? btn("proof", { id: r.id }, "View proof", "ghost") + " " : "") + btn("resolve", { id: r.id, o: "CONFIRM_PAID" }, "Confirm paid") + " " + btn("resolve", { id: r.id, o: "CANCEL" }, "Cancel", "danger")]], rows);
  },

  async users(el) {
    const q = new URLSearchParams(Object.entries(uf).filter(([, v]) => v)).toString();
    const rows = await api("admin/users?" + q);
    el.innerHTML = `<h2>Users</h2><form data-form="users-filter" class="row"><input name="q" placeholder="Search name/email" value="${esc(uf.q || "")}">
      <select name="role"><option value="">All roles</option>${["OWNER", "MANAGER", "TENANT", "ADMIN"].map((r) => `<option ${uf.role === r ? "selected" : ""}>${r}</option>`).join("")}</select>
      <select name="status"><option value="">Any status</option>${["ACTIVE", "SUSPENDED", "BANNED"].map((r) => `<option ${uf.status === r ? "selected" : ""}>${r}</option>`).join("")}</select><button>Filter</button></form>` +
      table([["Name", (r) => esc(r.fullName)], ["Email", (r) => esc(r.email)], ["Phone", (r) => esc(r.phone)], ["Role", (r) => esc(r.role)], ["KYC", (r) => badge(r.kyc?.status || "—")], ["Status", (r) => badge(r.status)],
        ["", (r) => r.role === "ADMIN" ? "" : r.status === "ACTIVE" ? btn("ustatus", { id: r.id, s: "SUSPENDED" }, "Suspend", "ghost") + " " + btn("ustatus", { id: r.id, s: "BANNED" }, "Ban", "danger") : btn("ustatus", { id: r.id, s: "ACTIVE" }, "Reactivate", "ghost")]], rows);
  },

  features: (el) => crud(el, "features", "Features", true),
  unitTypes: (el) => crud(el, "unit-types", "Unit types", false),

  async locations(el) {
    const top = locStack[locStack.length - 1];
    const rows = await api("admin/locations" + (top ? "?parentId=" + top.id : ""));
    const crumbs = [`<a href="#" data-act="locgo" data-i="-1">Nigeria</a>`, ...locStack.map((l, i) => `<a href="#" data-act="locgo" data-i="${i}">${esc(l.name)}</a>`)].join(" › ");
    const levels = ["STATE", "LGA", "CITY", "AREA"], next = levels[Math.min(locStack.length, 3)];
    el.innerHTML = `<h2>Locations</h2><p>${crumbs}</p><form data-form="add-location" class="row"><input name="name" placeholder="New ${next.toLowerCase()} name" required>
      <select name="level">${levels.map((l) => `<option ${l === next ? "selected" : ""}>${l}</option>`).join("")}</select><button>Add</button></form>` +
      table([["Name", (r) => esc(r.name)], ["Level", (r) => esc(r.level)], ["Status", (r) => badge(r.active ? "ACTIVE" : "DISABLED")],
        ["", (r) => btn("locopen", { id: r.id, name: r.name }, "Open", "ghost") + " " + btn("toggle", { path: "locations", id: r.id, active: r.active }, r.active ? "Disable" : "Enable", "ghost")]], rows);
  },

  async tiers(el) {
    const rows = await api("admin/fee-tiers");
    el.innerHTML = `<h2>Yearly onboarding fees</h2><p class="muted">Paid once a year by the landlord, per property. Tenants never pay this.</p>
      <form data-form="add-tier" class="row"><input name="name" placeholder="Tier name" required><select name="kind"><option>HOUSE</option><option>BUILDING</option><option value="ESTATE">ESTATE (individually owned)</option></select>
      <input name="minUnits" type="number" min="1" value="1" style="width:90px" title="Min units"><input name="maxUnits" type="number" min="1" placeholder="Max units" style="width:110px">
      <input name="amountNaira" type="number" min="1" placeholder="Amount ₦" required style="width:130px"><button>Add tier</button></form>` +
      table([["Tier", (r) => esc(r.name)], ["Type", (r) => esc(r.kind)], ["Units", (r) => `${r.minUnits}–${r.maxUnits ?? "∞"}`], ["Yearly fee", (r) => naira(r.amountKobo)], ["Status", (r) => badge(r.active ? "ACTIVE" : "DISABLED")],
        ["", (r) => btn("tieramt", { id: r.id }, "Edit price", "ghost") + " " + btn("toggle", { path: "fee-tiers", id: r.id, active: r.active }, r.active ? "Disable" : "Enable", "ghost")]], rows);
  },

  async properties(el) {
    const status = el.dataset.ps || "PENDING_REVIEW";
    const rows = await api("admin/properties?status=" + status);
    const sts = ["PENDING_REVIEW", "VERIFIED", "ACTIVE", "NEEDS_CHANGES", "REJECTED", "EXPIRED", "DOCS_UPLOADED", "DRAFT"];
    el.innerHTML = `<h2>Property approvals</h2><select id="ps">${sts.map((x) => `<option ${x === status ? "selected" : ""}>${x}</option>`).join("")}</select>` +
      table([["Property", (r) => esc(r.name)], ["Type", (r) => esc(r.kind)], ["Owner", (r) => esc(r.owner.fullName)], ["Location", (r) => esc(r.location.name)], ["Units", (r) => r.declaredUnits], ["Status", (r) => badge(r.status)], ["", (r) => btn("propopen", { id: r.id }, "Open")]], rows);
    $("#ps").onchange = (e) => { el.dataset.ps = e.target.value; show("properties"); };
  },

  async audit(el) {
    const rows = await api("admin/audit-logs");
    el.innerHTML = `<h2>Audit log</h2>` + table([["When", (r) => fmt(r.createdAt)], ["Admin", (r) => esc(r.actor.fullName)], ["Action", (r) => esc(r.action)], ["Entity", (r) => esc(r.entity)], ["IP", (r) => esc(r.ip)]], rows);
  },
};

async function crud(el, path, title, cat) {
  const rows = await api("admin/" + path);
  el.innerHTML = `<h2>${title}</h2><form data-form="add-${path}" class="row"><input name="name" placeholder="Name" required>${cat ? `<input name="category" placeholder="Category (e.g. Utilities)">` : ""}<button>Add</button></form>` +
    table([["Name", (r) => esc(r.name)], ...(cat ? [["Category", (r) => esc(r.category || "—")]] : []), ["Status", (r) => badge(r.active ? "ACTIVE" : "DISABLED")],
      ["", (r) => btn("toggle", { path, id: r.id, active: r.active }, r.active ? "Disable" : "Enable", "ghost")]], rows);
}

// ───── KYC review screen ─────
async function openKyc(id) {
  const k = await api("admin/kyc/" + id), el = $("#main");
  const pending = k.status === "PENDING";
  el.innerHTML = `<h2>Review: ${esc(k.user.fullName)}</h2><p><a href="#" data-act="back">← Back to queue</a></p>
    <div class="card"><div class="row"><b>${esc(k.user.role)}</b>${badge(k.status)}</div><p>${esc(k.user.email)} · ${esc(k.user.phone)}<br>ID type: ${esc(k.idType)} · Bank account name: ${esc(k.bankAccountName || "—")}<br>Registered ${fmt(k.user.createdAt)} · Submitted ${fmt(k.createdAt)}</p>
    ${k.rejectReason ? `<p class="muted">Last note: ${esc(k.rejectReason)}</p>` : ""}</div>
    <h3>Documents</h3><div class="docs"><div class="card"><b>Government ID</b><div data-file="${esc(k.idDocumentUrl)}">Loading…</div></div><div class="card"><b>Selfie</b><div data-file="${esc(k.selfieUrl)}">Loading…</div></div></div>` +
    (pending ? `<h3>Decision</h3><div class="card"><label><input type="checkbox" id="c1"> Name on ID matches the registered name (and bank account name)</label><br>
      <label><input type="checkbox" id="c2"> Selfie matches the photo on the ID</label><br><label><input type="checkbox" id="c3"> Document looks genuine and is not expired</label>
      <p><textarea id="notes" rows="3" style="width:100%" placeholder="Notes (required for reject / need more info; shown to the user)"></textarea></p>
      <label><input type="checkbox" id="bl"> Confirmed fraud: blacklist this ID, phone and email, and ban the account</label>
      <p class="row">${btn("decide", { id, d: "APPROVED" }, "Approve")} ${btn("decide", { id, d: "NEEDS_INFO" }, "Need more info", "ghost")} ${btn("decide", { id, d: "REJECTED" }, "Reject", "danger")}</p></div>` : "");
  el.querySelectorAll("[data-file]").forEach(async (box) => {
    try {
      const r = await raw("admin/files/" + box.dataset.file, {}, token), blob = await r.blob(), url = URL.createObjectURL(blob);
      box.innerHTML = blob.type.includes("pdf") ? `<a href="${url}" target="_blank">Open PDF</a>` : `<img alt="document" src="${url}">`;
    } catch { box.textContent = "Could not load file"; }
  });
}

async function loadFiles(el) {
  el.querySelectorAll("[data-file]").forEach(async (box) => {
    try {
      const r = await raw("admin/files/" + box.dataset.file, {}, token), blob = await r.blob(), url = URL.createObjectURL(blob);
      box.innerHTML = blob.type.includes("pdf") ? `<a href="${url}" target="_blank">Open PDF</a>` : `<img alt="document" src="${url}">`;
    } catch { box.textContent = "Could not load file"; }
  });
}
async function openProperty(id) {
  const p = await api("admin/properties/" + id), el = $("#main"), pending = p.status === "PENDING_REVIEW";
  const ob = p.onboardings.find((o) => o.paidAt);
  el.innerHTML = `<h2>${esc(p.name)} ${badge(p.status)}</h2><p><a href="#" data-act="propback">← Back</a></p>
    <div class="card"><p><b>${esc(p.kind === "ESTATE" ? "INDIVIDUALLY-OWNED ESTATE" : p.kind)}</b> · ${p.declaredUnits} unit(s) · ${esc(p.address)}, ${esc(p.location.name)}${p.estateName ? " · Estate: " + esc(p.estateName) : ""}<br>${p.children.length ? "Houses in this estate: " + p.children.map((c) => esc(c.name) + " (" + c.declaredUnits + " units)").join(", ") + "<br>" : ""}
    Owner: ${esc(p.owner.fullName)} (${esc(p.owner.email)}, ${esc(p.owner.phone)}) ${badge(p.owner.kyc?.status || "UNVERIFIED")}<br>
    Yearly fee: ${ob ? `${naira(ob.amountKobo)} paid ${fmt(ob.paidAt)}${ob.expiresAt ? " · expires " + fmt(ob.expiresAt) : ""}` : p.feeDue ? `${naira(p.feeDue.amountKobo)} (${esc(p.feeDue.name)}), payable after verification` : "<b>No fee tier matches this property</b>"}</p>
    ${p.possibleDuplicates.length ? `<p style="color:var(--bad)"><b>⚠ Possible duplicate:</b> ${p.possibleDuplicates.map((d) => esc(d.name) + " (" + esc(d.status) + ")").join(", ")}</p>` : ""}</div>
    <h3>Ownership documents</h3><div class="docs">${p.documents.map((d) => `<div class="card"><b>${esc(d.docType)}</b> ${badge(d.status)}<div data-file="${esc(d.fileUrl)}">Loading…</div>${d.rejectReason ? `<p class="muted">${esc(d.rejectReason)}</p>` : ""}
      ${d.status === "PENDING" ? `<p class="row">${btn("docdec", { id: p.id, doc: d.id, d: "APPROVED" }, "Approve")} ${btn("docdec", { id: p.id, doc: d.id, d: "REJECTED" }, "Reject", "danger")}</p>` : ""}</div>`).join("") || '<p class="muted">No documents</p>'}</div>` +
    (p.authLetters.length ? `<h3>Manager authorisation letters</h3><div class="docs">${p.authLetters.map((a) => `<div class="card"><b>${esc(a.manager.fullName)}</b> ${badge(a.manager.kyc?.status || "UNVERIFIED")}<div data-file="${esc(a.documentUrl)}">Loading…</div>
      <p class="row">${btn("authdec", { id: a.id, p: p.id, d: "APPROVED" }, "Approve")} ${btn("authdec", { id: a.id, p: p.id, d: "REJECTED" }, "Reject", "danger")}</p></div>`).join("")}</div>` : "") +
    (pending ? `<h3>Decision</h3><div class="card"><label><input type="checkbox" id="k1"> Owner is identity-verified and matches the ownership documents</label><br><label><input type="checkbox" id="k2"> Documents look genuine</label><br>
      <label><input type="checkbox" id="k3"> Address and location match the documents</label><br><label><input type="checkbox" id="k4"> Not a duplicate of another listing</label>
      <p><textarea id="notes" rows="3" style="width:100%" placeholder="Notes (required unless approving; shown to the owner)"></textarea></p>
      <p class="row">${btn("propdec", { id: p.id, d: "APPROVED" }, "Verify property")} ${btn("propdec", { id: p.id, d: "NEEDS_CHANGES" }, "Needs changes", "ghost")} ${btn("propdec", { id: p.id, d: "REJECTED" }, "Reject", "danger")}</p></div>` : "") +
    (["ACTIVE", "EXPIRED"].includes(p.status) ? `<h3>Overrides</h3><p class="row">${btn("extend", { id: p.id }, "Extend period", "ghost")} ${btn("revoke", { id: p.id }, "Revoke / hide", "danger")}</p>` : "");
  loadFiles(el);
}

// ───── Event handling (no inline handlers: strict CSP) ─────
const run = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
const actions = {
  kycopen: (d) => openKyc(d.id),
  propopen: (d) => openProperty(d.id),
  propback: () => show("properties"),
  async docdec(d) {
    const reason = d.d === "REJECTED" ? prompt("Reason for rejecting this document?") : undefined;
    if (d.d === "REJECTED" && !reason) return;
    await api(`admin/properties/${d.id}/documents/${d.doc}/decision`, { method: "POST", body: { decision: d.d, reason } }); openProperty(d.id);
  },
  async authdec(d) { await api(`admin/authorisations/${d.id}/decision`, { method: "POST", body: { decision: d.d } }); openProperty(d.p); },
  async propdec(d) {
    const body = { decision: d.d, notes: $("#notes").value, checklist: { ownerVerified: $("#k1").checked, docsGenuine: $("#k2").checked, addressMatches: $("#k3").checked, noDuplicate: $("#k4").checked } };
    if (d.d === "REJECTED" && !confirm("Reject this property?")) return;
    await api(`admin/properties/${d.id}/decision`, { method: "POST", body }); toast("Decision saved"); show("properties");
  },
  async extend(d) {
    const days = Number(prompt("Extend by how many days?")), reason = days ? prompt("Reason?") : null; if (!days || !reason) return;
    await api(`admin/properties/${d.id}/extend`, { method: "POST", body: { days, reason } }); toast("Extended"); openProperty(d.id);
  },
  async revoke(d) {
    const reason = prompt("Reason for hiding this property?"); if (!reason) return;
    await api(`admin/properties/${d.id}/revoke`, { method: "POST", body: { reason } }); toast("Property hidden"); openProperty(d.id);
  },
  async accreveal(d) { const r = await api(`admin/accounts/${d.id}/reveal`); alert("Account number: " + r.accountNumber + "\n\n(This view has been logged.)"); },
  async accdec(d) {
    const reason = d.d === "REJECTED" ? prompt("Reason (shown to the account holder)?") : undefined;
    if (d.d === "REJECTED" && !reason) return;
    await api(`admin/accounts/${d.id}/decision`, { method: "POST", body: { decision: d.d, reason } }); toast("Saved"); show("accounts");
  },
  async proof(d) {
    const r = await raw(`tokens/${d.id}/proof`, {}, token); if (!r.ok) throw new Error("Could not load proof");
    const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.target = "_blank"; a.rel = "noopener"; a.click();
  },
  async resolve(d) {
    const notes = prompt(d.o === "CONFIRM_PAID" ? "Why are you confirming this payment? (kept on record, shown to both sides)" : "Why are you cancelling? (shown to both sides)");
    if (!notes) return;
    await api(`admin/tokens/${d.id}/resolve`, { method: "POST", body: { outcome: d.o, notes } }); toast("Dispute resolved"); show("disputes");
  },
  back: () => show("kyc"),
  async decide(d) {
    const body = { decision: d.d, notes: $("#notes").value, checklist: { nameMatches: $("#c1").checked, selfieMatches: $("#c2").checked, documentGenuine: $("#c3").checked }, blacklist: $("#bl").checked };
    if (body.blacklist && !confirm("This bans the user and blacklists their identity. Continue?")) return;
    await api(`admin/kyc/${d.id}/decision`, { method: "POST", body }); toast("Decision saved"); show("kyc");
  },
  async toggle(d) { await api(`admin/${d.path}/${d.id}`, { method: "PATCH", body: { active: d.active !== "true" } }); show(current); },
  async ustatus(d) {
    const reason = d.s === "ACTIVE" ? "Reactivated by admin" : prompt(`Reason for ${d.s.toLowerCase()}?`);
    if (!reason) return; await api(`admin/users/${d.id}/status`, { method: "PATCH", body: { status: d.s, reason } }); show("users");
  },
  locopen: (d) => { locStack.push({ id: d.id, name: d.name }); show("locations"); },
  locgo: (d) => { locStack = locStack.slice(0, Number(d.i) + 1); show("locations"); },
  async tieramt(d) {
    const v = Number(prompt("New yearly fee in ₦:")); if (!v) return;
    await api("admin/fee-tiers/" + d.id, { method: "PATCH", body: { amountNaira: v } }); show("tiers");
  },
};
const forms = {
  "add-features": async (f) => { await api("admin/features", { method: "POST", body: f }); show("features"); },
  "add-unit-types": async (f) => { await api("admin/unit-types", { method: "POST", body: { name: f.name } }); show("unitTypes"); },
  "add-location": async (f) => { const top = locStack[locStack.length - 1]; await api("admin/locations", { method: "POST", body: { ...f, parentId: top?.id } }); show("locations"); },
  "add-tier": async (f) => {
    await api("admin/fee-tiers", { method: "POST", body: { name: f.name, kind: f.kind, minUnits: Number(f.minUnits) || 1, maxUnits: f.maxUnits ? Number(f.maxUnits) : null, amountNaira: Number(f.amountNaira) } });
    show("tiers");
  },
  "users-filter": async (f) => { uf = f; show("users"); },
};

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  e.preventDefault(); run(actions[b.dataset.act])(b.dataset);
});
document.addEventListener("submit", (e) => {
  e.preventDefault(); const f = e.target;
  if (f.dataset.form === "login") return run(login)(Object.fromEntries(new FormData(f)));
  run(forms[f.dataset.form])(Object.fromEntries(new FormData(f)));
});
$("#nav").addEventListener("click", (e) => { const v = e.target.dataset.v; if (v) { if (v === "locations") locStack = []; show(v); } });
$("#logout").onclick = logout;

async function show(v) {
  current = v; const el = $("#main");
  document.querySelectorAll("#nav [data-v]").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
  el.innerHTML = '<p class="muted">Loading…</p>';
  try { await views[v](el); } catch (e) { el.innerHTML = ""; toast(e.message, true); }
}
async function login(f) {
  const r = await raw("auth/login", { method: "POST", body: f }), d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Sign in failed");
  if (d.user.role !== "ADMIN") throw new Error("Admin access only");
  token = d.accessToken; refresh = d.refreshToken; sessionStorage.setItem("t", token); sessionStorage.setItem("r", refresh); start();
}
function logout() { sessionStorage.clear(); token = refresh = null; $("#app").style.display = "none"; $("#login").style.display = "block"; }
function start() { $("#login").style.display = "none"; $("#app").style.display = "block"; show("dashboard"); }
if (token) start();
})();
