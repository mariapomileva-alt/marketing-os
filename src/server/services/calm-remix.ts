import type { Tx } from "@/server/db/client";
import type { Actor } from "./content";
import type { CalmClip } from "./calm";

/**
 * New music for videos that are not out yet. The owner already approved these videos; only the music changes (our own
 * generated music, see scripts/reels/ambient.py). Each one is rendered again with the same voice, text and footage,
 * uploaded as a new PRIVATE YouTube video, and then takes the old one's place: the same publish time on YouTube, the
 * new file for the Instagram Reel and TikTok. The old YouTube video is set to private without a publish time (never
 * deleted; the owner can delete it in YouTube Studio).
 */
export interface RemixYoutube {
  schedule(videoId: string, at: Date): Promise<void>;
  keepPrivate(videoId: string): Promise<void>;
}

const SHORT_OPEN = `status in ('review', 'scheduled') and (publish_at is null or publish_at > now() + interval '90 minutes')
  and coalesce(instagram_status, 'queued') in ('queued', 'processing', 'failed') and coalesce(tiktok_status, 'queued') in ('queued', 'failed')`;
const VIDEO_OPEN = `status in ('review', 'scheduled') and (publish_at is null or publish_at > now() + interval '3 hours')`;

/** Queues every upcoming (not yet public) calm video and short for new music. Returns how many of each. */
export async function remixUpcoming(tx: Tx, actor: Actor, productId: string) {
  await tx.query("update calm_settings set own_music = true where product_id = $1", [productId]);
  const shorts = await tx.query<{ id: string }>(
    `update calm_shorts set remix = 'queued', music_version = music_version + 1 where product_id = $1 and remix is null and ${SHORT_OPEN} returning id`, [productId]);
  const videos = await tx.query<{ id: string }>(
    `update calm_videos set remix = 'queued', music_version = music_version + 1 where product_id = $1 and remix is null and youtube_video_id is not null and ${VIDEO_OPEN} returning id`, [productId]);
  if (shorts.length || videos.length) {
    await tx.query(
      "insert into outbound_actions (workspace_id, product_id, action, dedupe_key, result, reason) values ($1,$2,'publish',$3,'executed',$4) on conflict do nothing",
      [actor.workspaceId, productId, `calm-remix:${Date.now()}`, `New own music queued by the owner for ${shorts.length} short(s) and ${videos.length} video(s); each replaces the old version at the same time`],
    );
  }
  return { shorts: shorts.length, videos: videos.length };
}

export async function remixState(tx: Tx, productId: string) {
  return tx.one<{ queued: number; rendering: number }>(
    `select (select count(*) from calm_shorts where product_id = $1 and remix = 'queued')::int + (select count(*) from calm_videos where product_id = $1 and remix = 'queued')::int queued,
            (select count(*) from calm_shorts where product_id = $1 and remix = 'rendering')::int + (select count(*) from calm_videos where product_id = $1 and remix = 'rendering')::int rendering`,
    [productId],
  );
}

const musicPath = (own: string) => `case when (select own_music from calm_settings cs where cs.product_id = v.product_id) then null else (select storage_path from creative_assets a where a.id = v.music_asset_id) end ${own}`;

