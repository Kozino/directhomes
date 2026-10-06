import { Router } from "express";
import { prisma } from "../lib/prisma";
import { propScope, unitScope } from "../lib/access";
import { requireAuth, requireRole } from "../middleware/auth";

const r = Router();
r.use(requireAuth);

// Owner and manager dashboards share one shape; scope decides what each can see.
// Estate owners get each estate with all its houses and unit counts in one view.
r.get("/staff", requireRole("OWNER", "MANAGER"), async (req, res) => {
  const { id, role } = req.user!, now = Date.now();
  const props = await prisma.property.findMany({ where: propScope(id, role), orderBy: { createdAt: "desc" },
    include: { location: { select: { name: true } }, onboardings: { where: { expiresAt: { not: null } }, orderBy: { expiresAt: "desc" }, take: 1, select: { expiresAt: true } } } });
  const groups = await prisma.unit.groupBy({ by: ["propertyId", "status"], where: unitScope(id, role), _count: { _all: true } });
  const counts: Record<string, Record<string, number>> = {};
  for (const g of groups) (counts[g.propertyId] ??= {})[g.status] = g._count._all;
  const sum = (ids: string[]) => ids.reduce((t, pid) => { for (const [k, v] of Object.entries(counts[pid] ?? {})) t[k] = (t[k] ?? 0) + v; return t; }, {} as Record<string, number>);

  const portfolio = props.filter((p) => !p.parentId).map((p) => {
    const houses = props.filter((c) => c.parentId === p.id);
    const exp = p.onboardings[0]?.expiresAt ?? null;
    return { id: p.id, name: p.name, kind: p.kind, status: p.status, location: p.location.name, expiresAt: exp,
      daysLeft: exp ? Math.ceil((exp.getTime() - now) / 86_400_000) : null,
      units: sum([p.id, ...houses.map((h) => h.id)]), // whole estate rolled up
      houses: houses.map((h) => ({ id: h.id, name: h.name, kind: h.kind, units: counts[h.id] ?? {} })) };
  });
  const [enquiries, unreadMessages, pendingViewings, pendingTokenRequests, paymentsToConfirm, activeTenancies, openTickets, escalatedTickets] = await Promise.all([
    prisma.enquiry.count({ where: { unit: unitScope(id, role) } }),
    prisma.message.count({ where: { readAt: null, senderId: { not: id }, enquiry: { unit: unitScope(id, role) } } }),
    prisma.viewing.count({ where: { status: "REQUESTED", unit: unitScope(id, role) } }),
    prisma.paymentToken.count({ where: { status: "REQUESTED", unit: unitScope(id, role) } }),
    prisma.paymentToken.count({ where: { status: { in: ["PAYMENT_CLAIMED", "DISPUTED"] }, unit: unitScope(id, role), ...(role === "OWNER" ? {} : { payToUserId: id }) } }),
    prisma.tenancy.count({ where: { active: true, unit: unitScope(id, role) } }),
    prisma.maintenanceTicket.count({ where: { status: { in: ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "REOPENED"] }, unit: unitScope(id, role) } }),
    prisma.maintenanceTicket.count({ where: { escalated: true, status: { in: ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "REOPENED"] }, unit: unitScope(id, role) } }),
  ]);
  res.json({ portfolio, enquiries, unreadMessages, pendingViewings, pendingTokenRequests, paymentsToConfirm, activeTenancies, openTickets, escalatedTickets, expiringSoon: portfolio.filter((p) => p.daysLeft !== null && p.daysLeft <= 60) });
});

r.get("/tenant", requireRole("TENANT"), async (req, res) => {
  const id = req.user!.id;
  const [enquiries, favourites, unreadMessages, upcomingViewings, openRequests, tenancies, openTickets] = await Promise.all([
    prisma.enquiry.count({ where: { tenantId: id } }), prisma.favourite.count({ where: { userId: id } }),
    prisma.message.count({ where: { readAt: null, senderId: { not: id }, enquiry: { tenantId: id } } }),
    prisma.viewing.findMany({ where: { tenantId: id, status: { in: ["REQUESTED", "CONFIRMED", "RESCHEDULED"] }, proposedAt: { gte: new Date() } }, orderBy: { proposedAt: "asc" }, take: 10, include: { unit: { select: { title: true } } } }),
    prisma.paymentToken.count({ where: { tenantId: id, status: { in: ["REQUESTED", "ACTIVE", "PAYMENT_CLAIMED", "DISPUTED"] } } }),
    prisma.tenancy.findMany({ where: { tenantId: id, active: true }, orderBy: { endsAt: "asc" }, include: { unit: { select: { title: true } } } }),
    prisma.maintenanceTicket.count({ where: { tenantId: id, status: { in: ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "REOPENED", "RESOLVED"] } } }),
  ]);
  res.json({ enquiries, favourites, unreadMessages, upcomingViewings, openRequests, openTickets,
    tenancies: tenancies.map((t) => ({ id: t.id, unit: t.unit.title, startsAt: t.startsAt, endsAt: t.endsAt, daysLeft: Math.ceil((t.endsAt.getTime() - Date.now()) / 86_400_000) })) });
});

// ───── Notifications (all roles) ─────
r.get("/notifications", async (req, res) => {
  const page = Math.min(Math.max(parseInt(String(req.query.page ?? "")) || 1, 1), 1000), limit = 30;
  const where = { userId: req.user!.id, ...(req.query.unread === "true" ? { readAt: null } : {}), ...(typeof req.query.type === "string" && /^[A-Z_]{3,20}$/.test(req.query.type) ? { type: req.query.type } : {}) };
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: req.user!.id, readAt: null } }),
  ]);
  res.json({ unread, total, page, pages: Math.ceil(total / limit), items });
});
r.delete("/notifications/:id", async (req, res) => {
  const d = await prisma.notification.deleteMany({ where: { id: req.params.id, userId: req.user!.id } });
  res.status(d.count ? 200 : 404).json(d.count ? { deleted: true } : { error: "Not found" });
});
r.post("/notifications/read", async (req, res) => {
  const ids: string[] | undefined = Array.isArray(req.body?.ids) ? req.body.ids : undefined;
  await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
  res.json({ ok: true });
});

export default r;
