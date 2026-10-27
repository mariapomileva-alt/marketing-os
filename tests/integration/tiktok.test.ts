/**
 * TikTok for calm shorts against the real database (RLS on, mock AI): a short ticked for TikTok waits for approval,
 * approval stores the exact caption and choice, and at its time the video goes to the TikTok inbox (or is posted
 * directly only when that is allowed), then its status is followed until TikTok has it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withContext, type Tx } from "@/server/db/client";
import { createBackApp } from "@/server/services/products";
import type { Actor } from "@/server/services/content";
import { approveShort, selectShorts } from "@/server/services/calm-shorts";
import { claimRenderJob, createCalmVideo, createRendererToken, finishRender, type CalmMedia } from "@/server/services/calm";
import { defaultTikTokCaption, publishDueTikToks, validateDirectChoice, type TikTokDeps } from "@/server/services/tiktok";
import type { PostOptions, PublishStatus } from "@/server/tiktok/api";
import { asUser, createOwner } from "../helpers/db";

let owner: { userId: string; workspaceId: string };
let actor: Actor;
let productId: string;
const as = <T>(fn: (tx: Tx) => Promise<T>) => asUser(owner.userId, fn);
const service = <T>(fn: (tx: Tx) => Promise<T>) => withContext({ userId: null, role: "service", actorType: "system" }, fn);
const media: CalmMedia = {
  speak: async (text) => new TextEncoder().encode(`mp3:${text}`),
  clips: async () => [{ url: "https://videos.pexels.com/1.mp4", author: "Anna", source_url: "https://pexels.com/v/1" }],
  store: async () => undefined,
};

beforeAll(async () => {
  owner = await createOwner();
  actor = { workspaceId: owner.workspaceId, userId: owner.userId };
  productId = (await as((tx) => createBackApp(tx, owner.workspaceId))).id;
}, 60_000);
afterAll(closePools);

async function renderedShort(targets: Array<"youtube" | "instagram" | "tiktok">) {
  const r = await as((tx) => createCalmVideo(tx, actor, productId, media, { theme: "forest" }));
  const shorts = await as((tx) => tx.query<{ id: string }>("select id from calm_shorts where video_id = $1 order by idx", [r.id]));
  await as((tx) => selectShorts(tx, productId, [{ id: shorts[0].id, targets }]));
  const token = await as((tx) => createRendererToken(tx, owner.workspaceId, productId));
  let job = (await service((tx) => claimRenderJob(tx, token))) as { job: { id: string } | null };
  while (job.job && job.job.id !== shorts[0].id) {
    await service((tx) => finishRender(tx, token, job.job!.id, { error: "skip in test" }));
    job = (await service((tx) => claimRenderJob(tx, token))) as typeof job;
  }
  await service((tx) => finishRender(tx, token, shorts[0].id, { preview: true, youtubeVideoId: targets.includes("youtube") ? "shortYT1" : undefined }));
  return shorts[0].id;
}

describe("TikTok", () => {
  it("suggests a calm caption with the emergency line and no promises", () => {
    const c = defaultTikTokCaption("[MOCK] You are here · 1 minute of calm");
    expect(c.startsWith("You are here")).toBe(true);
    expect(c).toMatch(/emergency/);
    expect(c).not.toMatch(/relief|cure|stop panic/i);
  });

  it("direct posting needs an explicit privacy choice that TikTok offers", () => {
    const info = { privacy_level_options: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"], comment_disabled: false, duet_disabled: false, stitch_disabled: false, max_video_post_duration_sec: 600 };
    expect(() => validateDirectChoice({ mode: "direct" }, info)).toThrow(/Choose who can see/);
    expect(() => validateDirectChoice({ mode: "direct", privacy_level: "FOLLOWER_OF_CREATOR" }, info)).toThrow(/not available/);
    expect(() => validateDirectChoice({ mode: "direct", privacy_level: "SELF_ONLY" }, info)).not.toThrow();
    expect(() => validateDirectChoice({ mode: "inbox" }, null)).not.toThrow();
  });

  it("sends an approved short to the TikTok inbox at its time and follows it until TikTok has it", async () => {
    const id = await renderedShort(["tiktok"]);
    await as((tx) => approveShort(tx, actor, productId, id, null, { caption: "Edited caption for TikTok", choice: { mode: "inbox" } }));
    const s1 = await as((tx) => tx.one<{ tiktok_status: string; tiktok_caption: string; status: string }>("select tiktok_status, tiktok_caption, status from calm_shorts where id = $1", [id]));
    expect(s1).toMatchObject({ tiktok_status: "queued", tiktok_caption: "Edited caption for TikTok", status: "scheduled" });

    const uploads: Array<{ mode: string; post: PostOptions | null; size: number }> = [];
    let status: PublishStatus = { status: "PROCESSING_UPLOAD" };
    const deps: TikTokDeps = {
      access: async () => ({ token: "t", scopes: ["video.upload"] }),
      file: async () => new Uint8Array(1234),
      upload: async (_t, bytes, mode, post) => { uploads.push({ mode, post, size: bytes.byteLength }); return "pub_1"; },
      status: async () => status,
      directAllowed: false,
    };
    // Not yet its time: nothing happens.
    expect(await as((tx) => publishDueTikToks(tx, productId, deps))).toEqual([]);
    await as((tx) => tx.query("update calm_shorts set publish_at = now() - interval '1 minute' where id = $1", [id]));
    expect((await as((tx) => publishDueTikToks(tx, productId, deps)))[0].result).toBe("uploaded");
    expect(uploads).toEqual([{ mode: "inbox", post: null, size: 1234 }]);
    await as((tx) => publishDueTikToks(tx, productId, deps)); // still processing
    status = { status: "SEND_TO_USER_INBOX" };
    expect((await as((tx) => publishDueTikToks(tx, productId, deps)))[0].result).toBe("in_inbox");
    status = { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [7123] };
    expect((await as((tx) => publishDueTikToks(tx, productId, deps)))[0].result).toBe("published");
    const s2 = await as((tx) => tx.one<{ tiktok_status: string; tiktok_post_id: string }>("select tiktok_status, tiktok_post_id from calm_shorts where id = $1", [id]));
    expect(s2).toEqual({ tiktok_status: "published", tiktok_post_id: "7123" });
    expect(uploads).toHaveLength(1);
    const log = await as((tx) => tx.one<{ n: number }>("select count(*)::int n from outbound_actions where dedupe_key = $1", [`calm-tiktok:${id}`]));
    expect(log.n).toBe(1);
  });

  it("posts directly only when allowed, with the owner's choices; a TikTok failure is shown on the short", async () => {
    const id = await renderedShort(["youtube", "tiktok"]);
    await as((tx) => approveShort(tx, actor, productId, id, { schedule: async () => undefined }, {
      caption: "Calm caption", choice: { mode: "direct", privacy_level: "SELF_ONLY", disable_comment: true, disable_duet: true, disable_stitch: true, brand_organic_toggle: true, is_aigc: true },
    }));
    await as((tx) => tx.query("update calm_shorts set publish_at = now() - interval '1 minute' where id = $1", [id]));
    const uploads: Array<{ mode: string; post: PostOptions | null }> = [];
    const deps: TikTokDeps = {
      access: async () => ({ token: "t", scopes: ["video.publish"] }),
      file: async () => new Uint8Array(10),
      upload: async (_t, _b, mode, post) => { uploads.push({ mode, post }); return "pub_2"; },
      status: async () => ({ status: "FAILED", fail_reason: "duration_check" }),
      directAllowed: true,
    };
    await as((tx) => publishDueTikToks(tx, productId, deps));
    expect(uploads[0].mode).toBe("direct");
    expect(uploads[0].post).toMatchObject({ title: "Calm caption", privacy_level: "SELF_ONLY", brand_organic_toggle: true, is_aigc: true });
    expect((await as((tx) => publishDueTikToks(tx, productId, deps)))[0].result).toBe("failed");
    const s = await as((tx) => tx.one<{ tiktok_status: string; tiktok_error: string }>("select tiktok_status, tiktok_error from calm_shorts where id = $1", [id]));
    expect(s.tiktok_status).toBe("failed");
    expect(s.tiktok_error).toMatch(/duration_check/);
  });
});
