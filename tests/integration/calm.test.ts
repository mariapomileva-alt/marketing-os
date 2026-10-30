/**
 * Calm videos against the real database (RLS on, mock AI): the script is written and checked, voice and footage are
 * prepared, the renderer can only claim work with the right key, a rendered video waits for the owner, and approval
 * schedules it at the next free slot through YouTube.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withContext, type Tx } from "@/server/db/client";
import { createBackApp } from "@/server/services/products";
import type { Actor } from "@/server/services/content";
import { addReelsToScheduledShorts, approveShort, groupLines, publishDueReels, selectShorts } from "@/server/services/calm-shorts";
import { approveCalmVideo, claimRenderJob, createCalmVideo, createRendererToken, finishRender, getCalmSettings, nextSlot, updateCalmSettings, videosInPipeline, type CalmMedia } from "@/server/services/calm";
import { asUser, createOwner } from "../helpers/db";
import { remixUpcoming } from "@/server/services/calm-remix";

let owner: { userId: string; workspaceId: string };
let actor: Actor;
let productId: string;
const as = <T>(fn: (tx: Tx) => Promise<T>) => asUser(owner.userId, fn);
const service = <T>(fn: (tx: Tx) => Promise<T>) => withContext({ userId: null, role: "service", actorType: "system" }, fn);
const stored: string[] = [];
const media: CalmMedia = {
  speak: async (text) => new TextEncoder().encode(`mp3:${text}`),
  clips: async () => [{ url: "https://videos.pexels.com/1.mp4", author: "Anna", source_url: "https://pexels.com/v/1" }],
  store: async (key) => void stored.push(key),
};

beforeAll(async () => {
  owner = await createOwner();
  actor = { workspaceId: owner.workspaceId, userId: owner.userId };
  productId = (await as((tx) => createBackApp(tx, owner.workspaceId))).id;
}, 60_000);
afterAll(closePools);

describe("calm videos", () => {
  let token = "";
  let videoId = "";

  it("writes a script, records the voice and finds footage", async () => {
    const r = await as((tx) => createCalmVideo(tx, actor, productId, media, { topic: "a panic attack at night", theme: "river" }));
    expect(r.status).toBe("ready_to_render");
    videoId = r.id;
    const v = await as((tx) => tx.one<{ lines: unknown[]; audio_keys: string[]; clips: unknown[]; title: string }>("select lines, audio_keys, clips, title from calm_videos where id = $1", [r.id]));
    expect(v.audio_keys.length).toBe(v.lines.length);
    expect(stored.length).toBe(v.lines.length);
    expect(v.clips).toHaveLength(1);
    expect(await as((tx) => videosInPipeline(tx, productId))).toBe(1);
  });

  it("leaves a script without voice when no OpenAI key is connected", async () => {
    const r = await as((tx) => createCalmVideo(tx, actor, productId, null));
    expect(r.status).toBe("scripted");
  });

  it("gives work only to the renderer with the right key, and takes the result back", async () => {
    expect((await service((tx) => claimRenderJob(tx, "mosr_wrong"))).authorized).toBe(false);
    token = await as((tx) => createRendererToken(tx, owner.workspaceId, productId));
    const s = await as((tx) => getCalmSettings(tx, owner.workspaceId, productId));
    expect(s.renderer_token_hash).not.toContain(token.slice(5)); // only the hash is stored
    const claimed = await service((tx) => claimRenderJob(tx, token));
    expect(claimed.authorized && claimed.job?.id).toBe(videoId);
    const again = await service((tx) => claimRenderJob(tx, token));
    expect(again.authorized && again.job).toBeNull(); // already rendering
    expect(await service((tx) => finishRender(tx, "mosr_wrong", videoId, { youtubeVideoId: "abcDEF12345" }))).toBe(false);
    expect(await service((tx) => finishRender(tx, token, videoId, { youtubeVideoId: "abcDEF12345", preview: true }))).toBe(true);
    const v = await as((tx) => tx.one<{ status: string; preview_asset_id: string | null }>("select status, preview_asset_id from calm_videos where id = $1", [videoId]));
    expect(v.status).toBe("review");
    // Shorts are queued automatically from the finished video (YouTube by default); each still needs approval.
    const queued = await as((tx) => tx.query<{ targets: string[] }>("select targets from calm_shorts where video_id = $1 and status = 'ready_to_render'", [videoId]));
    expect(queued.length).toBeGreaterThan(0);
    expect(queued[0].targets).toEqual(["youtube"]);
    const asset = await as((tx) => tx.one<{ kind: string; tags: string[] }>("select kind, tags from creative_assets where id = $1", [v.preview_asset_id]));
    expect(asset).toMatchObject({ kind: "video" });
    expect(asset.tags).toContain("calm-video");
  });

  it("schedules only after approval, at the next free slot", async () => {
    await as(async (tx) => {
      const s = await getCalmSettings(tx, owner.workspaceId, productId);
      await updateCalmSettings(tx, owner.workspaceId, productId, { ...s, publish_days: [2, 5], publish_hour_utc: 16 });
    });
    const calls: Array<{ id: string; at: Date | null }> = [];
    const r = await as((tx) => approveCalmVideo(tx, actor, productId, videoId, "slot", { schedule: async (id, at) => void calls.push({ id, at }) }));
    expect(calls[0].id).toBe("abcDEF12345");
    expect([2, 5]).toContain(((r.publishAt!.getUTCDay() + 6) % 7) + 1);
    expect(r.publishAt!.getUTCHours()).toBe(16);
    await expect(as((tx) => approveCalmVideo(tx, actor, productId, videoId, "slot", { schedule: async () => undefined }))).rejects.toThrow(/review/);
  });
});

describe("own media from the Creative Library", () => {
  it("prefers our clips over stock footage; library music only when own music is switched off", async () => {
    await as((tx) => tx.query(
      `insert into creative_assets (workspace_id, product_id, kind, title, storage_path, mime_type, tags, rights_note) values
        ($1,$2,'video','river 1','a/r1.mp4','video/mp4','{calm,river}','filmed by us'),
        ($1,$2,'video','river 2','a/r2.mp4','video/mp4','{calm,river}','filmed by us'),
        ($1,$2,'image','lake','a/l.jpg','image/jpeg','{calm}','ours'),
        ($1,$2,'audio','pad','a/m.mp3','audio/mpeg','{calm}','YouTube Audio Library'),
        ($1,$2,'video','competitor','a/x.mp4','video/mp4','{calm}','reference')`, [owner.workspaceId, productId]));
    await as((tx) => tx.query("update creative_assets set origin = 'competitor_reference' where title = 'competitor' and product_id = $1", [productId]));
    const own = await as((tx) => createCalmVideo(tx, actor, productId, media, { theme: "river" }));
    expect((await as((tx) => tx.one<{ m: string | null }>("select music_asset_id m from calm_videos where id = $1", [own.id]))).m).toBeNull();
    await as((tx) => tx.query("update calm_settings set own_music = false where product_id = $1", [productId]));
    const r = await as((tx) => createCalmVideo(tx, actor, productId, media, { theme: "river" }));
    await as((tx) => tx.query("update calm_settings set own_music = true where product_id = $1", [productId]));
    const v = await as((tx) => tx.one<{ clips: Array<{ source: string; kind: string }>; music_asset_id: string | null }>("select clips, music_asset_id from calm_videos where id = $1", [r.id]));
    expect(v.clips).toHaveLength(3);
    expect(v.clips.every((c) => c.source === "library")).toBe(true);
    expect(v.clips.some((c) => c.kind === "image")).toBe(true);
    expect(v.music_asset_id).not.toBeNull();
  });
});

describe("shorts and reels", () => {
  it("groups a script into 30-60 second pieces", () => {
    const lines = Array.from({ length: 70 }, (_, i) => ({ text: "Feel where your feet touch the floor.", pause: i % 6 === 5 ? 9 : 4 }));
    const g = groupLines(lines);
    expect(g.length).toBeGreaterThan(5);
    expect(g.length).toBeLessThanOrEqual(15);
    expect(g[0].from).toBe(0);
    for (let i = 1; i < g.length; i++) expect(g[i].from).toBe(g[i - 1].to + 1);
  });

  it("makes only the ticked shorts, waits for approval, then publishes the Reel when its time comes", async () => {
    const r = await as((tx) => createCalmVideo(tx, actor, productId, media, { theme: "lake" }));
    const shorts = await as((tx) => tx.query<{ id: string; status: string }>("select id, status from calm_shorts where video_id = $1 order by idx", [r.id]));
    expect(shorts.length).toBeGreaterThan(1);
    expect(shorts.every((x) => x.status === "planned")).toBe(true);
    expect(await as((tx) => selectShorts(tx, productId, [{ id: shorts[0].id, targets: ["youtube", "instagram"] }]))).toBe(1);

    const token = await as((tx) => createRendererToken(tx, owner.workspaceId, productId));
    // Long videos first, then shorts.
    let job = (await service((tx) => claimRenderJob(tx, token))) as { job: { kind: string; id: string; lines: unknown[] } | null };
    // Other work in the queue (long videos first, then shorts made automatically from earlier videos) is skipped.
    while (job.job && job.job.id !== shorts[0].id) {
      await service((tx) => finishRender(tx, token, job.job!.id, { error: "skip in test" }));
      job = (await service((tx) => claimRenderJob(tx, token))) as typeof job;
    }
    expect(job.job?.kind).toBe("short");
    expect(job.job?.id).toBe(shorts[0].id);
    await service((tx) => finishRender(tx, token, shorts[0].id, { youtubeVideoId: "shortVID123", preview: true }));
    const calls: Array<{ id: string; at: Date | null }> = [];
    const a = await as((tx) => approveShort(tx, actor, productId, shorts[0].id, { schedule: async (id, at) => void calls.push({ id, at }) }));
    expect(calls[0].id).toBe("shortVID123");
    await as((tx) => tx.query("update calm_shorts set publish_at = now() - interval '1 minute' where id = $1", [shorts[0].id]));
    expect(a.publishAt.getTime()).toBeGreaterThan(Date.now());
    let status = "IN_PROGRESS";
    const reels = { token: async () => ({ token: "t", igUserId: "ig1" }), fileUrl: async (p: string) => `https://storage/${p}`, create: async () => "container1", status: async () => status, publish: async () => "media1" };
    await as((tx) => publishDueReels(tx, productId, reels));
    await as((tx) => publishDueReels(tx, productId, reels)); // still processing
    status = "FINISHED";
    expect((await as((tx) => publishDueReels(tx, productId, reels))).published).toBe(1);
    const s = await as((tx) => tx.one<{ instagram_media_id: string; status: string }>("select instagram_media_id, status from calm_shorts where id = $1", [shorts[0].id]));
    expect(s).toMatchObject({ instagram_media_id: "media1", status: "published" });
  });

  it("adds Instagram Reels to shorts already scheduled for YouTube; a missing permission is shown on the connection", async () => {
    const v = await as((tx) => tx.one<{ id: string }>("select video_id id from calm_shorts where product_id = $1 limit 1", [productId]));
    const asset = await as((tx) => tx.one<{ id: string }>("select preview_asset_id id from calm_shorts where preview_asset_id is not null and product_id = $1 limit 1", [productId]));
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    await as((tx) => tx.query(
      "insert into calm_shorts (workspace_id, product_id, video_id, idx, line_from, line_to, title, targets, status, publish_at, preview_asset_id) values ($1,$2,$3,90,0,1,'Later short','{youtube}','scheduled',$4,$5)",
      [owner.workspaceId, productId, v.id, soon, asset.id]));
    expect(await as((tx) => addReelsToScheduledShorts(tx, actor, productId))).toBe(1);
    expect(await as((tx) => addReelsToScheduledShorts(tx, actor, productId))).toBe(0);
    const row = await as((tx) => tx.one<{ targets: string[]; instagram_status: string }>("select targets, instagram_status from calm_shorts where idx = 90 and product_id = $1", [productId]));
    expect(row).toMatchObject({ targets: ["youtube", "instagram"], instagram_status: "queued" });
    await as((tx) => tx.query("update calm_shorts set publish_at = now() - interval '1 minute' where idx = 90 and product_id = $1", [productId]));
    const denied = {
      token: async () => ({ token: "t", igUserId: "ig1" }), fileUrl: async (x: string) => x,
      create: async () => { throw new Error("Instagram 403 IGApiException 10: Application does not have permission for this action"); },
      status: async () => "FINISHED", publish: async () => "m",
    };
    await service((tx) => tx.query("insert into channel_connections (workspace_id, product_id, channel, adapter_kind, account_label, mode, status) select $1,$2,'instagram','official_api','@backapp.live','requires_approval','connected' where not exists (select 1 from channel_connections where product_id = $2 and channel = 'instagram' and status <> 'revoked')", [owner.workspaceId, productId]));
    await as((tx) => publishDueReels(tx, productId, denied));
    const conn = await as((tx) => tx.one<{ last_error: string | null }>("select last_error from channel_connections where product_id = $1 and channel = 'instagram' and status <> 'revoked'", [productId]));
    expect(conn.last_error).toMatch(/publishing permission/);
  });
});

describe("new music on upcoming videos", () => {
  it("remakes scheduled shorts and keeps their time; the old YouTube video only goes private", async () => {
    const v = await as((tx) => tx.one<{ id: string }>("select id from calm_videos where product_id = $1 and array_length(audio_keys, 1) > 0 limit 1", [productId]));
    const at = new Date(Date.now() + 2 * 86_400_000);
    const asset = await as((tx) => tx.one<{ id: string }>("select preview_asset_id id from calm_shorts where preview_asset_id is not null and product_id = $1 limit 1", [productId]));
    const ids = await as((tx) => tx.query<{ id: string }>(
      `insert into calm_shorts (workspace_id, product_id, video_id, idx, line_from, line_to, title, targets, status, publish_at, youtube_video_id, preview_asset_id, instagram_status)
       values ($1,$2,$3,201,0,1,'Remix me','{youtube,instagram}','scheduled',$4,'oldVID00001',$5,'queued'),
              ($1,$2,$3,202,0,1,'Too soon','{youtube}','scheduled',now() + interval '20 minutes','oldVID00002',$5,null) returning id`,
      [owner.workspaceId, productId, v.id, at.toISOString(), asset.id]));
    await service((tx) => tx.query("insert into calendar_events (workspace_id, product_id, source, external_id, status, title, at) values ($1,$2,'youtube','oldVID00001','scheduled','Remix me',$3)", [owner.workspaceId, productId, at.toISOString()]));
    const r = await as((tx) => remixUpcoming(tx, actor, productId));
    expect(r.shorts).toBeGreaterThanOrEqual(1);
    expect((await as((tx) => tx.one<{ remix: string | null }>("select remix from calm_shorts where id = $1", [ids[1].id]))).remix).toBeNull(); // too close to go out

    const token = await as((tx) => createRendererToken(tx, owner.workspaceId, productId));
    const claimed = (await service((tx) => claimRenderJob(tx, token))) as { job: { id: string; remix?: boolean; preview_key?: string; music_path: string | null } | null };
    expect(claimed.job?.id).toBe(ids[0].id); // soonest remix first, before any new work
    expect(claimed.job?.remix).toBe(true);
    expect(claimed.job?.preview_key).toMatch(/-m2\.mp4$/);
    expect(claimed.job?.music_path).toBeNull();

    const calls: string[] = [];
    const yt = async () => ({ schedule: async (id: string, when: Date) => void calls.push(`schedule ${id} ${when.toISOString()}`), keepPrivate: async (id: string) => void calls.push(`private ${id}`) });
    expect(await service((tx) => finishRender(tx, token, ids[0].id, { youtubeVideoId: "newVID00001", preview: true }, yt))).toBe(true);
    expect(calls).toEqual([`schedule newVID00001 ${at.toISOString()}`, "private oldVID00001"]);
    const row = await as((tx) => tx.one<{ youtube_video_id: string; replaced_youtube_ids: string[]; remix: string | null; status: string; publish_at: string; preview_asset_id: string }>(
      "select youtube_video_id, replaced_youtube_ids, remix, status, publish_at::text, preview_asset_id from calm_shorts where id = $1", [ids[0].id]));
    expect(row).toMatchObject({ youtube_video_id: "newVID00001", replaced_youtube_ids: ["oldVID00001"], remix: null, status: "scheduled" });
    expect(new Date(row.publish_at).getTime()).toBe(at.getTime());
    expect(row.preview_asset_id).not.toBe(asset.id);
    const ev = await as((tx) => tx.query<{ external_id: string }>("select external_id from calendar_events where product_id = $1 and title = 'Remix me'", [productId]));
    expect(ev[0].external_id).toBe("newVID00001");
  });

  it("keeps the approved version when the new render fails", async () => {
    const s = await as((tx) => tx.one<{ id: string }>("select id from calm_shorts where product_id = $1 and youtube_video_id = 'newVID00001'", [productId]));
    await as((tx) => tx.query("update calm_shorts set remix = 'rendering', remix_started_at = now() where id = $1", [s.id]));
    const token = await as((tx) => createRendererToken(tx, owner.workspaceId, productId));
    await service((tx) => finishRender(tx, token, s.id, { error: "ffmpeg died" }, async () => null));
    const row = await as((tx) => tx.one<{ youtube_video_id: string; status: string; remix: string | null; error: string }>("select youtube_video_id, status, remix, error from calm_shorts where id = $1", [s.id]));
    expect(row).toMatchObject({ youtube_video_id: "newVID00001", status: "scheduled", remix: null });
    expect(row.error).toMatch(/New music not applied/);
  });
});

describe("publishing slots", () => {
  it("picks the next Tuesday or Friday, skipping taken slots and slots too close", () => {
    const now = new Date("2026-10-23T10:00:00Z"); // Friday
    expect(nextSlot([2, 5], 16, [], now).toISOString()).toBe("2026-10-23T16:00:00.000Z");
    expect(nextSlot([2, 5], 16, [new Date("2026-10-23T16:00:00Z")], now).toISOString()).toBe("2026-10-27T16:00:00.000Z");
    expect(nextSlot([2, 5], 11, [], now).toISOString()).toBe("2026-10-27T11:00:00.000Z"); // 11:00 today is under 3 h away
  });
});
