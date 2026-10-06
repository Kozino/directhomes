import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { decrypt } from "../lib/crypto";
import { audit } from "../lib/audit";
import { notify, staffOf } from "../lib/access";
import { Fail, breakdown, completeToken, releaseIfFree } from "../lib/payToken";
import { requireAuth, requireRole } from "../middleware/auth";

const r = Router();
r.use(requireAuth, requireRole("ADMIN"));

// ───── Payee accounts that need a human look (name mismatch, or the same account used by another user) ─────
r.get("/accounts", async (req, res) => {
  const status = (req.query.status as any) || "PENDING_REVIEW";
  const rows = await prisma.receivingAccount.findMany({ where: { status, active: true }, orderBy: { createdAt: "asc" }, take: 100, include: { user: { select: { fullName: true, role: true, kyc: { select: { status: true } } } } } });
  const shared = await Promise.all(rows.map((a) => prisma.receivingAccount.count({ where: { numberHash: a.numberHash, userId: { not: a.userId }, active: true } })));
  res.json(rows.map((a, i) => ({ id: a.id, user: a.user, bankName: a.bankName, accountName: a.accountName, last4: a.last4, status: a.status, usedByOtherUsers: shared[i], createdAt: a.createdAt })));
});
// Full number is shown only on request and every view is audited
r.get("/accounts/:id/reveal", async (req, res) => {
  const a = await prisma.receivingAccount.findUnique({ where: { id: req.params.id } });
  if (!a) return res.status(404).json({ error: "Not found" });
  await audit(req, "ACCOUNT_NUMBER_VIEWED", "ReceivingAccount", a.id);
  res.json({ accountNumber: decrypt(a.accountNumberEnc) });
});
r.post("/accounts/:id/decision", async (req, res) => {
  const p = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), reason: z.string().max(300).optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  if (p.data.decision === "REJECTED" && (p.data.reason ?? "").trim().length < 3) return res.status(400).json({ error: "A reason is required" });
  const a = await prisma.receivingAccount.update({ where: { id: req.params.id }, data: { status: p.data.decision, rejectReason: p.data.reason, reviewedById: req.user!.id, reviewedAt: new Date() } });
  await audit(req, "ACCOUNT_" + p.data.decision, "ReceivingAccount", a.id);
  await notify([a.userId], "ACCOUNT", p.data.decision === "APPROVED" ? "Bank account approved" : "Bank account rejected", p.data.decision === "APPROVED" ? `${a.bankName} ending ${a.last4} can now receive rent.` : (p.data.reason ?? ""));
  res.json({ status: a.status });
});

// ───── Payment disputes (default view) or any token status ─────
r.get("/tokens", async (req, res) => {
  const status = (req.query.status as any) || "DISPUTED";
  const rows = await prisma.paymentToken.findMany({ where: { status }, orderBy: { updatedAt: "asc" }, take: 100, include: { unit: { select: { title: true, status: true, property: { select: { name: true, owner: { select: { fullName: true, phone: true } } } } } }, tenant: { select: { fullName: true, phone: true } } } });
  res.json(rows.map((t) => ({ id: t.id, code: t.code, kind: t.kind, status: t.status, unit: t.unit, tenant: t.tenant, ...breakdown(t),
    payTo: t.payAccountName ? { name: t.payAccountName, bankName: t.payBankName, last4: decrypt(t.payAccountNumberEnc!).slice(-4) } : null,
    claimedAt: t.claimedAt, claimReference: t.claimReference, hasProof: !!t.proofKey, disputeReason: t.disputeReason, disputedAt: t.disputedAt })));
});

// Settle a dispute. The platform holds no money, so "cancel" does not refund anyone: it frees the unit and tells both sides to settle between themselves.
r.post("/tokens/:id/resolve", async (req, res) => {
  const p = z.object({ outcome: z.enum(["CONFIRM_PAID", "CANCEL"]), notes: z.string().min(3).max(500) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Choose an outcome and write a short note" });
  const t = await prisma.paymentToken.findUnique({ where: { id: req.params.id }, include: { unit: true } });
  if (!t) return res.status(404).json({ error: "Not found" });
  if (t.status !== "DISPUTED") throw new Fail(409, "Only disputed payments can be resolved here");
  await prisma.paymentToken.update({ where: { id: t.id }, data: { resolvedNote: p.data.notes } });

  if (p.data.outcome === "CONFIRM_PAID") {
    await completeToken(t.id, req.user!.id);
  } else {
    await prisma.$transaction(async (tx) => {
      const u = await tx.paymentToken.updateMany({ where: { id: t.id, status: "DISPUTED" }, data: { status: "CANCELLED" } });
      if (u.count === 0) throw new Fail(409, "Already resolved");
      if (t.kind === "NEW_TENANCY") await releaseIfFree(t.id, t.unitId, tx);
    });
    const msg = `Admin closed the dispute on ${t.code}: ${p.data.notes}. The platform does not hold rent money. If a transfer was made, the receiver and tenant must settle any refund directly.`;
    await notify([t.tenantId, ...(await staffOf(t.unit.propertyId))], "DISPUTE", "Dispute closed", msg);
  }
  await audit(req, "TOKEN_DISPUTE_" + p.data.outcome, "PaymentToken", t.id, { notes: p.data.notes });
  res.json({ resolved: p.data.outcome });
});

export default r;