/** The renderer's next remix: Shorts first (soonest first), then long videos. */
export async function claimRemixJob(tx: Tx, productId: string) {
  const s = await tx.maybeOne<{ id: string; workspace_id: string; video_id: string; title: string; line_from: number; line_to: number; targets: string[]; music_version: number }>(
    `select id, workspace_id, video_id, title, line_from, line_to, targets, music_version from calm_shorts
      where product_id = $1 and (remix = 'queued' or (remix = 'rendering' and remix_started_at < now() - interval '1 hour')) and ${SHORT_OPEN}
      order by publish_at nulls last, idx limit 1 for update skip locked`,
    [productId],
  );
  if (s) {
    const v = await tx.one<{ lines: Array<{ text: string; pause: number }>; audio_keys: string[]; clips: CalmClip[]; music_path: string | null; tags: string[] }>(
      `select lines, audio_keys, clips, tags, ${musicPath("music_path")} from calm_videos v where id = $1`, [s.video_id]);
    await tx.query("update calm_shorts set remix = 'rendering', remix_started_at = now() where id = $1", [s.id]);
    const range = <T,>(a: T[]) => a.slice(s.line_from, s.line_to + 1);
    return {
      kind: "short" as const, remix: true, id: s.id, workspace_id: s.workspace_id, title: s.title, targets: s.targets,
      lines: range(v.lines), audio_keys: range(v.audio_keys), clips: v.clips.slice(0, 3), music_path: v.music_path,
      tags: [...v.tags.slice(0, 10), "shorts"], description: "", libraryPaths: await libraryPaths(tx, v.clips),
      preview_key: `${s.workspace_id}/${productId}/calm/shorts/${s.id}-m${s.music_version}.mp4`,
    };
  }
  const v = await tx.maybeOne<{ id: string; workspace_id: string; title: string; description: string; tags: string[]; lines: Array<{ text: string; pause: number }>; audio_keys: string[]; clips: CalmClip[]; music_path: string | null; music_version: number }>(
    `select id, workspace_id, title, description, tags, lines, audio_keys, clips, music_version, ${musicPath("music_path")} from calm_videos v
      where product_id = $1 and (remix = 'queued' or (remix = 'rendering' and remix_started_at < now() - interval '2 hours')) and ${VIDEO_OPEN}
      order by publish_at nulls last limit 1 for update skip locked`,
    [productId],
  );
  if (!v) return null;
  await tx.query("update calm_videos set remix = 'rendering', remix_started_at = now() where id = $1", [v.id]);
  return {
    kind: "video" as const, remix: true, ...v, libraryPaths: await libraryPaths(tx, v.clips),
    preview_key: `${v.workspace_id}/${productId}/calm/${v.id}-preview-m${v.music_version}.mp4`,
  };
}

async function libraryPaths(tx: Tx, clips: CalmClip[]) {
  const ids = clips.filter((c) => c.source === "library").map((c) => (c as { asset_id: string }).asset_id);
  const rows = await tx.query<{ id: string; storage_path: string }>("select id, storage_path from creative_assets where id = any($1)", [ids]);
  return Object.fromEntries(rows.map((p) => [p.id, p.storage_path]));
}

/** True when the id is a remix being rendered (the renderer reports remixes through the same endpoint). */
export async function isRemix(tx: Tx, productId: string, id: string) {
  return Boolean(await tx.maybeOne(
    "select 1 from calm_shorts where id = $1 and product_id = $2 and remix = 'rendering' union all select 1 from calm_videos where id = $1 and product_id = $2 and remix = 'rendering'",
    [id, productId],
  ));
}

