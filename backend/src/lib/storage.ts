import fs from "fs";
import path from "path";
import type { Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";

// With SUPABASE_URL + SUPABASE_SERVICE_KEY set, files live in Supabase Storage (survives Render redeploys).
// Without them (local dev) everything stays on disk exactly as before.
const sb = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } }) : null;
const PUB = process.env.SUPABASE_PUBLIC_BUCKET || "listing-photos", PRIV = process.env.SUPABASE_PRIVATE_BUCKET || "private-files";
const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".pdf": "application/pdf", ".mp4": "video/mp4" };
const SAFE = /^[\w-]+\.\w+$/;

/** Call after multer saved the file, once the request is accepted. Moves it to Supabase and removes the temp copy. */
export async function persist(file: Express.Multer.File | undefined, scope: "public" | "private") {
  if (!file || !sb) return;
  const buf = await fs.promises.readFile(file.path);
  const { error } = await sb.storage.from(scope === "public" ? PUB : PRIV).upload(file.filename, buf, { contentType: file.mimetype });
  await fs.promises.unlink(file.path).catch(() => {});
  if (error) throw new Error("File storage failed: " + error.message);
}
/** Remove an upload from a rejected request (temp copy and any stored copy). */
export function discard(file?: Express.Multer.File) {
  if (!file) return;
  fs.unlink(file.path, () => {});
  if (sb) for (const b of [PUB, PRIV]) sb.storage.from(b).remove([file.filename]).then(() => {}, () => {});
}
export async function readPrivate(key: string): Promise<Buffer | null> {
  if (!SAFE.test(key)) return null;
  if (sb) { const { data, error } = await sb.storage.from(PRIV).download(key); return error || !data ? null : Buffer.from(await data.arrayBuffer()); }
  return fs.promises.readFile(path.resolve("private-uploads", key)).catch(() => null);
}
export async function writePrivate(key: string, buf: Buffer) {
  if (sb) { const { error } = await sb.storage.from(PRIV).upload(key, buf, { contentType: MIME[path.extname(key)] || "application/octet-stream", upsert: true }); if (error) throw new Error("File storage failed: " + error.message); return; }
  await fs.promises.mkdir("private-uploads", { recursive: true });
  await fs.promises.writeFile(path.resolve("private-uploads", key), buf);
}
export async function sendPrivate(res: Response, key: string) {
  const buf = await readPrivate(key);
  if (!buf) return res.status(404).json({ error: "Not found" });
  res.set("X-Content-Type-Options", "nosniff").type(MIME[path.extname(key)] || "application/octet-stream").send(buf);
}
export async function hasPublic(name: string) {
  if (!/^[\w-]+\.(jpg|png|webp)$/.test(name)) return false;
  if (sb) { const { data } = await sb.storage.from(PUB).list("", { search: name, limit: 5 }); return !!data?.some((f) => f.name === name); }
  return fs.existsSync(path.resolve("public-uploads", name));
}
/** GET /media/:name */
export function mediaHandler(req: Request, res: Response) {
  const name = req.params.name;
  if (!/^[\w-]+\.(jpg|png|webp)$/.test(name)) return res.status(404).end();
  if (sb) return res.set("Cache-Control", "public, max-age=86400").redirect(302, sb.storage.from(PUB).getPublicUrl(name).data.publicUrl);
  res.set("X-Content-Type-Options", "nosniff").sendFile(path.resolve("public-uploads", name), (e) => e && !res.headersSent && res.status(404).end());
}
