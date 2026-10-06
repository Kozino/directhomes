const EXTRA = {}, FORMS = {};
const L = (l, inner) => `<label>${l}${inner}</label>`;
const inp = (n, l, t = "text", x = "") => L(l, `<input name="${n}" type="${t}" ${x}>`);
const opts = (a) => a.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join("");
const up = (file, path = "verify/upload") => { const f = new FormData(); f.append("file", file); return api(path, { form: f }); };
const deep = (o) => `<ul>${Object.entries(o || {}).map(([k, v]) => `<li>${esc(k)}: ${v && typeof v === "object" ? deep(v) : `<b>${esc(v)}</b>`}</li>`).join("")}</ul>`;
async function locs(box, set) {
  let pid = ""; box.innerHTML = "";
  const level = async () => {
    const rows = await api("public/locations" + (pid ? "?parentId=" + pid : "")); if (!rows.length) return;
    const s = document.createElement("select"); s.innerHTML = `<option value="">Choose…</option>` + opts(rows.map((r) => [r.id, r.name]));
    s.onchange = async () => { while (s.nextSibling) s.nextSibling.remove(); if (s.value) { set(s.value); pid = s.value; await level(); } };
    box.append(s);
  };
  await level();
}
const phoneCard = () => `<div class="card"><h3>Verify your phone</h3><div class="row">${btn("otp", "", "Send code")}<input id="otp" placeholder="6-digit code">${btn("otpok", "", "Confirm")}</div><p class="muted">Email verification will be added once our own domain is ready.</p></div>`;

function nav() {
  const u = user(), r = u?.role, l = (h, t) => `<a href="#/${h}">${t}</a>`; let x = l("search", "Search");
  if (!u) x += l("login", "Sign in") + l("register", "Register");
  else {
    x += l("dash", "Dashboard");
    if (r === "TENANT") x += l("verify", "Verify phone") + l("news", "Notices");
    if (r === "OWNER" || r === "MANAGER") x += l("onboard", "Get verified") + (r === "OWNER" ? l("pnew", "Add property") : "") + l("unitnew", "Add unit") + l("announce", "Notices") + l("insights", "Reports");
    if (r === "ADMIN") x += l("a/overview", "Admin");
    x += l("notes", "Alerts") + `<a href="#" data-a="logout">Sign out</a>`;
  }
  document.getElementById("nav").innerHTML = x;
}

// ---------- public pages ----------
EXTRA.home = () => {
  app.innerHTML = `<div class="hero"><h1>Rent directly from the owner.</h1><p>No agents. No viewing fees. No hidden mark-ups. Every owner and property is verified.</p><form id="hf" class="row" style="justify-content:center"><input name="q" placeholder="Area or city, e.g. Lekki"><button>Search homes</button></form></div>
  <h3>How it works</h3><div class="grid"><div class="card"><b>1. Search</b><p>Browse verified homes. The price you see is the price the owner set.</p></div><div class="card"><b>2. Talk and view</b><p>Message the owner and book a viewing. It is always free.</p></div><div class="card"><b>3. Get a payment token</b><p>The owner approves you, holds the unit, and you pay the owner's bank account directly.</p></div><div class="card"><b>4. Move in and stay supported</b><p>Report issues, track repairs and renew from the same app.</p></div></div>
  <h3>Own or manage property?</h3><div class="card"><p>Get verified, add your property, and pay one yearly fee per property once it is approved. Tenants never pay us anything.</p><a href="#/register"><button>List your property</button></a></div>`;
  document.getElementById("hf").onsubmit = (e) => { e.preventDefault(); location.hash = "#/search?q=" + encodeURIComponent(new FormData(e.target).get("q")); };
};
const legal = (t, body) => (app.innerHTML = `<div class="card"><h2>${t}</h2>${body}<p class="muted">Draft text. Have a Nigerian lawyer review it before launch.</p></div>`);
EXTRA.terms = () => legal("Terms of service", "<p>Direct Homes connects tenants with verified owners and managers. We do not charge tenants and we do not take any part of your rent. Rent is paid by bank transfer directly to the account shown on your approved payment token, using the token code as the narration.</p><p>Owners pay a yearly onboarding fee per property after verification. Listings must be truthful. Fraud leads to removal and a ban. Never pay anyone outside the account shown on your token.</p>");
EXTRA.privacy = () => legal("Privacy notice (NDPA)", "<p>We collect your name, contact details, and for owners, identity documents and bank details, to verify users and run tenancies. Identity documents are stored privately and only admins can view them. Bank account numbers are encrypted. We do not sell your data.</p><p>You may ask to see, correct or delete your data by contacting support. We keep records as long as the law and your tenancy require.</p>");

