import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { notify, staffOf } from "../lib/access";
import { adminIds } from "../lib/payToken";
import { requireAuth, requireRole } from "../middleware/auth";

// "Report this listing". Enough separate reports hide the listing from search until an admin has looked at it.
const r = Router();
r.use(requireAuth, requireRole("TENANT", "OWNER", "MANAGER"));
export const REASONS = ["FAKE_LISTING", "ALREADY_RENTED", "WRONG_PRICE", "ASKED_TO_PAY_OFF_PLATFORM", "SCAM_OR_FRAUD", "OTHER"] as const;
const THRESHOLD = () => Number(process.env.REPORT_HIDE_THRESHOLD) || 3;

r.post("/", rateLimit({ windowMs: 24 * 3600_000, max: 15 }), async (req, res) => {
  const p = z.object({ unitId: z.string(), reason: z.enum(REASONS), details: z.string().trim().max(1000).optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const unit = await prisma.unit.findFirst({ where: { id: p.data.unitId, status: { in: ["AVAILABLE", "RESERVED", "OCCUPIED"] } }, select: { id: true, title: true, propertyId: true, flaggedAt: true } });
  if (!unit) return res.status(404).json({ error: "Listing not found" });
  if ((await staffOf(unit.propertyId)).includes(req.user!.id)) return res.status(403).json({ error: "You can't report your own listing" });
  if (await prisma.report.findUnique({ where: { unitId_reporterId: { unitId: unit.id, reporterId: req.user!.id } } })) return res.status(409).json({ error: "You already reported this listing. Our team will review it." });
  await prisma.report.create({ data: { unitId: unit.id, reporterId: req.user!.id, reason: p.data.reason, details: p.data.details } });

  // Hide once enough different people have reported it (the flag is cleared by an admin decision)
  const open = await prisma.report.count({ where: { unitId: unit.id, status: "OPEN" } });
  if (open >= THRESHOLD() && !unit.flaggedAt) {
    const f = await prisma.unit.updateMany({ where: { id: unit.id, flaggedAt: null }, data: { flaggedAt: new Date() } });
    if (f.count) {
      await notify(await adminIds(), "REPORT", "Listing hidden after reports", `"${unit.title}" has ${open} open reports and is hidden from search until reviewed.`);
      await notify(await staffOf(unit.propertyId), "REPORT", "Your listing is under review", `"${unit.title}" is hidden from search while our team checks reports about it.`);
    }
  }
  res.status(201).json({ received: true });
});

export default r;
