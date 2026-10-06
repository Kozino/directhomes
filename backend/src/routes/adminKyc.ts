import { Router } from "express";
import path from "path";
import { z } from "zod";
import { sendPrivate } from "../lib/storage";
import { prisma } from "../lib/prisma";
import { hashValue } from "../lib/hash";
import { audit } from "../lib/audit";
import { requireAuth, requireRole } from "../middleware/auth";

const r = Router();
r.use(requireAuth, requireRole("ADMIN"));

r.get("/stats", async (_q, res) => {
  const [owners, managers, tenants, pendingKyc, suspended, pendingProperties] = await Promise.all([
    prisma.user.count({ where: { role: "OWNER" } }), prisma.user.count({ where: { role: "MANAGER" } }),
    prisma.user.count({ where: { role: "TENANT" } }), prisma.kycRecord.count({ where: { status: "PENDING" } }),
    prisma.user.count({ where: { status: { not: "ACTIVE" } } }), prisma.property.count({ where: { status: "PENDING_REVIEW" } }),
  ]);
  res.json({ owners, managers, tenants, pendingKyc, suspended, pendingProperties });
});

// Review queue (oldest first)
r.get("/kyc", async (req, res) => {
  const status = (req.query.status as any) || "PENDING";
  res.json(await prisma.kycRecord.findMany({
    where: { status }, orderBy: { createdAt: "asc" }, take: 100,
    include: { user: { select: { id: true, fullName: true, email: true, phone: true, role: true } } },
  }));
});
r.get("/kyc/:id", async (req, res) => {
  const k = await prisma.kycRecord.findUnique({ where: { id: req.params.id }, include: { user: { select: { id: true, fullName: true, email: true, phone: true, role: true, createdAt: true } } } });
  if (!k) return res.status(404).json({ error: "Not found" });
  res.json({ ...k, idNumberHash: undefined });
});

// Documents are streamed only to admins, and every view is logged
r.get("/files/:key", async (req, res) => {
  const key = path.basename(req.params.key);
  if (!/^[\w-]+\.\w+$/.test(key)) return res.status(400).end();
  await audit(req, "VIEW_KYC_FILE", "File", key);
  await sendPrivate(res, key);
});

const decisionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED", "NEEDS_INFO"]),
  notes: z.string().optional(),
  checklist: z.object({ nameMatches: z.boolean(), selfieMatches: z.boolean(), documentGenuine: z.boolean() }),
  blacklist: z.boolean().optional(), // confirmed fraud
});

r.post("/kyc/:id/decision", async (req, res) => {
  const p = decisionSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const { decision, notes, checklist, blacklist } = p.data;
  if (decision === "APPROVED" && !Object.values(checklist).every(Boolean)) return res.status(400).json({ error: "Complete every checklist item before approving" });
  if (decision !== "APPROVED" && (notes ?? "").trim().length < 3) return res.status(400).json({ error: "A reason is required" });

  const k = await prisma.kycRecord.findUnique({ where: { id: req.params.id }, include: { user: true } });
  if (!k || k.status !== "PENDING") return res.status(409).json({ error: "This submission is not pending" });

  const status = decision === "APPROVED" ? "VERIFIED" : decision === "REJECTED" ? "REJECTED" : "UNVERIFIED";
  await prisma.$transaction([
    prisma.kycRecord.update({ where: { id: k.id }, data: { status, rejectReason: decision === "APPROVED" ? null : notes, reviewedById: req.user!.id, reviewedAt: new Date() } }),
    prisma.verificationReview.create({ data: { entityType: "KYC", entityId: k.id, adminId: req.user!.id, decision, checklistJson: checklist, notes } }),
    prisma.notification.create({ data: { userId: k.userId, type: "KYC", title: decision === "APPROVED" ? "Identity verified" : decision === "REJECTED" ? "Verification rejected" : "More information needed", body: decision === "APPROVED" ? "You are now a Verified Owner/Manager." : notes! } }),
    ...(blacklist ? [
      prisma.blacklist.createMany({ skipDuplicates: true, data: [
        { type: "ID_HASH", valueHash: k.idNumberHash, reason: notes ?? "Fraud", addedById: req.user!.id },
        { type: "PHONE", valueHash: hashValue(k.user.phone), reason: notes ?? "Fraud", addedById: req.user!.id },
        { type: "EMAIL", valueHash: hashValue(k.user.email), reason: notes ?? "Fraud", addedById: req.user!.id } ] }),
      prisma.user.update({ where: { id: k.userId }, data: { status: "BANNED" } }) ] : []),
  ]);
  await audit(req, `KYC_${decision}`, "KycRecord", k.id, { blacklist: !!blacklist });
  res.json({ status });
});

export default r;
