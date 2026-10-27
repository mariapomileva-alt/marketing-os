"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, getProduct } from "@/server/context";
import { describeDbError } from "@/server/db/client";
import { approveCalmVideo, createCalmVideo, createRendererToken, prepareCalmMedia, rejectCalmVideo, updateCalmSettings } from "@/server/services/calm";
import { liveCalmMedia } from "@/server/calm/live";
import { approveShort, rejectShort, selectShorts, type ShortTarget } from "@/server/services/calm-shorts";
import { tiktokAccess, tiktokConnection, validateDirectChoice, type TikTokChoice } from "@/server/services/tiktok";
import { tiktokCreatorInfo, tiktokDirectPostEnabled, tiktokRefresh } from "@/server/tiktok/api";
import { refreshTokenFor, youtubeConnection } from "@/server/services/youtube-publish";
import { accessToken, scheduleVideo } from "@/server/youtube/write";
import { fail, lines, ok, str, toFailure, type ActionResult } from "@/lib/action-result";

const msg = (x: unknown) => (x instanceof Error && !("code" in x) ? x.message : describeDbError(x));
const actorOf = (ctx: { workspaceId: string; user: { id: string } }) => ({ workspaceId: ctx.workspaceId, userId: ctx.user.id });
const path = (slug: string) => `/p/${slug}/calm`;

const settingsSchema = z.object({
  enabled: z.boolean(),
  publish_days: z.array(z.coerce.number().int().min(1).max(7)).min(1, "Choose at least one publishing day."),
  publish_hour_utc: z.coerce.number().int().min(0).max(23),
  minutes: z.coerce.number().int().min(3).max(30),
  voice: z.enum(["sage", "shimmer", "coral", "alloy", "ash", "ballad", "echo", "fable", "nova", "onyx", "verse"]),
  topics: z.array(z.string().min(3).max(120)).min(1).max(60),
  themes: z.array(z.enum(["river", "forest", "clouds", "rain", "ocean", "snow", "lake", "meadow"])).min(1),
  auto_shorts: z.boolean(),
  auto_shorts_targets: z.array(z.enum(["youtube", "instagram", "tiktok"])),
});

export async function saveCalmSettingsAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const parsed = settingsSchema.safeParse({
      enabled: data.get("enabled") === "on",
      publish_days: data.getAll("publish_days"),
      publish_hour_utc: data.get("publish_hour_utc"),
      minutes: data.get("minutes"),
      voice: str(data.get("voice")),
      topics: lines(data.get("topics")),
      themes: data.getAll("themes"),
      auto_shorts: data.get("auto_shorts") === "on",
      auto_shorts_targets: data.getAll("auto_shorts_targets"),
    });
    if (!parsed.success) return fail(parsed.error.issues.map((i) => i.message).join(" "));
    await db((tx, ctx) => updateCalmSettings(tx, ctx.workspaceId, product.id, parsed.data), { reason: "Calm video settings changed" });
    revalidatePath(path(slug));
    return ok(parsed.data.enabled ? "Saved. New videos are prepared automatically; each one waits for your approval before it is scheduled." : "Saved. Automatic videos are off.");
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function createCalmVideoAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const r = await db(async (tx, ctx) => createCalmVideo(tx, actorOf(ctx), product.id, await liveCalmMedia(ctx.workspaceId), { topic: str(data.get("topic")), theme: str(data.get("theme")) }), { reason: "Calm video created", actorType: "ai" });
    revalidatePath(path(slug));
    if (r.status === "rejected") return fail(`The script was held back by the safety rules: ${r.problems.join(" ")}`);
    if (r.status === "failed") return fail(`Script written, but voice or footage failed: ${"error" in r ? r.error : ""}`);
    if (r.status === "scripted") return ok("Script written. Connect an OpenAI key (Connections) to add the voice, then it goes to the renderer.");
    return ok("Script, voice and footage are ready. The renderer picks it up within two hours; you get it to watch privately on YouTube.");
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function retryCalmMediaAction(slug: string, id: string, _: ActionResult | null): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const r = await db(async (tx, ctx) => {
      const v = await tx.one<{ status: string; prepared: boolean }>("select status, cardinality(audio_keys) > 0 prepared from calm_videos where id = $1 and product_id = $2", [id, product.id]);
      if (v.status !== "failed") throw new Error("Only failed videos can be retried.");
      if (v.prepared) {
        // Voice and footage exist; only rendering failed: hand it to the renderer again.
        await tx.query("update calm_videos set status = 'ready_to_render', error = null where id = $1", [id]);
        return { status: "ready_to_render" as const };
      }
      const media = await liveCalmMedia(ctx.workspaceId);
      if (!media) throw new Error("Connect an OpenAI key in Connections → AI providers first.");
      return prepareCalmMedia(tx, product.id, id, media);
    }, { reason: "Calm video retried", actorType: "ai" });
    revalidatePath(path(slug));
    return r.status === "failed" ? fail(`Still failing: ${"error" in r ? r.error : ""}`) : ok("Queued for the renderer again.");
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function createRendererTokenAction(slug: string, _: ActionResult | null): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const token = await db((tx, ctx) => createRendererToken(tx, ctx.workspaceId, product.id), { reason: "Calm renderer key created" });
    revalidatePath(path(slug));
    return ok(`Renderer key (shown once, copy it now): ${token}`);
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function approveCalmAction(slug: string, id: string, when: "slot" | "now", _: ActionResult | null): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const r = await db(async (tx, ctx) => {
      const conn = await youtubeConnection(tx, product.id);
      if (!conn?.secret_id) throw new Error("The YouTube channel is not connected.");
      const token = await accessToken(await refreshTokenFor(conn.secret_id));
      return approveCalmVideo(tx, actorOf(ctx), product.id, id, when, { schedule: async (videoId, at) => void (await scheduleVideo(token, videoId, at)) });
    }, { reason: when === "now" ? "Calm video published after approval" : "Calm video scheduled after approval" });
    revalidatePath(path(slug));
    return ok(r.publishAt ? `Approved. YouTube publishes it on ${r.publishAt.toUTCString().replace(/:00 GMT/, " UTC")}.` : "Approved and published.");
  } catch (e) {
    const m = msg(e);
    if (/forbidden|private|locked|audit|403/i.test(m)) {
      return fail(`YouTube kept it private: ${m} Videos uploaded through the API by a project YouTube has not audited yet stay private. Until the audit, download the file (link on the card) and upload it in YouTube Studio, or request the audit (README, “Calm Videos”).`);
    }
    return toFailure(e, msg);
  }
}

