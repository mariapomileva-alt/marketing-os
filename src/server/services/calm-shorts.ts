import type { Tx } from "@/server/db/client";
import type { Actor } from "./content";
import type { CalmClip, Scheduler } from "./calm";
import { defaultTikTokCaption, type TikTokChoice } from "./tiktok";
import { isIgPermissionError } from "@/server/instagram/errors";

export type ShortTarget = "youtube" | "instagram" | "tiktok";

export const IG_PERMISSION_NOTE = "Instagram refused to publish: the connected account has no publishing permission (instagram_business_content_publish). Add it to the Meta app's Instagram use case, then Reconnect Instagram.";

/**
 * Shorts and Reels cut from a calm video's script: consecutive lines grouped into 30-60 second pieces, rendered
 * vertically with the same voice, footage and music (almost free). The owner ticks which to make and where, watches
 * each one and approves it; YouTube publishes at a daily slot, Instagram Reels go out from the posting queue.
 */
export function groupLines(lines: Array<{ text: string; pause: number }>, max = 15) {
  const est = (l: { text: string; pause: number }) => l.text.split(/\s+/).length / 2.4 + 0.4 + l.pause * 0.6;
  const groups: Array<{ from: number; to: number }> = [];
  let from = 0;
  let acc = 0;
  for (let i = 0; i < lines.length; i++) {
    acc += est(lines[i]);
    const last = i === lines.length - 1;
    // Close a short at a natural pause once it is long enough, or when it would get too long.
    if ((acc >= 30 && lines[i].pause >= 7) || acc >= 50 || last) {
      if (acc >= 18 || !groups.length) groups.push({ from, to: i });
      else groups[groups.length - 1].to = i; // a tiny tail joins the previous short
      from = i + 1;
      acc = 0;
    }
  }
  return groups.slice(0, max);
}

/** `n` pieces spread evenly over the video (beginning, middle and end), in order. */
export function pickSpread<T>(groups: T[], n: number) {
  if (groups.length <= n) return groups;
  return Array.from({ length: n }, (_, i) => groups[Math.round((i * (groups.length - 1)) / Math.max(1, n - 1))]);
}

/** Half the pieces to YouTube Shorts, half to Instagram Reels + TikTok, at random (so each platform gets different ones). */
export function splitLanes(n: number, random: () => number = Math.random): Array<"youtube" | "social"> {
  const lanes = Array.from({ length: n }, (_, i) => (i < Math.ceil(n / 2) ? "youtube" : "social") as "youtube" | "social");
  for (let i = lanes.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
  }
  return lanes;
}

export async function planShorts(tx: Tx, productId: string, videoId: string) {
  const exists = await tx.maybeOne("select 1 from calm_shorts where video_id = $1 limit 1", [videoId]);
  if (exists) return 0;
  const v = await tx.one<{ workspace_id: string; lines: Array<{ text: string; pause: number }> }>("select workspace_id, lines from calm_videos where id = $1 and product_id = $2", [videoId, productId]);
  const per = (await tx.maybeOne<{ n: number }>("select shorts_per_video n from calm_settings where product_id = $1", [productId]))?.n ?? 6;
  const groups = pickSpread(groupLines(v.lines), per);
  const lanes = splitLanes(groups.length);
  for (const [i, g] of groups.entries()) {
    const first = v.lines[g.from].text.replace(/^\[MOCK\]\s*/, "").replace(/[.…]+$/, "");
    await tx.query(
      "insert into calm_shorts (workspace_id, product_id, video_id, idx, line_from, line_to, title, lane) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (video_id, idx) do nothing",
      [v.workspace_id, productId, videoId, i + 1, g.from, g.to, `${first} · 1 minute of calm`.slice(0, 90), lanes[i]],
    );
  }
  return groups.length;
}

/**
 * Next free time for a short: the daily short slots (UTC "HH:MM"), at least 3 hours ahead, one short per slot and
 * platform (a short taking YouTube and one taking Instagram can share a time; two on YouTube cannot).
 */
