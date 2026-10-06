import { Request, Response, NextFunction } from "express";
import { Role } from "@prisma/client";
import { verifyAccess, JwtPayload } from "../lib/tokens";
import { prisma } from "../lib/prisma";

declare global {
  namespace Express {
    interface Request { user?: JwtPayload }
  }
}

// 1) Must be logged in, and account must still be ACTIVE
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Not authenticated" });
  try {
    const payload = verifyAccess(header.slice(7));
    const user = await prisma.user.findUnique({ where: { id: payload.id }, select: { status: true, role: true } });
    if (!user || user.status !== "ACTIVE") return res.status(403).json({ error: "Account unavailable" });
    req.user = { id: payload.id, role: user.role };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// 2) Must hold one of the allowed roles
export const requireRole = (...roles: Role[]) => (req: Request, res: Response, next: NextFunction) => {
  if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: "Forbidden" });
  next();
};
