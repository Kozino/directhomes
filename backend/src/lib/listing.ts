import { prisma } from "./prisma";

// A unit may appear in tenant search ONLY when this returns true.
// Houses inside an individually-owned estate inherit the estate's status and fee period.
export async function isPropertyListable(propertyId: string) {
  const p = await prisma.property.findUnique({ where: { id: propertyId }, include: { parent: true, owner: { select: { kyc: { select: { status: true } }, status: true } } } });
  if (!p) return false;
  const root = p.parent ?? p;
  if (root.status !== "ACTIVE" || p.owner.status !== "ACTIVE" || p.owner.kyc?.status !== "VERIFIED") return false;
  const last = await prisma.propertyOnboarding.findFirst({ where: { propertyId: root.id, expiresAt: { not: null } }, orderBy: { expiresAt: "desc" } });
  return !!last?.graceEndsAt && last.graceEndsAt >= new Date(); // grace period keeps it visible
}

// Prisma conditions that make a unit publicly visible. Use in EVERY tenant-facing query.
import type { Prisma } from "@prisma/client";
export const liveConds = (now = new Date()): Prisma.UnitWhereInput[] => {
  const paid = { onboardings: { some: { graceEndsAt: { gte: now } } } };
  return [
    { property: { OR: [{ status: "ACTIVE", ...paid }, { parent: { status: "ACTIVE", ...paid } }] } },
    { property: { owner: { status: "ACTIVE", kyc: { is: { status: "VERIFIED" } } } } },
    { flaggedAt: null }, // hidden by enough user reports until an admin decides
  ];
};