export function nextShortSlot(slots: string[], taken: Date[], now = new Date()): Date {
  const times = slots.map((x) => /^(\d{1,2}):(\d{2})$/.exec(x.trim())).filter((m): m is RegExpExecArray => Boolean(m)).map((m) => [Number(m[1]), Number(m[2])] as const);
  const list = times.length ? times : [[16, 0] as const];
  for (let d = 0; d < 90; d++) {
    for (const [h, m] of [...list].sort((a, b) => a[0] * 60 + a[1] - (b[0] * 60 + b[1]))) {
      const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d, h, m, 0));
      if (at.getTime() < now.getTime() + 3 * 3_600_000) continue;
      if (taken.some((t) => Math.abs(t.getTime() - at.getTime()) < 20 * 60_000)) continue;
      return at;
    }
  }
  return new Date(now.getTime() + 86_400_000);
}

/** The owner's ticks: which shorts to make and where. Unticked ones stay planned. */
export async function selectShorts(tx: Tx, productId: string, picks: Array<{ id: string; targets: ShortTarget[] }>) {
  let n = 0;
  for (const p of picks) {
    if (!p.targets.length) continue;
    const r = await tx.query(
      "update calm_shorts set targets = $3, status = 'ready_to_render', error = null where id = $1 and product_id = $2 and status in ('planned', 'failed', 'rejected') returning id",
      [p.id, productId, p.targets],
    );
    n += r.length;
  }
  return n;
}

export async function claimShortJob(tx: Tx, productId: string) {
  const s = await tx.maybeOne<{ id: string; workspace_id: string; video_id: string; title: string; line_from: number; line_to: number; targets: string[] }>(
    `select id, workspace_id, video_id, title, line_from, line_to, targets from calm_shorts
      where product_id = $1 and (status = 'ready_to_render' or (status = 'rendering' and render_started_at < now() - interval '1 hour'))
      order by created_at, idx limit 1 for update skip locked`,
    [productId],
  );
  if (!s) return null;
  const v = await tx.one<{ lines: Array<{ text: string; pause: number }>; audio_keys: string[]; clips: CalmClip[]; music_path: string | null; description: string; tags: string[] }>(
    `select lines, audio_keys, clips, description, tags,
            case when (select own_music from calm_settings cs where cs.product_id = v.product_id) then null
                 else (select storage_path from creative_assets a where a.id = v.music_asset_id) end music_path
       from calm_videos v where id = $1`,
    [s.video_id],
  );
  if (v.audio_keys.length < v.lines.length) {
    await tx.query("update calm_shorts set status = 'failed', error = 'The long video has no voice yet.' where id = $1", [s.id]);
    return null;
  }
  const paths = await tx.query<{ id: string; storage_path: string }>("select id, storage_path from creative_assets where id = any($1)",
    [v.clips.filter((c) => c.source === "library").map((c) => (c as { asset_id: string }).asset_id)]);
  await tx.query("update calm_shorts set status = 'rendering', render_started_at = now(), error = null where id = $1", [s.id]);
  const range = (a: string[] | Array<{ text: string; pause: number }>) => a.slice(s.line_from, s.line_to + 1);
  return {
    kind: "short" as const, id: s.id, workspace_id: s.workspace_id, title: s.title, targets: s.targets,
    lines: range(v.lines) as Array<{ text: string; pause: number }>, audio_keys: range(v.audio_keys) as string[],
    clips: v.clips.slice(0, 3), music_path: v.music_path, tags: [...v.tags.slice(0, 10), "shorts"],
    description: v.description, libraryPaths: Object.fromEntries(paths.map((p) => [p.id, p.storage_path])),
  };
}

