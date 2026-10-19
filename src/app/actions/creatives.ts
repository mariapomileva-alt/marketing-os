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
