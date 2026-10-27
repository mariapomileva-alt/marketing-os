import { createHash, randomBytes } from "node:crypto";
import type { Tx } from "@/server/db/client";
import { calmVideoSchema } from "@/domain/ai/schemas";
import { checkText, outcomeOf } from "@/domain/guardrails";
import { runAgent, type Actor } from "./content";
import { draftingKnowledge } from "./knowledge-context";
import { claimShortJob, finishShortRender, planShorts, selectShorts } from "./calm-shorts";
import { productRules } from "./youtube";

/**
 * Calm affirmation videos for YouTube. The pipeline, with the owner in control of anything public:
 *   scripted (AI) → ready_to_render (voice + footage prepared) → rendering (GitHub Actions) → review (uploaded to
 *   YouTube as PRIVATE) → approved by the owner → scheduled (YouTube publishes at the slot) → published.
 */
export interface CalmSettings {
  enabled: boolean;
  publish_days: number[];
  publish_hour_utc: number;
  minutes: number;
  voice: string;
  language: string;
  topics: string[];
  themes: string[];
  renderer_token_hash: string | null;
  renderer_seen_at: string | null;
  last_created_at: string | null;
  auto_shorts: boolean;
  auto_shorts_targets: string[];
}

export async function getCalmSettings(tx: Tx, workspaceId: string, productId: string): Promise<CalmSettings> {
  await tx.query("insert into calm_settings (product_id, workspace_id) values ($1, $2) on conflict (product_id) do nothing", [productId, workspaceId]);
  return tx.one<CalmSettings>(
    `select enabled, publish_days, publish_hour_utc, minutes, voice, language, topics, themes, renderer_token_hash,
            renderer_seen_at::text, last_created_at::text, auto_shorts, auto_shorts_targets from calm_settings where product_id = $1`,
    [productId],
  );
}

export async function updateCalmSettings(tx: Tx, workspaceId: string, productId: string, s: Pick<CalmSettings, "enabled" | "publish_days" | "publish_hour_utc" | "minutes" | "voice" | "topics" | "themes"> & Partial<Pick<CalmSettings, "auto_shorts" | "auto_shorts_targets">>) {
  const cur = await getCalmSettings(tx, workspaceId, productId);
  await tx.query(
    "update calm_settings set enabled = $2, publish_days = $3, publish_hour_utc = $4, minutes = $5, voice = $6, topics = $7, themes = $8, auto_shorts = $9, auto_shorts_targets = $10 where product_id = $1",
    [productId, s.enabled, s.publish_days, s.publish_hour_utc, s.minutes, s.voice, s.topics, s.themes, s.auto_shorts ?? cur.auto_shorts, s.auto_shorts_targets ?? cur.auto_shorts_targets],
  );
}

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** A new key for the GitHub renderer. Only its hash is stored; the key is shown to the owner once. */
export async function createRendererToken(tx: Tx, workspaceId: string, productId: string) {
  await getCalmSettings(tx, workspaceId, productId);
  const token = `mosr_${randomBytes(24).toString("base64url")}`;
  await tx.query("update calm_settings set renderer_token_hash = $2, renderer_seen_at = null where product_id = $1", [productId, hashToken(token)]);
  return token;
}

/** Picks a topic and a theme not used recently. */
async function nextTopicAndTheme(tx: Tx, productId: string, s: CalmSettings) {
  const recent = await tx.query<{ topic: string; theme: string }>("select topic, theme from calm_videos where product_id = $1 order by created_at desc limit 8", [productId]);
  const topic = s.topics.find((t) => !recent.some((r) => r.topic === t)) ?? s.topics[recent.length % s.topics.length];
  const theme = s.themes.find((t) => !recent.slice(0, 3).some((r) => r.theme === t)) ?? s.themes[0];
  return { topic, theme };
}

export interface CalmMedia {
  speak(text: string, voice: string): Promise<Uint8Array>;
  clips(theme: string): Promise<Array<{ url: string; author: string; source_url: string }>>;
  store(key: string, bytes: Uint8Array): Promise<void>;
}