export async function finishShortRender(tx: Tx, productId: string, id: string, result: { youtubeVideoId?: string; error?: string; preview?: boolean }) {
  const s = await tx.maybeOne<{ workspace_id: string; title: string; targets: string[] }>("select workspace_id, title, targets from calm_shorts where id = $1 and product_id = $2 and status = 'rendering'", [id, productId]);
  if (!s) return false;
  const needsYoutube = s.targets.includes("youtube");
  if (result.error || !result.preview || (needsYoutube && !result.youtubeVideoId)) {
    await tx.query("update calm_shorts set status = 'failed', error = $2 where id = $1", [id, `Render failed: ${(result.error ?? "the file did not arrive").slice(0, 500)}`]);
    return true;
  }
  const a = await tx.one<{ id: string }>(
    `insert into creative_assets (workspace_id, product_id, kind, title, storage_path, mime_type, origin, tags, rights_note)
     values ($1,$2,'video',$3,$4,'video/mp4','generated','{calm-video,calm-short}','Rendered by God of Marketing (vertical short). Footage and music as credited.') returning id`,
    [s.workspace_id, productId, s.title, `${s.workspace_id}/${productId}/calm/shorts/${id}.mp4`],
  );
  await tx.query("update calm_shorts set status = 'review', youtube_video_id = $2, preview_asset_id = $3 where id = $1", [id, result.youtubeVideoId ?? null, a.id]);
  return true;
}

/** Approved shorts go out one a day at the publishing hour: YouTube schedules it, Instagram from the queue. */
export async function approveShort(tx: Tx, actor: Actor, productId: string, id: string, yt: Scheduler | null, tiktok?: { caption?: string; choice: TikTokChoice }) {
  const s = await tx.one<{ status: string; youtube_video_id: string | null; targets: string[]; title: string }>("select status, youtube_video_id, targets, title from calm_shorts where id = $1 and product_id = $2", [id, productId]);
  if (s.status !== "review") throw new Error("Only a rendered short waiting for review can be approved.");
  const slots = (await tx.maybeOne<{ s: string[] }>("select short_slots s from calm_settings where product_id = $1", [productId]))?.s ?? ["16:00"];
  // Times already used on any of this short's platforms (YouTube and Instagram/TikTok fill their slots separately).
  const taken = (await tx.query<{ publish_at: string }>(
    "select publish_at::text from calm_shorts where product_id = $1 and status in ('scheduled', 'published') and publish_at > now() and targets && $2", [productId, s.targets])).map((r) => new Date(r.publish_at));
  const at = nextShortSlot(slots, taken);
  if (s.targets.includes("youtube") && s.youtube_video_id) {
    if (!yt) throw new Error("The YouTube channel is not connected.");
    await yt.schedule(s.youtube_video_id, at);
  }
  await tx.query(
    "insert into outbound_actions (workspace_id, product_id, action, dedupe_key, result, reason) values ($1,$2,'publish',$3,'executed',$4)",
    [actor.workspaceId, productId, `calm-short:${id}`, `short scheduled for ${at.toISOString()} after approval (${s.targets.join(", ")})`],
  );
  await tx.query(
    "update calm_shorts set status = 'scheduled', publish_at = $2, instagram_status = case when 'instagram' = any(targets) then 'queued' else null end, decided_by = $3, decided_at = now() where id = $1",
    [id, at.toISOString(), actor.userId],
  );
  if (s.targets.includes("tiktok")) {
    // The exact caption and choices the owner approved are what gets sent to TikTok.
    const caption = (tiktok?.caption?.trim() || defaultTikTokCaption(s.title)).slice(0, 2200);
    await tx.query(
      "update calm_shorts set tiktok_status = 'queued', tiktok_caption = $2, tiktok_options = $3, tiktok_error = null where id = $1",
      [id, caption, JSON.stringify(tiktok?.choice ?? { mode: "inbox" })],
    );
  }
  return { publishAt: at };
}

export async function rejectShort(tx: Tx, actor: Actor, productId: string, id: string) {
  await tx.query("update calm_shorts set status = 'rejected', decided_by = $3, decided_at = now() where id = $1 and product_id = $2 and status in ('planned', 'review', 'failed')", [id, productId, actor.userId]);
}