// ---------- verification and onboarding ----------
EXTRA.verify = () => { app.innerHTML = `<h2>Verify your phone</h2>${phoneCard()}`; };
EXTRA.onboard = async () => {
  const k = await api("verify/kyc/status").catch(() => ({})), acc = await api("accounts").then(arr).catch(() => []);
  app.innerHTML = `<h2>Get verified</h2>${phoneCard()}
  <div class="card"><h3>Identity (KYC)</h3>${kv(k)}<form data-form="kyc" class="col">${L("ID type", `<select name="idType">${opts([["NIN", "NIN"], ["PASSPORT", "Passport"], ["DRIVERS_LICENCE", "Driver's licence"], ["VOTERS_CARD", "Voter's card"]])}</select>`)}${inp("idNumber", "ID number")}${inp("bankAccountName", "Name on your bank account (must match your ID)")}${inp("idDoc", "Photo of your ID", "file", 'accept="image/*,.pdf" required')}${inp("selfie", "Selfie holding your ID", "file", 'accept="image/*" required')}<button>Submit for review</button></form></div>
  <div class="card"><h3>Bank account for receiving rent</h3>${acc.map((a) => kv(a)).join("<hr>")}<form data-form="acct" class="col">${inp("bankName", "Bank")}${inp("accountName", "Account name")}${inp("accountNumber", "10-digit account number", "text", 'pattern="\\d{10}"')}<button>Save account</button></form><p class="muted">Needs an approved KYC. The name must match your verified name.</p></div>`;
};
FORMS.kyc = async (f) => { const [a, b] = await Promise.all([up(f.idDoc), up(f.selfie)]); await api("verify/kyc", { body: { idType: f.idType, idNumber: f.idNumber, idDocumentKey: a.key, selfieKey: b.key, bankAccountName: f.bankAccountName || undefined } }); say("Submitted. We will review it."); EXTRA.onboard(); };
FORMS.acct = async (f) => { await api("accounts", { body: { ...f, isDefault: true } }); say("Saved. It may be reviewed by an admin."); EXTRA.onboard(); };