/** Writes the script (AI), checks every line against the product's safety rules, then prepares voice and footage. */
export async function createCalmVideo(tx: Tx, actor: Actor, productId: string, media: CalmMedia | null, pick: { topic?: string; theme?: string } = {}) {
  const s = await getCalmSettings(tx, actor.workspaceId, productId);
  const auto = await nextTopicAndTheme(tx, productId, s);
  const topic = pick.topic?.trim() || auto.topic;
  const theme = pick.theme?.trim() || auto.theme;
  const wf = await tx.one<{ id: string }>(
    "insert into workflow_runs (workspace_id, product_id, workflow, input, status, current_step) values ($1,$2,'calm_video',$3,'running','script') returning id",
    [actor.workspaceId, productId, JSON.stringify({ topic, theme })],
  );
  const r = await runAgent(tx, {
    actor, productId, workflowRunId: wf.id, step: "calm_video", task: "calm_video", promptKey: "calm_video.v1", schema: calmVideoSchema, sourceIds: [],
    input: { topic, theme, minutes: s.minutes, language: s.language, knowledge: await draftingKnowledge(tx, actor.workspaceId, productId, topic, 5) },
  });
  const rules = await productRules(tx, productId);
  // A long script with one or two doubtful lines: drop those lines (noted on the video). Many: hold the whole script.
  const blockedLines = r.output.lines.map((l) => {
    const f = checkText({ text: l.text, channel: "youtube", format: "helpful_comment" }, rules);
    return outcomeOf(f) === "block" ? `“${l.text}”: ${f.filter((x) => x.severity === "block").map((x) => x.message).join(" ")}` : null;
  });
  const dropped = blockedLines.filter((b): b is string => Boolean(b));
  const tolerable = dropped.length <= Math.max(2, Math.floor(r.output.lines.length * 0.05));
  const blocks = tolerable ? [] : dropped;
  const keptLines = r.output.lines.filter((_, i) => !blockedLines[i]);
  r.output.lines = keptLines;
  const note = tolerable && dropped.length ? `Removed ${dropped.length} line(s) the safety rules flagged: ${dropped.join(" ")}` : null;
  const isMock = r.output.title.startsWith("[MOCK]");
  const row = await tx.one<{ id: string }>(
    `insert into calm_videos (workspace_id, product_id, topic, theme, title, description, tags, lines, status, error, agent_run_id, is_mock)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [actor.workspaceId, productId, topic, theme, r.output.title, r.output.description, r.output.tags, JSON.stringify(r.output.lines),
     blocks.length ? "rejected" : "scripted", blocks.length ? `Held back by safety rules: ${blocks.slice(0, 3).join(" ")}` : note, r.agentRunId, isMock],
  );
  await tx.query("update workflow_runs set status = 'completed', current_step = 'scripted' where id = $1", [wf.id]);
  await tx.query("update calm_settings set last_created_at = now() where product_id = $1", [productId]);
  if (!blocks.length) await planShorts(tx, productId, row.id);
  if (blocks.length || !media) return { id: row.id, status: blocks.length ? "rejected" : "scripted", problems: blocks };
  return { id: row.id, ...(await prepareCalmMedia(tx, productId, row.id, media)), problems: [] };
}

/** Voice for every line (stored privately) and footage links. A failure leaves the video "scripted" with the reason. */
export async function prepareCalmMedia(tx: Tx, productId: string, videoId: string, media: CalmMedia) {
  const v = await tx.one<{ lines: Array<{ text: string }>; theme: string; status: string }>("select lines, theme, status from calm_videos where id = $1 and product_id = $2", [videoId, productId]);
  if (!["scripted", "failed"].includes(v.status)) throw new Error("This video is already prepared.");
  const s = await tx.one<{ voice: string }>("select voice from calm_settings where product_id = $1", [productId]);
  try {
    const keys: string[] = [];
    for (let i = 0; i < v.lines.length; i += 6) {
      const batch = v.lines.slice(i, i + 6);
      const audio = await Promise.all(batch.map((l) => media.speak(l.text, s.voice)));
      for (const [j, bytes] of audio.entries()) {
        const key = `calm/${productId}/${videoId}/${String(i + j).padStart(3, "0")}.mp3`;
        await media.store(key, bytes);
        keys.push(key);
      }
    }
    // Footage: the product's own library first (tagged calm or the theme), Pexels only to fill up.
    const library = await tx.query<{ id: string; kind: "video" | "image" }>(
      `select id, kind from creative_assets
        where product_id = $1 and kind in ('video', 'image') and storage_path is not null and origin <> 'competitor_reference'
          and ('calm' = any(tags) or $2 = any(tags)) and not ('calm-video' = any(tags)) -- never our own finished videos
        order by ($2 = any(tags)) desc, random() limit 8`,
      [productId, v.theme],
    );
    const own = library.map((a) => ({ source: "library", asset_id: a.id, kind: a.kind, author: "our library" }));
    const stock = own.length >= 3 ? [] : (await media.clips(v.theme).catch(() => [])).slice(0, 6 - own.length).map((c) => ({ source: "pexels", kind: "video", ...c }));
    const music = await tx.maybeOne<{ id: string }>(
      `select a.id from creative_assets a where a.product_id = $1 and a.kind = 'audio' and a.storage_path is not null and 'calm' = any(a.tags)
        order by (select max(created_at) from calm_videos c where c.music_asset_id = a.id) nulls first, random() limit 1`,
      [productId],
    );
    await tx.query("update calm_videos set audio_keys = $2, clips = $3, music_asset_id = $4, status = 'ready_to_render', error = case when error like 'Removed %' then error else null end where id = $1",
      [videoId, keys, JSON.stringify([...own, ...stock]), music?.id ?? null]);
    return { status: "ready_to_render" as const };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 400);
    await tx.query("update calm_videos set status = 'failed', error = $2 where id = $1", [videoId, `Preparing voice or footage failed: ${msg}`]);
    return { status: "failed" as const, error: msg };
  }
}

/** The renderer asks for work: the oldest prepared video (or one stuck in rendering for 2 hours). */
export type CalmClip =
  | { source: "library"; asset_id: string; kind: "video" | "image"; author: string }
  | { source: "pexels"; kind: "video"; url: string; author: string; source_url: string };

export async function claimRenderJob(tx: Tx, token: string) {
  const s = await tx.maybeOne<{ product_id: string; minutes: number }>("select product_id, minutes from calm_settings where renderer_token_hash = $1", [hashToken(token)]);
  if (!s) return { authorized: false as const };
  await tx.query("update calm_settings set renderer_seen_at = now() where product_id = $1", [s.product_id]);
  const v = await tx.maybeOne<{ id: string; workspace_id: string; title: string; description: string; tags: string[]; lines: Array<{ text: string; pause: number }>; audio_keys: string[]; clips: CalmClip[]; music_path: string | null; music_title: string | null }>(
    `select id, workspace_id, title, description, tags, lines, audio_keys, clips,
            (select storage_path from creative_assets a where a.id = v.music_asset_id) music_path,
            (select rights_note from creative_assets a where a.id = v.music_asset_id) music_title
       from calm_videos v
      where product_id = $1 and (status = 'ready_to_render' or (status = 'rendering' and render_started_at < now() - interval '2 hours'))
      order by created_at limit 1 for update skip locked`,
    [s.product_id],
  );
  if (!v) return { authorized: true as const, productId: s.product_id, job: await claimShortJob(tx, s.product_id) };
  const paths = await tx.query<{ id: string; storage_path: string }>("select id, storage_path from creative_assets where id = any($1)",
    [v.clips.filter((c) => c.source === "library").map((c) => (c as { asset_id: string }).asset_id)]);
  await tx.query("update calm_videos set status = 'rendering', render_started_at = now(), error = case when error like 'Removed %' then error else null end where id = $1", [v.id]);
  return { authorized: true as const, productId: s.product_id, job: { ...v, kind: "video" as const, minutes: s.minutes, libraryPaths: Object.fromEntries(paths.map((p) => [p.id, p.storage_path])) } };
}

export async function finishRender(tx: Tx, token: string, id: string, result: { youtubeVideoId?: string; error?: string; renderUrl?: string; preview?: boolean }) {
  const s = await tx.maybeOne<{ product_id: string }>("select product_id from calm_settings where renderer_token_hash = $1", [hashToken(token)]);
  if (!s) return false;
  if (await tx.maybeOne("select 1 from calm_shorts where id = $1 and product_id = $2", [id, s.product_id])) return finishShortRender(tx, s.product_id, id, result);
  if (result.youtubeVideoId && result.preview) {
    // The preview the renderer uploaded becomes a Creative Library video, watchable inside God of Marketing.
    const v = await tx.maybeOne<{ workspace_id: string; title: string; theme: string; preview_asset_id: string | null }>(
      "select workspace_id, title, theme, preview_asset_id from calm_videos where id = $1 and product_id = $2", [id, s.product_id]);
    if (v && !v.preview_asset_id) {
      const a = await tx.one<{ id: string }>(
        `insert into creative_assets (workspace_id, product_id, kind, title, storage_path, mime_type, origin, tags, rights_note)
         values ($1,$2,'video',$3,$4,'video/mp4','generated',$5,'Rendered by God of Marketing (preview, 480p). Footage and music as credited on YouTube.') returning id`,
        [v.workspace_id, s.product_id, v.title, `${v.workspace_id}/${s.product_id}/calm/${id}-preview.mp4`, ["calm-video", v.theme]],
      );
      await tx.query("update calm_videos set preview_asset_id = $2 where id = $1", [id, a.id]);
    }
  }
  if (result.youtubeVideoId) {
    // Shorts from the finished video, made automatically when switched on (each still waits for approval).
    const auto = await tx.maybeOne<{ auto_shorts: boolean; auto_shorts_targets: string[] }>("select auto_shorts, auto_shorts_targets from calm_settings where product_id = $1", [s.product_id]);
    if (auto?.auto_shorts && auto.auto_shorts_targets.length) {
      const connected = new Set((await tx.query<{ channel: string }>("select channel from channel_connections where product_id = $1 and channel in ('instagram', 'tiktok') and status = 'connected' and adapter_kind = 'official_api'", [s.product_id])).map((c) => c.channel));
      const targets = auto.auto_shorts_targets.filter((t) => t === "youtube" || connected.has(t)) as Array<"youtube" | "instagram" | "tiktok">;
      const planned = await tx.query<{ id: string }>("select id from calm_shorts where video_id = $1 and status = 'planned'", [id]);
      await selectShorts(tx, s.product_id, planned.map((p) => ({ id: p.id, targets })));
    }
    await tx.query("update calm_videos set status = 'review', youtube_video_id = $3, render_url = $4, rendered_at = now(), error = case when error like 'Removed %' then error else null end where id = $1 and product_id = $2 and status = 'rendering'", [id, s.product_id, result.youtubeVideoId, result.renderUrl ?? null]);
  } else {
    await tx.query("update calm_videos set status = 'failed', error = $3, render_url = $4 where id = $1 and product_id = $2 and status = 'rendering'", [id, s.product_id, `Render failed: ${(result.error ?? "unknown").slice(0, 600)}`, result.renderUrl ?? null]);
  }
  return true;
}

/** Next free publishing slot: the configured weekdays and hour (UTC), at least 3 hours ahead, one video per slot. */
export function nextSlot(days: number[], hourUtc: number, taken: Date[], now = new Date()): Date {
  const isoDay = (d: Date) => ((d.getUTCDay() + 6) % 7) + 1;
  for (let i = 0; i < 60; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i, hourUtc, 0, 0));
    if (!days.includes(isoDay(d)) || d.getTime() < now.getTime() + 3 * 3_600_000) continue;
    if (taken.some((t) => Math.abs(t.getTime() - d.getTime()) < 3_600_000)) continue;
    return d;
  }
  return new Date(now.getTime() + 86_400_000);
}

export interface Scheduler {
  schedule(videoId: string, publishAt: Date | null): Promise<void>;
}

/** The owner watched the private video and approves it: YouTube publishes it at the next slot (or now). */
export async function approveCalmVideo(tx: Tx, actor: Actor, productId: string, id: string, when: "slot" | "now", yt: Scheduler) {
  const v = await tx.one<{ status: string; youtube_video_id: string | null; title: string }>("select status, youtube_video_id, title from calm_videos where id = $1 and product_id = $2", [id, productId]);
  if (v.status !== "review" || !v.youtube_video_id) throw new Error("Only a rendered video waiting for review can be approved.");
  const s = await getCalmSettings(tx, actor.workspaceId, productId);
  const taken = (await tx.query<{ publish_at: string }>("select publish_at::text from calm_videos where product_id = $1 and status = 'scheduled' and publish_at > now()", [productId])).map((r) => new Date(r.publish_at));
  const at = when === "now" ? null : nextSlot(s.publish_days, s.publish_hour_utc, taken);
  const conn = await tx.maybeOne<{ id: string }>("select id from channel_connections where product_id = $1 and channel = 'youtube' and status = 'connected' and adapter_kind = 'official_api'", [productId]);
  try {
    await yt.schedule(v.youtube_video_id, at);
  } catch (e) {
    await tx.query(
      "insert into outbound_actions (workspace_id, product_id, connection_id, action, result, reason) values ($1,$2,$3,'publish','failed',$4)",
      [actor.workspaceId, productId, conn?.id ?? null, (e as Error).message.slice(0, 300)],
    );
    throw e;
  }
  await tx.query(
    "insert into outbound_actions (workspace_id, product_id, connection_id, action, dedupe_key, result, reason) values ($1,$2,$3,'publish',$4,'executed',$5)",
    [actor.workspaceId, productId, conn?.id ?? null, `calm:${id}`, at ? `calm video scheduled for ${at.toISOString()} after approval` : "calm video published after approval"],
  );
  await tx.query("update calm_videos set status = $3, publish_at = $4, decided_by = $5, decided_at = now() where id = $1 and product_id = $2",
    [id, productId, at ? "scheduled" : "published", at?.toISOString() ?? new Date().toISOString(), actor.userId]);
  return { publishAt: at };
}

export async function rejectCalmVideo(tx: Tx, actor: Actor, productId: string, id: string) {
  await tx.query(
    "update calm_videos set status = 'rejected', decided_by = $3, decided_at = now() where id = $1 and product_id = $2 and status in ('scripted', 'ready_to_render', 'review', 'failed')",
    [id, productId, actor.userId],
  );
}

/** Keeps two videos in the pipeline (not yet published), so there is always something to review before each slot. */
export async function videosInPipeline(tx: Tx, productId: string) {
  return (await tx.one<{ n: number }>(
    "select count(*)::int n from calm_videos where product_id = $1 and status in ('scripted', 'ready_to_render', 'rendering', 'review', 'scheduled') and (publish_at is null or publish_at > now())",
    [productId],
  )).n;
}
