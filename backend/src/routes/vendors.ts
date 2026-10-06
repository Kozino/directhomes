import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { propScope, propertyRole } from "../lib/access";
import { requireAuth, requireRole } from "../middleware/auth";

// Plumbers, electricians etc. Vendors belong to the property OWNER; managers add and use them for the properties they manage.
const r = Router();
r.use(requireAuth, requireRole("OWNER", "MANAGER"));

const ownersInScope = async (userId: string, role: "OWNER" | "MANAGER") =>
  [...new Set((await prisma.property.findMany({ where: propScope(userId, role), select: { ownerId: true } })).map((p) => p.ownerId))];

r.get("/", async (req, res) => {
  const propertyId = typeof req.query.propertyId === "string" ? req.query.propertyId : undefined;
  let owners: string[];
  if (propertyId) {
    const pr = await propertyRole(req.user!.id, propertyId);
    if (!pr) return res.status(404).json({ error: "Not found" });
    owners = [pr.property.ownerId];
  } else owners = await ownersInScope(req.user!.id, req.user!.role as "OWNER" | "MANAGER");
  res.json(await prisma.vendor.findMany({ where: { ownerId: { in: owners }, active: true }, orderBy: { name: "asc" }, take: 200 }));
});

r.post("/", async (req, res) => {
  const p = z.object({ propertyId: z.string(), name: z.string().trim().min(2).max(80), trade: z.string().trim().min(2).max(40), phone: z.string().trim().min(7).max(20) }).safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const pr = await propertyRole(req.user!.id, p.data.propertyId);
  if (!pr) return res.status(404).json({ error: "Not found" });
  const v = await prisma.vendor.create({ data: { ownerId: pr.property.ownerId, createdById: req.user!.id, name: p.data.name, trade: p.data.trade, phone: p.data.phone } });
  res.status(201).json(v);
});

// Remove from the list (past tickets keep their vendor). The owner, or whoever added the vendor.
r.delete("/:id", async (req, res) => {
  const v = await prisma.vendor.findUnique({ where: { id: req.params.id } });
  if (!v || !v.active || (v.ownerId !== req.user!.id && v.createdById !== req.user!.id)) return res.status(404).json({ error: "Not found" });
  await prisma.vendor.update({ where: { id: v.id }, data: { active: false } });
  res.json({ removed: true });
});

export default r;
