"use server";

import { revalidatePath } from "next/cache";
import { db, getProduct } from "@/server/context";
import { liveAscDeps, validateCredentials } from "@/server/appstore/api";
import { connectAppStore, disconnectAppStore, syncAppStore } from "@/server/services/app-store";
import { fail, ok, str, toFailure, type ActionResult } from "@/lib/action-result";

const msg = (x: unknown) => (x as Error).message;

/** Connect: the key is checked against Apple first, then stored encrypted; the .p8 text never leaves the server. */
export async function connectAppStoreAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const file = data.get("p8");
    const pasted = str(data.get("p8_text"));
    const privateKey = file instanceof File && file.size > 0 ? (file.size > 10_000 ? "" : await file.text()) : pasted;
    if (!privateKey) return fail("Choose the .p8 key file.");
    const creds = validateCredentials({ issuerId: str(data.get("issuer_id")), keyId: str(data.get("key_id")), privateKey });
    const appId = str(data.get("app_id")).replace(/^id/i, "");
    const r = await db((tx, ctx) => connectAppStore(tx, ctx.workspaceId, product.id, creds, appId, liveAscDeps), { reason: "App Store Connect connected (read-only analytics)" });
    revalidatePath(`/p/${slug}/connections`);
    revalidatePath(`/p/${slug}/analytics`);
    return ok(`Connected to ${r.app}. Apple prepares the first downloads report within 1–2 days; it is read every morning.`);
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function disconnectAppStoreAction(slug: string): Promise<void> {
  const product = await getProduct(slug);
  await db((tx) => disconnectAppStore(tx, product.id), { reason: "App Store Connect disconnected; key deleted" });
  revalidatePath(`/p/${slug}/connections`);
}

export async function syncAppStoreAction(slug: string, _: ActionResult | null): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const r = await db((tx) => syncAppStore(tx, product.id, liveAscDeps, 6), { reason: "App Store downloads read" });
    revalidatePath(`/p/${slug}/analytics`);
    if ("error" in r && r.error) return fail(r.error);
    if ("skipped" in r && r.skipped) return fail(r.skipped);
    if ("note" in r && r.note) return ok(r.note);
    return ok(`Read ${"imported" in r ? r.imported : 0} new daily report(s).`);
  } catch (e) {
    return toFailure(e, msg);
  }
}
