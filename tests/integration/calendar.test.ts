import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, type Tx } from "@/server/db/client";
import { createBackApp } from "@/server/services/products";
import { calendarItems, syncCalendar } from "@/server/services/calendar";
import { mixShorts } from "@/server/services/shorts-mix";
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

  it("mixes scheduled shorts by look: same times, the same long video no longer on neighbouring days", async () => {
    const day = (n: number, h: number) => new Date(Date.UTC(2031, 0, 5 + n, h, 0)).toISOString();
    const ids: string[] = [];
    await as(async (tx) => {
      await tx.query("delete from calm_shorts where product_id = $1", [productId]);
      for (const name of ["A", "B"]) {
        const v = await tx.one<{ id: string }>(
          "insert into calm_videos (workspace_id, product_id, topic, theme, title, description, tags, lines, status) values ($1,$2,'t','river',$3,'d','{}','[]','published') returning id",
          [owner.workspaceId, productId, name]);
        for (let i = 0; i < 3; i++) {
          const n = name === "A" ? i : i + 3; // A on days 0-2, B on days 3-5: each look three days in a row
          const r = await tx.one<{ id: string }>(
            "insert into calm_shorts (workspace_id, product_id, video_id, idx, line_from, line_to, title, targets, status, publish_at, youtube_video_id) values ($1,$2,$3,$4,0,1,$5,'{youtube}','scheduled',$6,$7) returning id",
            [owner.workspaceId, productId, v.id, i + 1, `${name}${i}`, day(n, 16), `yt-${name}${i}`]);
          ids.push(r.id);
        }
      }
    });
    await as((tx) => syncCalendar(tx, owner.workspaceId, productId, { youtube: async () => [0, 1, 2, 3, 4, 5].map((n) => ({ id: `own${n}`, title: `My video ${n} #Shorts`, publishedAt: ago, publishAt: day(n, 9), privacy: "private", thumbnail: null, seconds: 40 })) }));
    const moved: Array<[string, string]> = [];
    const r = await as((tx) => mixShorts(tx, { workspaceId: owner.workspaceId, userId: owner.userId }, productId, { move: async (id, at) => void moved.push([id, at.toISOString()]) }, { includeOwn: true, seed: 11 }));
    expect(r.moved).toBeGreaterThan(0);
    expect(r.after).toBeLessThan(r.before);
    const rows = await as((tx) => tx.query<{ title: string; publish_at: string }>("select title, publish_at::text from calm_shorts where product_id = $1", [productId]));
    const ev = await as((tx) => tx.query<{ at: string }>("select at::text from calendar_events where product_id = $1 and source = 'youtube' and external_id like 'own%'", [productId]));
    const all = [...rows.map((x) => new Date(x.publish_at).toISOString()), ...ev.map((x) => new Date(x.at).toISOString())].sort();
    expect(all).toEqual([0, 1, 2, 3, 4, 5].flatMap((n) => [day(n, 9), day(n, 16)]).sort()); // the same times as before
    const dayA = rows.filter((x) => x.title.startsWith("A")).map((x) => new Date(x.publish_at).getUTCDate()).sort((a, b) => a - b);
    for (let k = 1; k < dayA.length; k++) expect(dayA[k] - dayA[k - 1]).toBeGreaterThanOrEqual(2);
    expect(moved.every(([id]) => id.startsWith("yt-") || id.startsWith("own"))).toBe(true);
  });
});
