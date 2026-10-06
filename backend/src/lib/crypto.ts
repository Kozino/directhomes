import crypto from "crypto";

// AES-256-GCM for bank account numbers. Key: 64 hex chars in DATA_ENC_KEY (generate with: openssl rand -hex 32).
// Losing this key makes stored account numbers unreadable, so back it up with your other secrets.
function key() {
  const k = Buffer.from(process.env.DATA_ENC_KEY ?? "", "hex");
  if (k.length !== 32) throw new Error("DATA_ENC_KEY must be 64 hex characters (openssl rand -hex 32)");
  return k;
}
export function encrypt(plain: string) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}
export function decrypt(blob: string) {
  const b = Buffer.from(blob, "base64"), d = crypto.createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}
