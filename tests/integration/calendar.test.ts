import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, type Tx } from "@/server/db/client";
import { createBackApp } from "@/server/services/products";
import { calendarItems, syncCalendar } from "@/server/services/calendar";
import { asUser, createOwner } from "../helpers/db";

let owner: { userId: string; workspaceId: string };
let productId: string;
const as = <T>(fn: (tx: Tx) => Promise<T>) => asUser(owner.userId, fn);
const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
const ago = new Date(Date.now() - 86_400_000).toISOString();

beforeAll(async () => {
  owner = await createOwner();
  productId = (await as((tx) => createBackApp(tx, owner.workspaceId))).id;
}, 60_000);
afterAll(closePools);

describe("calendar", () => {
  it("mirrors platform posts, keeps scheduled YouTube videos, and drops ones deleted on the platform", async () => {
    const readers = {
      instagram: async () => [{ id: "ig1", caption: "A reel", permalink: "https://instagram.com/p/1", timestamp: ago, comments_count: 0, like_count: 0, media_product_type: "REELS", media_type: "VIDEO", thumbnail_url: "https://cdn/x.jpg" }],
      threads: async () => [
        { id: "th1", text: "A post", permalink: null, timestamp: ago, media_type: "TEXT_POST", thumbnail_url: null, is_reply: false },
        { id: "th2", text: "A reply", permalink: null, timestamp: ago, media_type: "TEXT_POST", thumbnail_url: null, is_reply: true },
      ],
      youtube: async () => [{ id: "yt1", title: "Calm river", publishedAt: ago, publishAt: soon, privacy: "private", thumbnail: null, seconds: 600 }],
    };
    const r = await as((tx) => syncCalendar(tx, owner.workspaceId, productId, readers));
    expect(r).toEqual({ instagram: 1, threads: 1, youtube: 1 });
    const { items } = await as((tx) => calendarItems(tx, productId, new Date(Date.now() - 5 * 86_400_000), new Date(Date.now() + 5 * 86_400_000)));
    expect(items.map((i) => [i.channel, i.status, i.kind])).toEqual([["instagram", "published", "reel"], ["threads", "published", "text"], ["youtube", "scheduled", "video"]]);

    await as((tx) => syncCalendar(tx, owner.workspaceId, productId, { youtube: async () => [] }));
    const after = await as((tx) => calendarItems(tx, productId, new Date(Date.now() - 5 * 86_400_000), new Date(Date.now() + 5 * 86_400_000)));
    expect(after.items.some((i) => i.channel === "youtube")).toBe(false);
  });

  it("shows our own scheduled short once, not twice with its platform copy", async () => {
    await as(async (tx) => {
      const v = await tx.one<{ id: string }>(
        "insert into calm_videos (workspace_id, product_id, topic, theme, title, description, tags, lines, status) values ($1,$2,'t','river','Calm','d','{}','[]','published') returning id",
        [owner.workspaceId, productId]);
      await tx.query(
        "insert into calm_shorts (workspace_id, product_id, video_id, idx, line_from, line_to, title, targets, status, publish_at, youtube_video_id) values ($1,$2,$3,1,0,1,'Short one','{youtube}','scheduled',$4,'yts1')",
        [owner.workspaceId, productId, v.id, soon]);
    });
    await as((tx) => syncCalendar(tx, owner.workspaceId, productId, { youtube: async () => [{ id: "yts1", title: "Short one #shorts", publishedAt: ago, publishAt: soon, privacy: "private", thumbnail: null, seconds: 50 }] }));
    const { items } = await as((tx) => calendarItems(tx, productId, new Date(Date.now() - 5 * 86_400_000), new Date(Date.now() + 5 * 86_400_000)));
    const yt = items.filter((i) => i.channel === "youtube");
    expect(yt).toHaveLength(1);
    expect(yt[0]).toMatchObject({ origin: "ours", kind: "short", status: "scheduled" });
  });
});
