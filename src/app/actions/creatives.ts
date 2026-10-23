"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db, getProduct } from "@/server/context";
import { describeDbError } from "@/server/db/client";
import { fileStore } from "@/server/storage";
import { fail, ok, str, toFailure, type ActionResult } from "@/lib/action-result";

const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export async function uploadAssetAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const file = data.get("file");
    if (!(file instanceof File) || !file.size) return fail("Choose an image.");
    const ext = TYPES[file.type];
    if (!ext) return fail("Upload PNG, JPEG or WebP images.");
    if (file.size > 5 * 1024 * 1024) return fail("The image is larger than 5 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha = createHash("sha256").update(bytes).digest("hex");
    const key = `${product.workspace_id}/${product.id}/assets/${sha}.${ext}`;
    await fileStore().put(key, bytes, file.type);
    const rights = str(data.get("rights_note"));
    if (!rights) return fail("Note where the image comes from and that you may use it.");
    await db((tx, ctx) =>
      tx.query(
        "insert into creative_assets (workspace_id, product_id, kind, title, storage_path, mime_type, byte_size, sha256, origin, tags, rights_note) values ($1,$2,'image',$3,$4,$5,$6,$7,$8,$9,$10)",
        [ctx.workspaceId, product.id, str(data.get("title")) || file.name, key, file.type, file.size, sha, str(data.get("origin")) || "uploaded",
         str(data.get("tags")).split(",").map((t) => t.trim()).filter(Boolean), rights],
      ),
    { reason: "creative uploaded" });
    revalidatePath(`/p/${slug}/creatives`);
    return ok("Image added.");
  } catch (e) {
    return toFailure(e, describeDbError);
  }
}

const MEDIA: Record<string, { ext: string; kind: "video" | "audio" | "image"; max: number }> = {
  "video/mp4": { ext: "mp4", kind: "video", max: 50 },
  "video/quicktime": { ext: "mov", kind: "video", max: 50 },
  "video/webm": { ext: "webm", kind: "video", max: 50 },
  "audio/mpeg": { ext: "mp3", kind: "audio", max: 30 },
  "audio/mp4": { ext: "m4a", kind: "audio", max: 30 },
  "audio/x-m4a": { ext: "m4a", kind: "audio", max: 30 },
  "audio/wav": { ext: "wav", kind: "audio", max: 30 },
  "audio/x-wav": { ext: "wav", kind: "audio", max: 30 },
  "image/png": { ext: "png", kind: "image", max: 20 },
  "image/jpeg": { ext: "jpg", kind: "image", max: 20 },
  "image/webp": { ext: "webp", kind: "image", max: 20 },
};

/**
 * Large files (video, music) go straight from the browser to private storage: the server hands out a one-time upload
 * link for one path, then records the asset once the browser reports the upload done.
 */
export async function startMediaUploadAction(slug: string, file: { name: string; type: string; size: number }): Promise<{ url?: string; key?: string; error?: string }> {
  const product = await getProduct(slug);
  const t = MEDIA[file.type];
  if (!t) return { error: "Upload MP4, MOV or WebM video, MP3, M4A or WAV audio, or PNG, JPEG, WebP images." };
  if (file.size > t.max * 1024 * 1024) return { error: `This file is larger than ${t.max} MB. Shorten or compress it (a 20–40 second clip is plenty: it loops).` };
  const key = `${product.workspace_id}/${product.id}/assets/${crypto.randomUUID()}.${t.ext}`;
  const url = await fileStore().signedUploadUrl(key);
  if (!url) return { error: "Large uploads need Supabase storage (they work on the hosted app)." };
  return { url, key };
}

export async function finishMediaUploadAction(slug: string, key: string, meta: { name: string; type: string; size: number; title: string; tags: string; rights_note: string }): Promise<{ ok: boolean; message: string }> {
  try {
    const product = await getProduct(slug);
    const t = MEDIA[meta.type];
    if (!t || !key.startsWith(`${product.workspace_id}/${product.id}/assets/`)) return { ok: false, message: "Unknown upload." };
    if (!meta.rights_note.trim()) return { ok: false, message: "Note where the file comes from and that you may use it." };
    await db((tx, ctx) =>
      tx.query(
        "insert into creative_assets (workspace_id, product_id, kind, title, storage_path, mime_type, byte_size, origin, tags, rights_note) values ($1,$2,$3,$4,$5,$6,$7,'uploaded',$8,$9)",
        [ctx.workspaceId, product.id, t.kind, meta.title.trim() || meta.name, key, meta.type, meta.size,
         meta.tags.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean), meta.rights_note.trim()],
      ),
    { reason: "creative uploaded" });
    revalidatePath(`/p/${slug}/creatives`);
    return { ok: true, message: `${t.kind === "video" ? "Video" : t.kind === "audio" ? "Music" : "Image"} added.` };
  } catch (e) {
    return { ok: false, message: describeDbError(e) };
  }
}
