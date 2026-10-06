import { prisma } from "../lib/prisma";
import { notify, staffOf } from "../lib/access";
import { adminIds } from "../lib/payToken";
import { ACTIVE, AUTO_CLOSE_DAYS, slaDays } from "../lib/tickets";

const DAY = 86_400_000;

// Runs hourly. Safe to run twice: every change re-checks the status first.
export async function runTicketJob() {
  const now = Date.now();

  // 1) Escalate to admin when a ticket is still not resolved after its SLA (measured from creation, or from the last reopen)
  const open = await prisma.maintenanceTicket.findMany({ where: { status: { in: ACTIVE }, escalated: false }, include: { unit: { select: { title: true, propertyId: true } } } });
  for (const t of open) {
    if (now - t.slaStartAt.getTime() < slaDays(t.urgency) * DAY) continue;
    const u = await prisma.maintenanceTicket.updateMany({ where: { id: t.id, escalated: false, status: { in: ACTIVE } }, data: { escalated: true, escalatedAt: new Date() } });
    if (!u.count) continue;
    await notify(await adminIds(), "TICKET", "Maintenance ticket escalated", `"${t.title}" at "${t.unit.title}" is still ${t.status.toLowerCase().replace("_", " ")} after ${slaDays(t.urgency)} day(s).`);
    await notify(await staffOf(t.unit.propertyId), "TICKET", "Ticket escalated to admin", `"${t.title}" at "${t.unit.title}" passed its response time and was sent to admin. Please act on it.`);
    await notify([t.tenantId], "TICKET", "Your issue was escalated", `We sent "${t.title}" to an admin because it has taken too long.`);
  }

  // 2) Tenant never answered a "resolved" ticket: close it
  const stale = await prisma.maintenanceTicket.findMany({ where: { status: "RESOLVED", resolvedAt: { lt: new Date(now - AUTO_CLOSE_DAYS * DAY) } }, include: { unit: { select: { title: true, propertyId: true } } } });
  for (const t of stale) {
    const u = await prisma.maintenanceTicket.updateMany({ where: { id: t.id, status: "RESOLVED" }, data: { status: "CLOSED", closedAt: new Date() } });
    if (!u.count) continue;
    await notify([t.tenantId], "TICKET", "Ticket closed", `"${t.title}" was closed automatically because it was marked resolved ${AUTO_CLOSE_DAYS} days ago. You can still reopen it within 7 days.`);
    await notify(await staffOf(t.unit.propertyId), "TICKET", "Ticket closed", `"${t.title}" at "${t.unit.title}" closed automatically.`);
  }
}
