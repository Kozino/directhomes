import { Role, Prisma } from "@prisma/client";
import { prisma } from "./prisma";

// Properties an owner owns, or a manager is actively assigned to (directly or via the estate they sit in)
export const propScope = (userId: string, role: Role): Prisma.PropertyWhereInput =>
  role === "OWNER"
    ? { ownerId: userId }
    : { OR: [{ managers: { some: { managerId: userId, active: true } } }, { parent: { managers: { some: { managerId: userId, active: true } } } }] };
export const unitScope = (userId: string, role: Role): Prisma.UnitWhereInput => ({ property: propScope(userId, role) });

export async function propertyRole(userId: string, propertyId: string) {
  const p = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!p) return null;
  if (p.ownerId === userId) return { property: p, isOwner: true, canListUnits: true, canSetPrice: true };
  const a = await prisma.managerAssignment.findFirst({ where: { managerId: userId, active: true, propertyId: { in: [p.id, ...(p.parentId ? [p.parentId] : [])] } } });
  return a ? { property: p, isOwner: false, canListUnits: a.canListUnits, canSetPrice: a.canSetPrice } : null;
}

export async function staffOf(propertyId: string) {
  const p = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!p) return [];
  const as = await prisma.managerAssignment.findMany({ where: { active: true, propertyId: { in: [p.id, ...(p.parentId ? [p.parentId] : [])] } }, select: { managerId: true } });
  return [...new Set([p.ownerId, ...as.map((a) => a.managerId)])];
}

export async function notify(userIds: string[], type: string, title: string, body: string) {
  if (userIds.length) await prisma.notification.createMany({ data: userIds.map((userId) => ({ userId, type, title, body })) });
}
