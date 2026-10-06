import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { signAccess, signRefresh, verifyRefresh } from "../lib/tokens";
import { requireAuth } from "../middleware/auth";

const r = Router();

// Admins can NEVER self-register; they are created via seed/admin panel.
const registerSchema = z.object({
  role: z.enum(["TENANT", "OWNER", "MANAGER"]),
  fullName: z.string().min(2),
  email: z.string().email(),
  phone: z.string().regex(/^(\+234|0)[789][01]\d{8}$/, "Invalid Nigerian phone number"),
  password: z.string().min(8),
});

r.post("/register", async (req, res) => {
  const p = registerSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ errors: p.error.flatten() });
  const { password, ...d } = p.data;
  const exists = await prisma.user.findFirst({ where: { OR: [{ email: d.email }, { phone: d.phone }] } });
  if (exists) return res.status(409).json({ error: "Email or phone already registered" });
  const user = await prisma.user.create({
    data: { ...d, passwordHash: await bcrypt.hash(password, 12) },
    select: { id: true, role: true, fullName: true, email: true },
  });
  // TODO Phase 2: send email/phone OTP
  res.status(201).json({ user, accessToken: signAccess(user), refreshToken: signRefresh(user) });
});

r.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  const user = await prisma.user.findUnique({ where: { email: String(email ?? "") } });
  if (!user || !(await bcrypt.compare(String(password ?? ""), user.passwordHash)))
    return res.status(401).json({ error: "Invalid credentials" });
  if (user.status !== "ACTIVE") return res.status(403).json({ error: `Account ${user.status.toLowerCase()}` });
  const payload = { id: user.id, role: user.role };
  res.json({
    user: { id: user.id, role: user.role, fullName: user.fullName },
    accessToken: signAccess(payload),
    refreshToken: signRefresh(payload),
  });
});

r.post("/refresh", async (req, res) => {
  try {
    const p = verifyRefresh(String(req.body?.refreshToken ?? ""));
    res.json({ accessToken: signAccess({ id: p.id, role: p.role }) });
  } catch {
    res.status(401).json({ error: "Invalid refresh token" });
  }
});

r.get("/me", requireAuth, async (req, res) => {
  const me = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, role: true, fullName: true, email: true, phone: true, kyc: { select: { status: true } } },
  });
  res.json(me);
});

export default r;
