import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";

export type JwtPayload = { id: string; role: Role };

export const signAccess = (p: JwtPayload) =>
  jwt.sign(p, process.env.JWT_ACCESS_SECRET!, { expiresIn: "15m" });
export const signRefresh = (p: JwtPayload) =>
  jwt.sign(p, process.env.JWT_REFRESH_SECRET!, { expiresIn: "30d" });
export const verifyAccess = (t: string) => jwt.verify(t, process.env.JWT_ACCESS_SECRET!) as JwtPayload;
export const verifyRefresh = (t: string) => jwt.verify(t, process.env.JWT_REFRESH_SECRET!) as JwtPayload;
