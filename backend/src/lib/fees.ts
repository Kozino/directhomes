import { PropertyKind } from "@prisma/client";
import { prisma } from "./prisma";

// Pick the admin-configured tier matching property type and number of units
export async function pickTier(kind: PropertyKind, units: number) {
  const tiers = await prisma.onboardingFeeTier.findMany({
    where: { kind, active: true, minUnits: { lte: units }, OR: [{ maxUnits: null }, { maxUnits: { gte: units } }] },
    orderBy: { minUnits: "desc" },
  });
  return tiers[0] ?? null;
}
export const addMonths = (d: Date, m: number) => { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; };
export const graceEnd = (exp: Date) => new Date(exp.getTime() + Number(process.env.GRACE_DAYS ?? 14) * 86_400_000);
