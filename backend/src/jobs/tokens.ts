import { prisma } from "../lib/prisma";
import { notify, staffOf } from "../lib/access";
import { adminIds, naira, releaseUnit, totalOf } from "../lib/payToken";

const HOUR = 3600_000, DAY = 24 * HOUR;

// Runs every 5 minutes. Safe to run twice: every step re-checks status before changing anything.
export async function runTokenJob() {
  const now = new Date();

  // 1) Approved tokens that were not paid in time: free the unit
  const lapsed = await prisma.paymentToken.findMany({ where: { status: "ACTIVE", expiresAt: { lt: now } }, include: { unit: { select: { title: true, propertyId: true } } } });
  for (const t of lapsed) {
    const done = await prisma.$transaction(async (tx) => {
      const u = await tx.paymentToken.updateMany({ where: { id: t.id, status: "ACTIVE" }, data: { status: "EXPIRED" } });
      if (u.count && t.kind === "NEW_TENANCY") await releaseUnit(t.unitId, tx);
      return u.count > 0;
    });
    if (done) {
      await notify([t.tenantId], "TOKEN", "Token expired", `The time to pay for "${t.unit.title}" ran out. If you already sent the money, open the request and tell us within 24 hours.`);
      await notify(await staffOf(t.unit.propertyId), "TOKEN", "Token expired", `Code ${t.code} for "${t.unit.title}" was not paid in time. The unit is available again.`);
    }
  }

  // 2) Requests nobody answered for 7 days
  await prisma.paymentToken.updateMany({ where: { status: "REQUESTED", createdAt: { lt: new Date(now.getTime() - 7 * DAY) } }, data: { status: "EXPIRED" } });

  // 3) Tenant says paid, receiver silent for 48h: send to admin
  const silent = await prisma.paymentToken.findMany({ where: { status: "PAYMENT_CLAIMED", claimedAt: { lt: new Date(now.getTime() - 48 * HOUR) } }, include: { unit: { select: { title: true, propertyId: true } } } });
  for (const t of silent) {
    const u = await prisma.paymentToken.updateMany({ where: { id: t.id, status: "PAYMENT_CLAIMED" }, data: { status: "DISPUTED", disputeReason: "No response from the receiver within 48 hours", disputedAt: now } });
    if (!u.count) continue;
    await notify([t.tenantId], "DISPUTE", "Sent to admin", `Nobody confirmed your payment for "${t.unit.title}" in 48 hours, so an admin will look at it.`);
    await notify(await staffOf(t.unit.propertyId), "DISPUTE", "Confirm or respond now", `${naira(totalOf(t))} claimed for "${t.unit.title}" (${t.code}) was escalated to admin. Confirm receipt or say it wasn't received.`);
    await notify(await adminIds(), "DISPUTE", "Payment dispute", `Token ${t.code}: no response within 48 hours.`);
  }

  // 4) Rent reminders to tenant and landlord side: 60/30/14/7/1 days before the tenancy ends
  const upcoming = await prisma.tenancy.findMany({ where: { active: true, endsAt: { lt: new Date(now.getTime() + 61 * DAY) } }, include: { unit: { select: { title: true, propertyId: true } } } });
  for (const t of upcoming) {
    const left = Math.ceil((t.endsAt.getTime() - now.getTime()) / DAY);
    const mark = left > 0 ? [1, 7, 14, 30, 60].find((d) => left <= d) : undefined; // each threshold fires once
    const type = `RENT_${mark ?? "OVER"}D:${t.id}:${t.endsAt.getTime()}`; // endsAt in the key: a renewal starts a fresh reminder cycle
    if (await prisma.notification.findFirst({ where: { userId: t.tenantId, type } })) continue;
    const text = left > 0 ? `Your tenancy of "${t.unit.title}" ends in ${left} day(s). Request a renewal to keep your home.` : `Your tenancy of "${t.unit.title}" has ended. Renew or move out.`;
    await prisma.notification.create({ data: { userId: t.tenantId, type, title: left > 0 ? "Rent due soon" : "Tenancy ended", body: text } });
    await notify(await staffOf(t.unit.propertyId), "TENANCY", left > 0 ? "Tenancy ending soon" : "Tenancy past end date", `"${t.unit.title}": ${left > 0 ? left + " day(s) left" : "end date passed"}.`);
  }
}
