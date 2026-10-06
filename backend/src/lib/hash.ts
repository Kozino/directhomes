import crypto from "crypto";
// Peppered hash: lets us detect duplicate IDs/phones without storing them in plain text.
export const hashValue = (v: string) =>
  crypto.createHash("sha256").update(v.trim().toUpperCase() + (process.env.HASH_PEPPER ?? "")).digest("hex");