// ---------- properties and units ----------
EXTRA.pnew = () => {
  app.innerHTML = `<h2>Add a property</h2><form data-form="pnew" class="col card">${L("Type", `<select name="kind">${opts([["HOUSE", "Single house, flat or room"], ["BUILDING", "Building with several units"], ["ESTATE", "Estate I own entirely"]])}</select>`)}${inp("name", "Property name")}${inp("address", "Full address")}<label>Location</label><div id="lb" class="row"></div><input type="hidden" name="locationId" required>${inp("declaredUnits", "Number of units you will list", "number", 'min="1" value="1"')}${inp("estateName", "Estate name (only if your house is in an estate with many owners)")}${L("Description", '<textarea name="description"></textarea>')}<p class="muted">Please double-check the spelling of names. They appear exactly as typed.</p><button>Create property</button></form>`;
  locs(document.getElementById("lb"), (id) => (document.querySelector('[name=locationId]').value = id));
};
FORMS.pnew = async (f) => { const b = { ...f, declaredUnits: Number(f.declaredUnits) }; for (const k of ["estateName", "description"]) if (!b[k]) delete b[k]; const p = await api("properties", { body: b }); location.hash = "#/property/" + (p.id || p.property?.id); };
EXTRA.property = async (id) => {
  const p = await api("properties/" + id), mg = p.managers || p.assignments || [], docs = p.documents || [];
  app.innerHTML = `<h2>${esc(p.name)} <span class="tag">${esc(p.status)}</span></h2><div class="card">${kv(p)}<div class="row">${{ DOCS_UPLOADED: btn("submit", id, "Submit for review"), NEEDS_CHANGES: btn("submit", id, "Resubmit"), VERIFIED: btn("payfee", id, "Pay yearly fee"), ACTIVE: btn("renew", id, "Renew early", "g"), EXPIRED: btn("renew", id, "Renew") }[p.status] || ""}<a href="#/propedit/${esc(id)}"><button class="g">Edit</button></a>${btn("delprop", id, "Delete", "r")}${["ACTIVE", "VERIFIED"].includes(p.status) || p.parentId ? `<a href="#/unitnew/${esc(id)}"><button class="g">Add a unit</button></a>` : ""}</div></div>
  <div class="card"><h3>Ownership documents (${docs.length})</h3>${docs.map((d) => `<div class="muted">${esc(d.docType)} · ${esc(d.status)} ${esc(d.reason || "")}</div>`).join("")}<form data-form="pdoc" class="col"><input type="hidden" name="id" value="${esc(id)}">${L("Document", `<select name="docType">${opts([["C_OF_O", "Certificate of Occupancy"], ["GOVERNORS_CONSENT", "Governor's Consent"], ["DEED_OF_ASSIGNMENT", "Deed of Assignment"], ["SURVEY_PLAN", "Survey plan"], ["ALLOCATION_LETTER", "Allocation letter"], ["UTILITY_BILL", "Utility bill (support only)"], ["BUILDING_PHOTO", "Photo of the building front"]])}</select>`)}${inp("file", "File", "file", 'accept="image/*,.pdf" required')}<button>Upload</button></form></div>
  ${p.kind === "ESTATE" ? `<div class="card"><h3>Add a house to this estate</h3><form data-form="house" class="col"><input type="hidden" name="id" value="${esc(id)}">${inp("name", "House name")}${inp("address", "Address")}${inp("declaredUnits", "Units", "number", 'min="1" value="1"')}<button>Add house</button></form></div>` : ""}
  <div class="card"><h3>Managers (${mg.length})</h3>${mg.map((m) => `<div class="row"><span>${esc(m.manager?.fullName || m.fullName || m.managerId)}</span>${btn("rmmgr", id, "Remove", "r", m.managerId || m.manager?.id)}</div>`).join("")}<form data-form="mgr" class="col"><input type="hidden" name="id" value="${esc(id)}">${inp("managerEmail", "Manager's account email", "email")}${inp("file", "Signed authorisation letter", "file", 'accept="image/*,.pdf" required')}${["canListUnits:Can list units", "canSetPrice:Can set rent", "canApproveTokens:Can approve payment tokens", "canReceivePayments:Can receive rent in own account", "canViewPayouts:Can see rent figures"].map((x) => { const [k, t] = x.split(":"); return `<label><input type="checkbox" name="${k}" style="flex:none"> ${t}</label>`; }).join("")}<button>Appoint manager</button></form></div>`;
};
FORMS.pdoc = async (f) => { const k = await up(f.file); await api(`properties/${f.id}/documents`, { body: { docType: f.docType, fileKey: k.key } }); say("Uploaded"); EXTRA.property(f.id); };
FORMS.house = async (f) => { await api(`properties/${f.id}/houses`, { body: { kind: "HOUSE", name: f.name, address: f.address, declaredUnits: Number(f.declaredUnits) } }); say("House added"); EXTRA.property(f.id); };
FORMS.mgr = async (f) => { const k = await up(f.file), b = { managerEmail: f.managerEmail, authorisationKey: k.key }; for (const x of ["canListUnits", "canSetPrice", "canApproveTokens", "canReceivePayments", "canViewPayouts"]) b[x] = !!f[x]; await api(`properties/${f.id}/managers`, { body: b }); say("Manager appointed (pending admin approval of the letter)"); EXTRA.property(f.id); };
EXTRA.unitnew = async (pid) => {
  const m = await api("public/meta");
  app.innerHTML = `<h2>Add a unit</h2><form data-form="unit" class="col card"><input type="hidden" name="propertyId" value="${esc(pid)}">${L("Type", `<select name="unitTypeId">${opts(m.unitTypes.map((t) => [t.id, t.name]))}</select>`)}${inp("title", "Title, e.g. Newly built 2-bedroom flat")}${L("Description", '<textarea name="description"></textarea>')}${inp("rentNaira", "Rent (₦)", "number", 'min="0" required')}${inp("cautionNaira", "Caution fee (₦)", "number", 'min="0" value="0"')}${inp("serviceChargeNaira", "Service charge (₦)", "number", 'min="0" value="0"')}${L("Pay every", `<select name="payDuration">${opts([["ANNUAL", "Year"], ["BIANNUAL", "6 months"], ["QUARTERLY", "3 months"], ["MONTHLY", "Month"]])}</select>`)}${inp("bedrooms", "Bedrooms", "number", 'min="0" value="1"')}${inp("bathrooms", "Bathrooms", "number", 'min="0" value="1"')}${inp("toilets", "Toilets", "number", 'min="0" value="1"')}<label><input type="checkbox" name="furnished" style="flex:none"> Furnished</label><label>Features</label><div class="row">${m.features.map((x) => `<label><input type="checkbox" name="f_${esc(x.id)}" style="flex:none"> ${esc(x.name)}</label>`).join("")}</div>${inp("photos", "Photos (at least 3, up to 15, 5MB each)", "file", 'accept="image/*" multiple required')}<button>Save unit</button></form>`;
};
FORMS.unit = async (f, el) => {
  const files = [...el.photos.files].slice(0, 15), images = []; for (const x of files) images.push((await up(x, "units/images")).url);
  const n = (k) => Number(f[k] || 0), featureIds = [...el.querySelectorAll("[name^=f_]:checked")].map((c) => c.name.slice(2));
  await api("units", { body: { propertyId: f.propertyId, unitTypeId: f.unitTypeId, title: f.title, description: f.description || undefined, rentNaira: n("rentNaira"), cautionNaira: n("cautionNaira"), serviceChargeNaira: n("serviceChargeNaira"), payDuration: f.payDuration, bedrooms: n("bedrooms"), bathrooms: n("bathrooms"), toilets: n("toilets"), furnished: !!f.furnished, featureIds, images } });
  say("Saved as a draft. Publish it from your dashboard."); location.hash = "#/dash";
};