export async function rejectCalmAction(slug: string, id: string) {
  const product = await getProduct(slug);
  await db((tx, ctx) => rejectCalmVideo(tx, actorOf(ctx), product.id, id), { reason: "Calm video rejected" });
  revalidatePath(path(slug));
}

export async function selectShortsAction(slug: string, videoId: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const ids = new Set([...data.keys()].filter((k) => /^(yt|ig|tt)_/.test(k)).map((k) => k.slice(3)));
    const picks = [...ids].map((id) => ({
      id,
      targets: [data.get(`yt_${id}`) === "on" ? "youtube" : null, data.get(`ig_${id}`) === "on" ? "instagram" : null, data.get(`tt_${id}`) === "on" ? "tiktok" : null]
        .filter(Boolean) as ShortTarget[],
    }));
    const n = await db((tx) => selectShorts(tx, product.id, picks), { reason: "Shorts chosen" });
    revalidatePath(path(slug));
    return n ? ok(`${n} short${n === 1 ? "" : "s"} queued for the renderer. Each comes back here to watch and approve.`) : fail("Tick YouTube, Instagram or TikTok next to at least one short.");
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function approveShortAction(slug: string, id: string, _: ActionResult | null, data?: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const r = await db(async (tx, ctx) => {
      const conn = await youtubeConnection(tx, product.id);
      const token = conn?.secret_id ? await accessToken(await refreshTokenFor(conn.secret_id)) : null;
      let tiktok: { caption?: string; choice: TikTokChoice } | undefined;
      if (data?.has("tt_caption")) {
        const direct = data.get("tt_mode") === "direct" && tiktokDirectPostEnabled();
        const choice: TikTokChoice = direct
          ? {
              mode: "direct", privacy_level: str(data.get("tt_privacy")),
              // Interactions are off unless the owner ticked them; nothing is preselected (TikTok's posting rules).
              disable_comment: data.get("tt_comment") !== "on", disable_duet: data.get("tt_duet") !== "on", disable_stitch: data.get("tt_stitch") !== "on",
              brand_organic_toggle: data.get("tt_brand") === "on", is_aigc: true,
            }
          : { mode: "inbox" };
        if (direct) {
          const tc = await tiktokConnection(tx, product.id);
          const info = tc ? await tiktokCreatorInfo((await tiktokAccess(tx, tc, tiktokRefresh)).token).catch(() => null) : null;
          validateDirectChoice(choice, info);
        }
        tiktok = { caption: str(data.get("tt_caption")), choice };
      }
      return approveShort(tx, actorOf(ctx), product.id, id, token ? { schedule: async (videoId, at) => void (await scheduleVideo(token, videoId, at)) } : null, tiktok);
    }, { reason: "Short approved" });
    revalidatePath(path(slug));
    return ok(`Approved. It goes out on ${r.publishAt.toUTCString().replace(/:00 GMT/, " UTC")}.`);
  } catch (e) {
    return toFailure(e, msg);
  }
}

export async function rejectShortAction(slug: string, id: string) {
  const product = await getProduct(slug);
  await db((tx, ctx) => rejectShort(tx, actorOf(ctx), product.id, id), { reason: "Short rejected" });
  revalidatePath(path(slug));
}

/** Approve every short of one video that is ready to watch (each was rendered and shown on the card). */
export async function approveAllShortsAction(slug: string, videoId: string, _: ActionResult | null): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const n = await db(async (tx, ctx) => {
      const conn = await youtubeConnection(tx, product.id);
      const token = conn?.secret_id ? await accessToken(await refreshTokenFor(conn.secret_id)) : null;
      const ready = await tx.query<{ id: string }>("select id from calm_shorts where video_id = $1 and product_id = $2 and status = 'review' order by idx", [videoId, product.id]);
      for (const r of ready) await approveShort(tx, actorOf(ctx), product.id, r.id, token ? { schedule: async (v, at) => void (await scheduleVideo(token, v, at)) } : null);
      return ready.length;
    }, { reason: "Shorts approved" });
    revalidatePath(path(slug));
    return n ? ok(`${n} shorts approved: one goes out each day.`) : fail("No shorts are ready to approve yet.");
  } catch (e) {
    return toFailure(e, msg);
  }
}
