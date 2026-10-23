"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, getProduct } from "@/server/context";
import { describeDbError } from "@/server/db/client";
import { approveCalmVideo, createCalmVideo, createRendererToken, prepareCalmMedia, rejectCalmVideo, updateCalmSettings } from "@/server/services/calm";
import { liveCalmMedia } from "@/server/calm/live";
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
    return toFailure(e, msg);
  }
}

export async function rejectCalmAction(slug: string, id: string) {
  const product = await getProduct(slug);
  await db((tx, ctx) => rejectCalmVideo(tx, actorOf(ctx), product.id, id), { reason: "Calm video rejected" });
  revalidatePath(path(slug));
}