// ---------- tenant pages ----------
EXTRA.token = async (id) => {
  const t = await api("tokens/" + id);
  app.innerHTML = `<div class="card"><h2>Payment token <span class="tag">${esc(t.status)}</span></h2><h3>${esc(t.code || "")}</h3><p>${esc(t.unit?.title || "")}</p>${kv(t)}
  ${t.pay ? `<div class="card" style="background:#e0f2ea"><h3>Pay to</h3><p><b>${esc(t.pay.bankName)}</b><br>${esc(t.pay.accountName)}<br><b style="font-size:22px">${esc(t.pay.accountNumber)}</b><br>Narration: <b>${esc(t.pay.narration)}</b></p><p>Pay before <b>${t.expiresAt ? new Date(t.expiresAt).toLocaleString() : ""}</b></p><p class="muted">${esc(t.warning || "")}</p></div>` : `<p class="muted">Bank details appear here once the owner approves your request.</p>`}
  ${t.status === "ACTIVE" ? `<form data-form="claim" class="col card"><input type="hidden" name="id" value="${esc(id)}"><h3>I have paid</h3>${inp("reference", "Transfer reference or session ID")}${inp("file", "Receipt (optional)", "file", 'accept="image/*,.pdf"')}<button>Tell the owner</button></form>` : ""}
  <div class="row">${t.status === "PAID" ? btn("dl", `tokens/${id}/receipt`, "Download receipt") : ""}${["REQUESTED", "ACTIVE"].includes(t.status) ? btn("tcancel", id, "Cancel request", "g") : ""}${t.status === "PAYMENT_CLAIMED" ? btn("dispute", id, "Owner has not confirmed after 24h? Dispute", "r") : ""}</div></div>`;
};
FORMS.claim = async (f) => { const d = new FormData(); d.append("reference", f.reference || ""); if (f.file?.size) d.append("file", f.file); await api(`tokens/${f.id}/claim`, { form: d }); say("Sent. The owner will confirm."); EXTRA.token(f.id); };
EXTRA.review = (uid) => { app.innerHTML = `<h2>Review your home</h2><form data-form="review" class="col card"><input type="hidden" name="unitId" value="${esc(uid)}">${L("Rating (1-5)", '<input name="rating" type="number" min="1" max="5" required>')}${L("Manager rating (1-5, optional)", '<input name="managerRating" type="number" min="1" max="5">')}${L("Comment", '<textarea name="comment"></textarea>')}<button>Post review</button></form>`; };
FORMS.review = async (f) => { await api("reviews", { body: { unitId: f.unitId, rating: Number(f.rating), managerRating: f.managerRating ? Number(f.managerRating) : undefined, comment: f.comment || undefined } }); say("Thank you"); location.hash = "#/dash"; };
EXTRA.news = async () => { const r = arr(await api("announcements/mine")); app.innerHTML = `<h2>Notices</h2>${r.map((a) => `<div class="card" style="margin:8px 0"><b>${esc(a.title)}</b><p>${esc(a.body)}</p></div>`).join("") || "<p>No notices.</p>"}`; };

// ---------- owner / manager tools ----------
EXTRA.announce = async () => {
  const ps = await api("properties/mine").then(arr).catch(() => []);
  app.innerHTML = `<h2>Notice to tenants</h2><form data-form="ann" class="col card">${L("Property", `<select name="propertyId">${opts(ps.map((p) => [p.id, p.name]))}</select>`)}${inp("title", "Title")}${L("Message", '<textarea name="body" required></textarea>')}<button>Send</button></form>`;
};
FORMS.ann = async (f) => { await api("announcements", { body: f }); say("Sent"); };
EXTRA.insights = async () => { const d = await api("insights/summary"); app.innerHTML = `<h2>Reports</h2><div class="card">${deep(d)}</div><div class="row">${btn("dl", "insights/export/rent.csv", "Download rent CSV", "g")}${btn("dl", "insights/export/tickets.csv", "Download tickets CSV", "g")}</div>`; };

