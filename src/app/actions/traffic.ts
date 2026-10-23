"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, getProduct } from "@/server/context";
import { updateSiteSettings } from "@/server/services/traffic";
import { fail, ok, str, toFailure, type ActionResult } from "@/lib/action-result";

const schema = z.object({
  domain: z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "Domain is like backapp.live, without https://").nullable(),
  app_store_url: z.string().regex(/^https:\/\/apps\.apple\.com\//, "App Store link starts with https://apps.apple.com/").nullable(),
  app_store_pt: z.string().regex(/^[0-9]{3,20}$/, "The provider token is digits only (App Store Connect → Analytics → Campaigns → Generate a link, the pt= part)").nullable(),
});

export async function saveSiteSettingsAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const parsed = schema.safeParse({
      domain: str(data.get("domain")).replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase() || null,
      app_store_url: str(data.get("app_store_url")) || null,
      app_store_pt: str(data.get("app_store_pt")) || null,
    });
    if (!parsed.success) return fail(parsed.error.issues.map((i) => i.message).join(" "));
    await db((tx, ctx) => updateSiteSettings(tx, ctx.workspaceId, product.id, parsed.data), { reason: "Website counter settings changed" });
    revalidatePath(`/p/${slug}/analytics`);
    return ok("Saved. The links and the code below now use these settings.");
  } catch (e) {
    return toFailure(e, (x) => (x as Error).message);
  }
}
