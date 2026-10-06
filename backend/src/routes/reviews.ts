import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { notify, staffOf } from "../lib/access";
import { requireAuth, requireRole } from "../middleware/auth";

// Ratings and reviews. Only tenants who really stayed (confirmed move-in or a finished tenancy) or completed a viewing can review.
const r = Router();
const num = (v: unknown, d: number, max: number) => Math.min(Math.max(parseInt(String(v ?? "")) || d, 1), max);
const shortName = (n: string) => { const [a, b] = n.trim().split(/\s+/); return b ? `${a} ${b[0]}.` : a; };
const pub = (x: any) => ({ id: x.id, rating: x.rating, managerRating: x.managerRating, comment: x.comment, verifiedStay: x.verifiedStay, by: shortName(x.user.fullName), at: x.createdAt, reply: x.reply, repliedAt: x.repliedAt });

// ───── Public (no login) ─────
r.get("/unit/:unitId", async (req, res) => {
  const where = { unitId: req.params.unitId, hidden: false };
  const page = num(req.query.page, 1, 1000), limit = num(req.query.limit, 10, 30);
  const [agg, rows] = await Promise.all([
    prisma.review.aggregate({ where, _avg: { rating: true, managerRating: true }, _count: { _all: true } }),
    prisma.review.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit, include: { user: { select: { fullName: true } } } }),
  ]);
  res.json({ count: agg._count._all, average: agg._avg.rating ? Math.round(agg._avg.rating * 10) / 10 : null, managerAverage: agg._avg.managerRating ? Math.round(agg._avg.managerRating * 10) / 10 : null, page, pages: Math.ceil(agg._count._all / limit), reviews: rows.map(pub) });
});
// Whole property (and every house inside an estate)
r.get("/property/:propertyId", async (req, res) => {
  const where = { hidden: false, unit: { OR: [{ propertyId: req.params.propertyId }, { property: { parentId: req.params.propertyId } }] } };
  const agg = await prisma.review.aggregate({ where, _avg: { rating: true, managerRating: true }, _count: { _all: true } });
  res.json({ count: agg._count._all, average: agg._avg.rating ? Math.round(agg._avg.rating * 10) / 10 : null, managerAverage: agg._avg.managerRating ? Math.round(agg._avg.managerRating * 10) / 10 : null });
});

// ───── Tenant: write or update your review of a unit ─────
const schema = z.object({ unitId: z.string(), rating: z.number().int().min(1).max(5), managerRating: z.number().int().min(1).max(5).optional(), comment: z.string().trim().max(1000).optional() });
r.post("/", requireAuth, requireRole("TENANT"), rateLimit({ windowMs: 3600_000, max: 20 }), async (req, res) => {
  const p = schema.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const { id } = req.user!;
  const unit = await prisma.unit.findUnique({ where: { id: p.data.unitId }, select: { id: true, title: true, propertyId: true } });
  if (!unit) return res.status(404).json({ error: "Not found" });
  const stayed = await prisma.tenancy.findFirst({ where: { tenantId: id, unitId: unit.id, OR: [{ moveInConfirmedAt: { not: null } }, { active: false }] } });
  const viewed = stayed ? null : await prisma.viewing.findFirst({ where: { tenantId: id, unitId: unit.id, status: "COMPLETED" } });
  if (!stayed && !viewed) return res.status(403).json({ error: "You can review a unit after you move in or after a completed viewing" });
  const data = { rating: p.data.rating, managerRating: p.data.managerRating ?? null, comment: p.data.comment || null, verifiedStay: !!stayed };
  const existing = await prisma.review.findUnique({ where: { userId_unitId: { userId: id, unitId: unit.id } } });
  const rev = existing
    ? await prisma.review.update({ where: { id: existing.id }, data: { ...data, ...(existing.comment !== data.comment ? { reply: null, repliedAt: null } : {}) } })
    : await prisma.review.create({ data: { ...data, unitId: unit.id, userId: id } });
  if (!existing) await notify(await staffOf(unit.propertyId), "REVIEW", "New review", `A tenant rated "${unit.title}" ${data.rating}/5.`);
  res.status(existing ? 200 : 201).json({ id: rev.id, updated: !!existing });
});
r.delete("/:id", requireAuth, requireRole("TENANT"), async (req, res) => {
  const d = await prisma.review.deleteMany({ where: { id: req.params.id, userId: req.user!.id } });
  res.status(d.count ? 200 : 404).json(d.count ? { deleted: true } : { error: "Not found" });
});

// ───── Owner / manager: one public reply per review ─────
r.post("/:id/reply", requireAuth, requireRole("OWNER", "MANAGER"), async (req, res) => {
  const p = z.object({ reply: z.string().trim().min(2).max(600) }).safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const rev = await prisma.review.findUnique({ where: { id: req.params.id }, include: { unit: { select: { title: true, propertyId: true } } } });
  if (!rev || !(await staffOf(rev.unit.propertyId)).includes(req.user!.id)) return res.status(404).json({ error: "Not found" });
  await prisma.review.update({ where: { id: rev.id }, data: { reply: p.data.reply, repliedAt: new Date() } });
  await notify([rev.userId], "REVIEW", "Reply to your review", `The owner or manager replied to your review of "${rev.unit.title}".`);
  res.json({ ok: true });
});

export default r;
