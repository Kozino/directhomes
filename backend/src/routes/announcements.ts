import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { notify, propertyRole } from "../lib/access";
import { requireAuth, requireRole } from "../middleware/auth";

// Notices to tenants of a house, a building or a whole estate (power cut, water supply, security meeting...)
const r = Router();
r.use(requireAuth);

r.post("/", requireRole("OWNER", "MANAGER"), rateLimit({ windowMs: 3600_000, max: 20 }), async (req, res) => {
  const p = z.object({ propertyId: z.string(), title: z.string().trim().min(3).max(120), body: z.string().trim().min(3).max(2000) }).safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const pr = await propertyRole(req.user!.id, p.data.propertyId);
  if (!pr) return res.status(404).json({ error: "Not found" });
  const a = await prisma.announcement.create({ data: { propertyId: pr.property.id, authorId: req.user!.id, title: p.data.title, body: p.data.body } });
  // An estate notice reaches every house inside it
  const tenants = await prisma.tenancy.findMany({ where: { active: true, unit: { OR: [{ propertyId: pr.property.id }, { property: { parentId: pr.property.id } }] } }, select: { tenantId: true }, distinct: ["tenantId"] });
  await notify(tenants.map((t) => t.tenantId), "ANNOUNCEMENT", p.data.title, p.data.body.slice(0, 200));
  res.status(201).json({ id: a.id, sentTo: tenants.length });
});

// Staff: what was posted for a property
r.get("/property/:propertyId", requireRole("OWNER", "MANAGER"), async (req, res) => {
  if (!(await propertyRole(req.user!.id, req.params.propertyId))) return res.status(404).json({ error: "Not found" });
  res.json(await prisma.announcement.findMany({ where: { propertyId: req.params.propertyId }, orderBy: { createdAt: "desc" }, take: 50 }));
});

// Tenant: notices for the properties they currently live in (house and its estate)
r.get("/mine", requireRole("TENANT"), async (req, res) => {
  const ten = await prisma.tenancy.findMany({ where: { tenantId: req.user!.id, active: true }, select: { unit: { select: { propertyId: true, property: { select: { parentId: true } } } } } });
  const ids = [...new Set(ten.flatMap((t) => [t.unit.propertyId, ...(t.unit.property.parentId ? [t.unit.property.parentId] : [])]))];
  if (!ids.length) return res.json([]);
  const rows = await prisma.announcement.findMany({ where: { propertyId: { in: ids } }, orderBy: { createdAt: "desc" }, take: 50, include: { property: { select: { name: true } } } });
  res.json(rows.map((a) => ({ id: a.id, title: a.title, body: a.body, property: a.property.name, at: a.createdAt })));
});

export default r;
