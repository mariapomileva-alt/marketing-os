/**
 * Calm videos against the real database (RLS on, mock AI): the script is written and checked, voice and footage are
 * prepared, the renderer can only claim work with the right key, a rendered video waits for the owner, and approval
 * schedules it at the next free slot through YouTube.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withContext, type Tx } from "@/server/db/client";
import { createBackApp } from "@/server/services/products";
import type { Actor } from "@/server/services/content";
import { approveCalmVideo, claimRenderJob, createCalmVideo, createRendererToken, finishRender, getCalmSettings, nextSlot, updateCalmSettings, videosInPipeline, type CalmMedia } from "@/server/services/calm";
import { asUser, createOwner } from "../helpers/db";

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
    expect(await service((tx) => finishRender(tx, token, videoId, { youtubeVideoId: "abcDEF12345" }))).toBe(true);
    const v = await as((tx) => tx.one<{ status: string }>("select status from calm_videos where id = $1", [videoId]));
    expect(v.status).toBe("review");
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
  it("prefers our clips and music tagged calm over stock footage", async () => {
    await as((tx) => tx.query(
      `insert into creative_assets (workspace_id, product_id, kind, title, storage_path, mime_type, tags, rights_note) values
        ($1,$2,'video','river 1','a/r1.mp4','video/mp4','{calm,river}','filmed by us'),
        ($1,$2,'video','river 2','a/r2.mp4','video/mp4','{calm,river}','filmed by us'),
        ($1,$2,'image','lake','a/l.jpg','image/jpeg','{calm}','ours'),
        ($1,$2,'audio','pad','a/m.mp3','audio/mpeg','{calm}','YouTube Audio Library'),
        ($1,$2,'video','competitor','a/x.mp4','video/mp4','{calm}','reference')`, [owner.workspaceId, productId]));
    await as((tx) => tx.query("update creative_assets set origin = 'competitor_reference' where title = 'competitor' and product_id = $1", [productId]));
    const r = await as((tx) => createCalmVideo(tx, actor, productId, media, { theme: "river" }));
    const v = await as((tx) => tx.one<{ clips: Array<{ source: string; kind: string }>; music_asset_id: string | null }>("select clips, music_asset_id from calm_videos where id = $1", [r.id]));
    expect(v.clips).toHaveLength(3);
    expect(v.clips.every((c) => c.source === "library")).toBe(true);
    expect(v.clips.some((c) => c.kind === "image")).toBe(true);
    expect(v.music_asset_id).not.toBeNull();
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
