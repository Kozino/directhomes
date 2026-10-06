import { Request } from "express";
import { prisma } from "./prisma";

// Record every sensitive action (admin edits, approvals, etc.)
export async function audit(req: Request, action: string, entity: string, entityId?: string, meta?: object) {
  if (!req.user) return;
  await prisma.auditLog.create({
    data: { actorId: req.user.id, action, entity, entityId, meta: meta as any, ip: req.ip },
  });
}