/** The new version arrived: it takes the old one's place, or nothing changes when something went wrong. */
export async function finishRemix(tx: Tx, productId: string, id: string, result: { youtubeVideoId?: string; error?: string; preview?: boolean }, yt: RemixYoutube | null) {
  const short = await tx.maybeOne<{ workspace_id: string; title: string; status: string; publish_at: string | null; youtube_video_id: string | null; targets: string[]; music_version: number; instagram_status: string | null }>(
    "select workspace_id, title, status, publish_at::text, youtube_video_id, targets, music_version, instagram_status from calm_shorts where id = $1 and product_id = $2 and remix = 'rendering' for update", [id, productId]);
  const video = short ? null : await tx.maybeOne<{ workspace_id: string; title: string; theme: string; status: string; publish_at: string | null; youtube_video_id: string | null; music_version: number }>(
    "select workspace_id, title, theme, status, publish_at::text, youtube_video_id, music_version from calm_videos where id = $1 and product_id = $2 and remix = 'rendering' for update", [id, productId]);
  const row = short ?? video;
  if (!row) return { ok: false as const };
  const table = short ? "calm_shorts" : "calm_videos";
  const keepOld = async (why: string) => {
    await tx.query(`update ${table} set remix = null, error = $2 where id = $1`, [id, `New music not applied: ${why.slice(0, 300)} The current version stays.`]);
    return { ok: true as const, applied: false, why };
  };
  const needsYoutube = !short || short.targets.includes("youtube");
  if (result.error) return keepOld(`render failed (${result.error})`);
  if (needsYoutube && !result.youtubeVideoId) return keepOld("the new video did not reach YouTube.");
  if (short && !result.preview) return keepOld("the new file did not arrive.");
  const at = row.publish_at ? new Date(row.publish_at) : null;
  if (row.status === "published" || (row.status === "scheduled" && at && at.getTime() < Date.now() + 10 * 60_000)) return keepOld("it was ready too late, the video was already going out.");
  if (short && !["queued", "processing", "failed", null].includes(short.instagram_status)) return keepOld("the Reel is already out.");

  // YouTube: the new video takes the publish time; the old one stays private without a time.
  if (needsYoutube && result.youtubeVideoId) {
    if (row.status === "scheduled" && at) {
      if (!yt) return keepOld("YouTube is not connected.");
      try {
        await yt.schedule(result.youtubeVideoId, at);
      } catch (e) {
        return keepOld(`YouTube refused the new time (${(e as Error).message.slice(0, 160)}).`);
      }
    }
    if (row.youtube_video_id && yt) await yt.keepPrivate(row.youtube_video_id).catch(() => undefined);
    if (row.youtube_video_id) {
      await tx.query("delete from calendar_events where product_id = $1 and source = 'youtube' and external_id = $2", [productId, result.youtubeVideoId]);
      await tx.query("update calendar_events set external_id = $3 where product_id = $1 and source = 'youtube' and external_id = $2", [productId, row.youtube_video_id, result.youtubeVideoId]);
    }
  }

  let previewId: string | null = null;
  if (result.preview) {
    const path = short ? `${row.workspace_id}/${productId}/calm/shorts/${id}-m${row.music_version}.mp4` : `${row.workspace_id}/${productId}/calm/${id}-preview-m${row.music_version}.mp4`;
    const a = await tx.one<{ id: string }>(
      `insert into creative_assets (workspace_id, product_id, kind, title, storage_path, mime_type, origin, tags, rights_note)
       values ($1,$2,'video',$3,$4,'video/mp4','generated',$5,'Rendered by God of Marketing with our own generated music. Footage as credited.') returning id`,
      [row.workspace_id, productId, row.title, path, short ? ["calm-video", "calm-short"] : ["calm-video", (video as { theme: string }).theme]],
    );
    previewId = a.id;
  }
  await tx.query(
    `update ${table} set remix = null, error = null, youtube_video_id = coalesce($2, youtube_video_id),
            replaced_youtube_ids = case when $2::text is not null and youtube_video_id is not null then array_append(replaced_youtube_ids, youtube_video_id) else replaced_youtube_ids end,
            preview_asset_id = coalesce($3, preview_asset_id) where id = $1`,
    [id, needsYoutube ? result.youtubeVideoId ?? null : null, previewId],
  );
  // A Reel container made from the old file is dropped; the Reel is made again from the new file at its time.
  if (short) await tx.query("update calm_shorts set instagram_container_id = null, instagram_status = 'queued' where id = $1 and instagram_status in ('processing', 'failed')", [id]);
  await tx.query(
    "insert into outbound_actions (workspace_id, product_id, action, dedupe_key, result, reason) values ($1,$2,'publish',$3,'executed',$4) on conflict do nothing",
    [row.workspace_id, productId, `calm-remix-done:${id}:${row.music_version}`, `New music applied to "${row.title.slice(0, 80)}"${at && row.status === "scheduled" ? `, still at ${at.toISOString()}` : ""}`],
  );
  return { ok: true as const, applied: true };
}
