import crypto from "crypto";
import { prisma } from "./prisma";
import { hashValue } from "./hash";

export type Channel = "EMAIL" | "PHONE";

async function deliver(channel: Channel, target: string, code: string) {
  const msg = `Your Direct Homes verification code is ${code}. It expires in 10 minutes.`;
  const sms = channel === "PHONE" && process.env.TERMII_API_KEY, mail = channel === "EMAIL" && process.env.RESEND_API_KEY;
  if (!sms && !mail) { if (process.env.NODE_ENV !== "production") console.log(`[DEV OTP] ${channel} ${target}: ${code}`); else console.warn("OTP provider not configured"); return; }
  const r = sms
    ? await fetch("https://api.ng.termii.com/api/sms/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: target.replace(/^\+/, "").replace(/^0/, "234"), from: process.env.TERMII_SENDER_ID || "N-Alert", sms: msg, type: "plain", channel: process.env.TERMII_CHANNEL || "generic", api_key: process.env.TERMII_API_KEY }) })
    : await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.RESEND_API_KEY }, body: JSON.stringify({ from: process.env.MAIL_FROM, to: target, subject: "Your verification code", text: msg }) });
  if (!r.ok) { console.error("OTP delivery failed", r.status, await r.text().catch(() => "")); throw new Error("We could not send the code. Please try again shortly."); }
}

export async function issueOtp(userId: string, channel: Channel, target: string) {
  const last = await prisma.otpCode.findFirst({ where: { userId, channel }, orderBy: { createdAt: "desc" } });
  if (last && Date.now() - last.createdAt.getTime() < 60_000) throw new Error("Please wait 60 seconds before requesting another code");
  const code = crypto.randomInt(100000, 1000000).toString();
  await prisma.otpCode.create({ data: { userId, channel, codeHash: hashValue(code + userId), expiresAt: new Date(Date.now() + 10 * 60_000) } });
  await deliver(channel, target, code);
}

export async function checkOtp(userId: string, channel: Channel, code: string) {
  const otp = await prisma.otpCode.findFirst({ where: { userId, channel, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
  if (!otp || otp.attempts >= 5) return false;
  await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
  const a = Buffer.from(otp.codeHash), b = Buffer.from(hashValue(code + userId));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  await prisma.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } });
  return true;
}
