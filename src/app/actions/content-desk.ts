"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, getProduct } from "@/server/context";
import { describeDbError } from "@/server/db/client";
import { addOwnReel, approveDeskItem, generateDesk, rejectDeskItem, rerenderReel, updateDeskSettings, type DeskEdits } from "@/server/services/content-desk";
import type { ReelSpec } from "@/domain/ai/schemas";
import { liveDeskMedia } from "@/server/desk/live";
import { fail, ok, str, toFailure, type ActionResult } from "@/lib/action-result";

const msg = (x: unknown) => (x instanceof Error && !("code" in x) ? x.message : describeDbError(x));
const actorOf = (ctx: { workspaceId: string; user: { id: string } }) => ({ workspaceId: ctx.workspaceId, userId: ctx.user.id });
const path = (slug: string) => `/p/${slug}/ideas`;
const when = (d: Date) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Riga" }).format(d);

const settingsSchema = z.object({
  enabled: z.boolean(),
  posts_per_day: z.coerce.number().int().min(0).max(3),
  carousels_per_day: z.coerce.number().int().min(0).max(3),
  reels_per_day: z.coerce.number().int().min(0).max(3),
  articles_per_week: z.coerce.number().int().min(0).max(7),
  slots: z.array(z.string()),
  web_research: z.boolean(),
});

export async function saveDeskSettingsAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const parsed = settingsSchema.safeParse({
      enabled: data.get("enabled") === "on", posts_per_day: data.get("posts_per_day"), carousels_per_day: data.get("carousels_per_day"),
      reels_per_day: data.get("reels_per_day"), articles_per_week: data.get("articles_per_week"), slots: str(data.get("slots")).split(/[,\s]+/),
      web_research: data.get("web_research") === "on",
    });
    if (!parsed.success) return fail(parsed.error.issues.map((i) => i.message).join(" "));
    await db((tx, ctx) => updateDeskSettings(tx, ctx.workspaceId, product.id, parsed.data), { reason: "Content desk settings changed" });
    revalidatePath(path(slug));
    return ok("Saved.");
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function generateDeskAction(slug: string, _: ActionResult | null): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const r = await db((tx, ctx) => generateDesk(tx, actorOf(ctx), product.id, liveDeskMedia()), { reason: "Content desk prepared", actorType: "ai" });
    revalidatePath(path(slug));
    const waiting = r.created.filter((c) => c.status === "waiting").length;
    const blocked = r.created.length - waiting;
    return r.created.length ? ok(`${waiting} piece(s) wait for your approval${blocked ? `, ${blocked} stopped by the safety rules` : ""}.`) : ok("Nothing to make: all counts are 0 in the settings.");
  } catch (e) {
    return toFailure(e, msg);
  }
}

function editsFrom(data: FormData): DeskEdits {
  const caption = data.get("caption");
  const hook = data.get("hook");
  const slides: Array<{ title: string; text: string }> = [];
  for (let i = 0; i < 10; i++) {
    const t = data.get(`slide_title_${i}`);
    if (typeof t !== "string") break;
    slides.push({ title: t, text: str(data.get(`slide_text_${i}`)) });
  }
  return {
    caption: typeof caption === "string" ? caption : undefined,
    hookIndex: typeof hook === "string" && hook !== "" ? Number(hook) : undefined,
    slides: slides.length ? slides : undefined,
  };
}

export async function approveDeskAction(slug: string, itemId: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const r = await db((tx, ctx) => approveDeskItem(tx, actorOf(ctx), product.id, itemId, liveDeskMedia(), editsFrom(data)), { reason: "Content desk piece approved" });
    revalidatePath(path(slug));
    if (!r.scheduledFor) return ok(r.note ?? "Saved.");
    return ok(r.kind === "article" ? `Approved. Planned for ${when(r.scheduledFor)}: copy the brief for the article.` : `Approved. It goes out on Instagram on ${when(r.scheduledFor)}.`);
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function rejectDeskAction(slug: string, itemId: string, _: ActionResult | null): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    await db((tx, ctx) => rejectDeskItem(tx, actorOf(ctx), product.id, itemId), { reason: "Content desk piece removed" });
    revalidatePath(path(slug));
    return ok("Removed.");
  } catch (e) {
    return toFailure(e, msg);
  }
}

/** The Reel fields of a form (the same fields on a desk Reel card and in "Add a Reel of your own"). */
function reelFromForm(data: FormData): ReelSpec {
  const scenes: ReelSpec["scenes"] = [];
  for (let i = 0; i < 3; i++) {
    const shot = data.get(`shot_${i}`);
    if (typeof shot !== "string" || !shot) continue;
    scenes.push({ shot: shot as ReelSpec["scenes"][number]["shot"], caption: str(data.get(`scene_caption_${i}`)) });
  }
  const lines = (k: string) => str(data.get(k)).split("\n").map((l) => l.trim()).filter(Boolean);
  return {
    format: str(data.get("format")) || "scenes",
    music: str(data.get("music")) || "warm",
    intro_style: str(data.get("intro_style")) === "light" ? "light" : "dark",
    intro_lines: lines("intro_lines"),
    scenes: str(data.get("format")) === "scenes" || !data.get("format") ? scenes : [],
    text_lines: lines("text_lines"),
  } as ReelSpec;
}

export async function addOwnReelAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const melody = Number(str(data.get("melody")));
    const r = await db((tx, ctx) => addOwnReel(tx, actorOf(ctx), product.id, {
      topic: str(data.get("topic")), caption: str(data.get("caption")), reel: reelFromForm(data), melody: Number.isFinite(melody) && melody > 0 ? melody : null,
    }), { reason: "Own Reel added to the desk" });
    revalidatePath(path(slug));
    return r.status === "blocked"
      ? fail("Added, but the review stopped it (see the content item's checks). Change the text and add it again.")
      : ok("Added to Today's desk. The renderer makes it within two hours; then watch it and approve.");
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function rerenderReelAction(slug: string, itemId: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const spec = reelFromForm(data);
    await db((tx) => rerenderReel(tx, product.id, itemId, spec), { reason: "Reel text changed, made again" });
    revalidatePath(path(slug));
    return ok("Saved. The Reel is being made again (usually within two hours).");
  } catch (e) {
    return toFailure(e, msg);
  }
}