export interface ReelsApi {
  token(): Promise<{ token: string; igUserId: string }>;
  fileUrl(storagePath: string): Promise<string>;
  create(token: string, igUserId: string, videoUrl: string, caption: string): Promise<string>;
  status(token: string, containerId: string): Promise<"FINISHED" | "IN_PROGRESS" | "ERROR" | "EXPIRED" | "PUBLISHED" | string>;
  publish(token: string, igUserId: string, containerId: string): Promise<string>;
}

/** Instagram Reels for approved shorts whose time has come: create the container, then publish when it is ready. */
export async function publishDueReels(tx: Tx, productId: string, api: ReelsApi) {
  const due = await tx.query<{ id: string; title: string; workspace_id: string; instagram_status: string; instagram_container_id: string | null; storage_path: string | null }>(
    `select s.id, s.title, s.workspace_id, s.instagram_status, s.instagram_container_id, a.storage_path
       from calm_shorts s left join creative_assets a on a.id = s.preview_asset_id
      where s.product_id = $1 and 'instagram' = any(s.targets) and s.status in ('scheduled', 'published') and s.publish_at <= now()
        and s.instagram_status in ('queued', 'processing')
      order by s.publish_at limit 2`,
    [productId],
  );
  const done: string[] = [];
  for (const d of due) {
    try {
      const { token, igUserId } = await api.token();
      if (d.instagram_status === "queued") {
        if (!d.storage_path) throw new Error("The short's file is missing.");
        const caption = `${d.title.replace(/ · 1 minute of calm$/, "")}\n\nA minute of calm from the team behind Back.\n\n#panicattack #anxietyrelief #calm`;
        const container = await api.create(token, igUserId, await api.fileUrl(d.storage_path), caption);
        await tx.query("update calm_shorts set instagram_container_id = $2, instagram_status = 'processing' where id = $1", [d.id, container]);
        continue;
      }
      const st = await api.status(token, d.instagram_container_id!);
      if (st === "IN_PROGRESS") continue;
      if (st !== "FINISHED") throw new Error(`Instagram could not process the video (${st}).`);
      const media = await api.publish(token, igUserId, d.instagram_container_id!);
      await tx.query("update calm_shorts set instagram_media_id = $2, instagram_status = 'published', status = 'published' where id = $1", [d.id, media]);
      await tx.query(
        "insert into outbound_actions (workspace_id, product_id, action, dedupe_key, result, reason) values ($1,$2,'publish',$3,'executed','Instagram Reel published after approval')",
        [d.workspace_id, productId, `calm-reel:${d.id}`],
      );
      done.push(d.id);
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300);
      await tx.query("update calm_shorts set instagram_status = 'failed', error = $2 where id = $1", [d.id, msg]);
      if (isIgPermissionError(msg)) {
        await tx.query("update channel_connections set last_error = $2 where product_id = $1 and channel = 'instagram' and status <> 'revoked'", [productId, IG_PERMISSION_NOTE]);
      }
    }
  }
  return { published: done.length };
}

/**
 * Instagram Reels for shorts already approved for YouTube: each upcoming scheduled short also goes out as a Reel at
 * its own time (the owner approved the video itself already). Shorts less than 30 minutes away are left as they are.
 */
export async function addReelsToScheduledShorts(tx: Tx, actor: Actor, productId: string) {
  const r = await tx.query<{ id: string }>(
    `update calm_shorts set targets = array_append(targets, 'instagram'), instagram_status = 'queued', instagram_container_id = null
      where product_id = $1 and status = 'scheduled' and publish_at > now() + interval '30 minutes' and not ('instagram' = any(targets))
        and preview_asset_id is not null
      returning id`,
    [productId],
  );
  if (r.length) {
    await tx.query(
      "insert into outbound_actions (workspace_id, product_id, action, dedupe_key, result, reason) values ($1,$2,'publish',$3,'executed',$4) on conflict do nothing",
      [actor.workspaceId, productId, `calm-reels-added:${Date.now()}`, `Instagram Reels added to ${r.length} scheduled short(s) at their times, by the owner`],
    );
  }
  return r.length;
}