// ---------- admin ----------
EXTRA.a = async (s = "analytics") => {
  const M = {
    tickets: ["admin/tickets", (t) => btn("amed", t.id, "Mediate", "g")],
    reports: ["admin/reports", (r) => btn("arep", r.unitId || r.id, "Dismiss", "g", "DISMISS") + btn("arep", r.unitId || r.id, "Take down", "r", "TAKE_DOWN")],
    reviews: ["admin/reviews", (r) => btn("ahide", r.id, "Hide", "r")],
    disputes: ["admin/tokens", (t) => (t.status === "DISPUTED" ? btn("ares", t.id, "Mark paid", "", "CONFIRM_PAID") + btn("ares", t.id, "Cancel", "r", "CANCEL") : "")],
    accounts: ["admin/accounts", (a) => btn("aacc", a.id, "Approve", "", "APPROVED") + btn("aacc", a.id, "Reject", "r", "REJECTED")],
  };
  const tabs = `<p class="tabs"><a href="#/a/analytics">Analytics</a>${Object.keys(M).map((k) => `<a href="#/a/${k}">${k}</a>`).join("")}<a href="${API}/admin/">Verification and properties (console)</a></p>`;
  if (!M[s]) { const d = await api("admin/analytics/overview"); app.innerHTML = `<h2>Admin</h2>${tabs}<div class="card">${deep(d)}</div><div class="row">${["onboarding", "rent", "tickets", "users"].map((x) => btn("dl", `admin/export/${x}.csv`, x + ".csv", "g")).join("")}</div>`; return; }
  const rows = arr(await api(M[s][0]));
  app.innerHTML = `<h2>${esc(s)}</h2>${tabs}<div class="grid">${rows.map((r) => `<div class="card">${kv(r)}<div class="row">${M[s][1](r)}</div></div>`).join("") || "<p>Nothing to review.</p>"}</div>`;
};

// ---------- actions ----------
Object.assign(A, {
  otp: () => api("verify/otp/send", { body: { channel: "PHONE" } }).then(() => say("Code sent by SMS")),
  otpok: () => api("verify/otp/confirm", { body: { channel: "PHONE", code: document.getElementById("otp").value } }).then(() => say("Phone verified")),
  rmmgr: async (id, mid) => { await api(`properties/${id}/managers/${mid}`, { method: "DELETE" }); EXTRA.property(id); },
  renewreq: (id) => api("tokens/renew", { body: { tenancyId: id } }).then(() => say("Renewal requested. The owner will review it.")),
  dispute: (id) => api(`tokens/${id}/dispute`, { body: { reason: prompt("What happened?") || "Not confirmed" } }).then(() => EXTRA.token(id)),
  dl: async (path) => { const r = await fetch(API + "/api/" + path, { headers: { Authorization: "Bearer " + localStorage.at } }); if (!r.ok) throw new Error("Download failed"); const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = path.split("/").pop(); a.click(); },
  amed: (id) => api(`admin/tickets/${id}/mediate`, { body: { note: prompt("Note to both sides:") || "Reviewed" } }),
  arep: (id, x) => api(`admin/reports/${id}/resolve`, { body: { action: x, note: prompt("Note:") || "Reviewed" } }),
  ahide: (id) => api(`admin/reviews/${id}/hide`, { body: { hidden: true, reason: prompt("Reason:") || "Policy" } }),
  ares: (id, x) => api(`admin/tokens/${id}/resolve`, { body: { outcome: x, notes: prompt("Notes:") || "Resolved" } }),
  aacc: (id, x) => api(`admin/accounts/${id}/decision`, { body: { decision: x, reason: x === "REJECTED" ? prompt("Reason:") || "Details do not match" : undefined } }),
});
document.addEventListener("submit", async (e) => { const n = e.target.dataset.form; if (!n || !FORMS[n]) return; e.preventDefault(); const b = e.target.querySelector("button"); b && (b.disabled = true); try { await FORMS[n](Object.fromEntries(new FormData(e.target)), e.target); } catch (x) { say(x.message); } b && (b.disabled = false); });
addEventListener("hashchange", route); route();
