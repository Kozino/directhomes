import crypto from "crypto";
import { prisma } from "./prisma";
import { addMonths, graceEnd } from "./fees";

export const paystackConfigured = () => !!process.env.PAYSTACK_SECRET_KEY;

export async function initCheckout(email: string, amountKobo: number, reference: string, meta: object) {
  const r = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, amount: amountKobo, reference, currency: "NGN", callback_url: `${process.env.APP_URL}/payment-complete`, metadata: meta }),
  });
  const d: any = await r.json();
  if (!r.ok || !d.status) throw new Error("Could not start payment");
  return d.data.authorization_url as string;
}

export function validSignature(raw: Buffer, sig?: string) {
  if (!sig || !process.env.PAYSTACK_SECRET_KEY) return false;
  const h = crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY).update(raw).digest("hex");
  return h.length === sig.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(sig));
}

// Idempotent: safe if Paystack retries the webhook. Amount is checked against OUR record, never the client's.
export async function settlePayment(reference: string, paidKobo: number, payload?: object) {
  const tx = await prisma.transaction.findUnique({ where: { reference } });
  if (!tx) return "unknown";
  if (paidKobo !== tx.amountKobo) { await prisma.transaction.updateMany({ where: { id: tx.id, status: "PENDING" }, data: { status: "FAILED", rawWebhook: payload as any } }); return "mismatch"; }
  const claim = await prisma.transaction.updateMany({ where: { id: tx.id, status: { not: "SUCCESS" } }, data: { status: "SUCCESS", rawWebhook: payload as any } });
  if (claim.count === 0) return "duplicate";

  const ob = await prisma.propertyOnboarding.findUnique({ where: { transactionId: tx.id } });
  if (ob) {
    const now = new Date();
    if (tx.purpose === "RENEWAL") {
      const prev = ob.renewedFromId ? await prisma.propertyOnboarding.findUnique({ where: { id: ob.renewedFromId } }) : null;
      const start = prev?.expiresAt && prev.expiresAt > now ? prev.expiresAt : now; // no days lost on early renewal
      const exp = addMonths(start, 12);
      await prisma.$transaction([
        prisma.propertyOnboarding.update({ where: { id: ob.id }, data: { paidAt: now, approvedAt: now, startsAt: start, expiresAt: exp, graceEndsAt: graceEnd(exp) } }),
        prisma.property.update({ where: { id: ob.propertyId }, data: { status: "ACTIVE" } }),
      ]);
    } else {
      const exp = addMonths(now, 12); // first year starts when the owner pays and the property goes live
      await prisma.$transaction([
        prisma.propertyOnboarding.update({ where: { id: ob.id }, data: { paidAt: now, approvedAt: now, startsAt: now, expiresAt: exp, graceEndsAt: graceEnd(exp) } }),
        prisma.property.updateMany({ where: { id: ob.propertyId, status: "VERIFIED" }, data: { status: "ACTIVE" } }),
      ]);
    }
  }
  await prisma.notification.create({ data: { userId: tx.userId, type: "PAYMENT", title: "Payment received", body: `We received your payment (${reference}). Your property is now live.` } });
  return "ok";
}
