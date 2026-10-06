import { prisma } from "../lib/prisma";

// Runs hourly: sends renewal reminders and hides properties whose grace period has ended.
export async function runExpiryJob() {
  const now = new Date();
  const props = await prisma.property.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, ownerId: true } });
  for (const p of props) {
    const last = await prisma.propertyOnboarding.findFirst({ where: { propertyId: p.id, expiresAt: { not: null } }, orderBy: { expiresAt: "desc" } });
    if (!last?.expiresAt || !last.graceEndsAt) continue;
    if (last.graceEndsAt < now) {
      await prisma.property.update({ where: { id: p.id }, data: { status: "EXPIRED" } }); // listings vanish from search; tenancies/data untouched
      await prisma.notification.create({ data: { userId: p.ownerId, type: "EXPIRED", title: "Listing hidden", body: `${p.name}: renew to make your units visible again.` } });
      continue;
    }
    const daysLeft = Math.ceil((last.expiresAt.getTime() - now.getTime()) / 86_400_000);
    if ([60, 30, 14, 7, 1].includes(daysLeft)) {
      const type = `RENEWAL_${daysLeft}D:${p.id}:${last.expiresAt.getFullYear()}`;
      if (!(await prisma.notification.findFirst({ where: { userId: p.ownerId, type } })))
        await prisma.notification.create({ data: { userId: p.ownerId, type, title: "Renewal due soon", body: `${p.name} expires in ${daysLeft} day(s). Renew to keep your units listed.` } });
    }
  }
}
