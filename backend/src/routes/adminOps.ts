import { Router } from "express";
import { z } from "zod";
import { TicketStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { audit } from "../lib/audit";
import { notify, staffOf } from "../lib/access";
import { ACTIVE } from "../lib/tickets";
import { requireAuth, requireRole } from "../middleware/auth";

// Admin: escalated maintenance tickets, review moderation, reported listings
const r = Router();
r.use(requireAuth, requireRole("ADMIN"));
const num = (v: unknown, d: number, max: number) => Math.min(Math.max(parseInt(String(v ?? "")) || d, 1), max);
const ALL: TicketStatus[] = ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "CLOSED", "REOPENED"];

// ───── Tickets (default view: escalated and still open). Open one with GET /api/tickets/:id ─────
r.get("/tickets", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const escalated = req.query.escalated === "false" ? undefined : true;
  const page = num(req.query.page, 1, 1000), limit = 30;
  const where = { ...(escalated ? { escalated: true } : {}), status: status === "all" ? undefined : ALL.includes(status as TicketStatus) ? { in: [status as TicketStatus] } : { in: ACTIVE } };
  const [total, rows] = await Promise.all([
    prisma.maintenanceTicket.count({ where }),
    prisma.maintenanceTicket.findMany({ where, orderBy: { escalatedAt: "asc" }, skip: (page - 1) * limit, take: limit, include: { unit: { select: { title: true, property: { select: { name: true, owner: { select: { fullName: true, phone: true } } } } } }, tenant: { select: { fullName: true, phone: true } } } }),
  ]);
  res.json({ total, page, pages: Math.ceil(total / limit), items: rows.map((t) => ({ id: t.id, title: t.title, category: t.category, urgency: t.urgency, status: t.status, escalated: t.escalated, escalatedAt: t.escalatedAt, createdAt: t.createdAt, reopenedCount: t.reopenedCount, unit: t.unit.title, property: t.unit.property.name, owner: t.unit.property.owner, tenant: t.tenant })) });
});

// Mediate: leave a note both sides see, optionally force a status, and clear the escalation flag
r.post("/tickets/:id/mediate", async (req, res) => {
  const p = z.object({ note: z.string().trim().min(5).max(1000), forceStatus: z.enum(["ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "CLOSED"]).optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Write a short note (at least a few words)" });
  const t = await prisma.maintenanceTicket.findUnique({ where: { id: req.params.id }, include: { unit: { select: { title: true, propertyId: true } } } });
  if (!t) return res.status(404).json({ error: "Not found" });
  const now = new Date(), to = p.data.forceStatus;
  await prisma.$transaction([
    prisma.maintenanceTicket.update({ where: { id: t.id }, data: { escalated: false, slaStartAt: now, ...(to ? { status: to, ...(to === "ACKNOWLEDGED" ? { acknowledgedAt: t.acknowledgedAt ?? now } : {}), ...(to === "RESOLVED" ? { resolvedAt: now } : {}), ...(to === "CLOSED" ? { closedAt: now, resolvedAt: t.resolvedAt ?? now } : {}) } : {}) } }),
    prisma.ticketComment.create({ data: { ticketId: t.id, authorId: req.user!.id, body: "Admin: " + p.data.note } }),
  ]);
  await audit(req, "TICKET_MEDIATE", "MaintenanceTicket", t.id, { forceStatus: to, note: p.data.note });
  await notify([t.tenantId, ...(await staffOf(t.unit.propertyId))], "TICKET", "Admin update on a ticket", `"${t.title}" at "${t.unit.title}": ${p.data.note.slice(0, 160)}`);
  res.json({ ok: true });
});

// ───── Reviews ─────
r.get("/reviews", async (req, res) => {
  const hidden = req.query.hidden === "true";
  const rows = await prisma.review.findMany({ where: { hidden }, orderBy: { createdAt: "desc" }, take: 100, include: { user: { select: { fullName: true } }, unit: { select: { title: true } } } });
  res.json(rows.map((v) => ({ id: v.id, unit: v.unit.title, by: v.user.fullName, rating: v.rating, managerRating: v.managerRating, comment: v.comment, reply: v.reply, verifiedStay: v.verifiedStay, hidden: v.hidden, at: v.createdAt })));
});
r.post("/reviews/:id/hide", async (req, res) => {
  const p = z.object({ hidden: z.boolean(), reason: z.string().trim().min(3).max(300) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Say whether to hide or restore it, and give a reason" });
  const v = await prisma.review.findUnique({ where: { id: req.params.id } });
  if (!v) return res.status(404).json({ error: "Not found" });
  await prisma.review.update({ where: { id: v.id }, data: { hidden: p.data.hidden } });
  await audit(req, p.data.hidden ? "REVIEW_HIDE" : "REVIEW_RESTORE", "Review", v.id, { reason: p.data.reason });
  res.json({ hidden: p.data.hidden });
});

// ───── Reported listings ─────
r.get("/reports", async (_req, res) => {
  const units = await prisma.unit.findMany({
    where: { reports: { some: { status: "OPEN" } } }, take: 100,
    select: { id: true, title: true, status: true, flaggedAt: true, property: { select: { name: true, owner: { select: { id: true, fullName: true, phone: true } } } }, reports: { where: { status: "OPEN" }, select: { reason: true, details: true, createdAt: true }, orderBy: { createdAt: "desc" } } },
  });
  res.json(units.map((u) => ({ unitId: u.id, title: u.title, status: u.status, hiddenFromSearch: !!u.flaggedAt, property: u.property.name, owner: u.property.owner, reportCount: u.reports.length, reports: u.reports }))
    .sort((a, b) => Number(b.hiddenFromSearch) - Number(a.hiddenFromSearch) || b.reportCount - a.reportCount));
});
// DISMISS = reports were wrong, listing goes back to search. TAKE_DOWN = listing is removed (back to draft). Banning the owner is done from Users.
r.post("/reports/:unitId/resolve", async (req, res) => {
  const p = z.object({ action: z.enum(["DISMISS", "TAKE_DOWN"]), note: z.string().trim().min(3).max(500) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Choose an action and write a short note" });
  const u = await prisma.unit.findUnique({ where: { id: req.params.unitId }, select: { id: true, title: true, status: true, propertyId: true } });
  if (!u || !(await prisma.report.count({ where: { unitId: u.id, status: "OPEN" } }))) return res.status(404).json({ error: "No open reports on this listing" });
  const takeDown = p.data.action === "TAKE_DOWN";
  const removed = takeDown && u.status === "AVAILABLE";
  await prisma.$transaction([
    prisma.report.updateMany({ where: { unitId: u.id, status: "OPEN" }, data: { status: takeDown ? "ACTIONED" : "DISMISSED", resolvedById: req.user!.id, resolvedAt: new Date(), note: p.data.note } }),
    prisma.unit.update({ where: { id: u.id }, data: { flaggedAt: null, ...(removed ? { status: "DRAFT" } : {}) } }),
  ]);
  await audit(req, takeDown ? "LISTING_TAKEDOWN" : "REPORTS_DISMISSED", "Unit", u.id, { note: p.data.note });
  await notify(await staffOf(u.propertyId), "REPORT", takeDown ? "Listing taken down" : "Listing cleared", takeDown ? `"${u.title}" was taken down after reports. Reason: ${p.data.note}` : `The reports on "${u.title}" were reviewed and dismissed. It is visible again.`);
  res.json({ ok: true, unitStatus: removed ? "DRAFT" : u.status, note: takeDown && !removed ? "The unit is reserved or occupied, so its status was not changed. Deal with the tenancy separately." : undefined });
});

export default r;
