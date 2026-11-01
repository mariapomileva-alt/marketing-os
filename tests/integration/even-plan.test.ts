import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withContext, type Tx } from "@/server/db/client";
import { createBackApp } from "@/server/services/products";
import { createCalmVideo, type CalmMedia } from "@/server/services/calm";
import { evenShorts, deskTimesFor, DAILY_CAPS } from "@/server/services/even-plan";
import { asUser, createOwner, pool } from "../helpers/db";

let owner: { userId: string; workspaceId: string };
let productId: string;
const as = <T>(fn: (tx: Tx) => Promise<T>) => asUser(owner.userId, fn);
const media: CalmMedia = { speak: async (t) => new TextEncoder().encode(t), clips: async () => [], store: async () => undefined };

beforeAll(async () => {
  owner = await createOwner();
  productId = (await as((tx) => createBackApp(tx, owner.workspaceId))).id;
}, 60_000);
afterAll(closePools);

describe("even plan", () => {
  it("gives the explainer Reel the middle desk time and posts the others", () => {
    expect(deskTimesFor("reel", ["10:30", "15:30", "21:00"])).toEqual(["15:30"]);
    expect(deskTimesFor("post", ["10:30", "15:30", "21:00"])).toEqual(["10:30", "21:00"]);
  });

  it("spreads crowded shorts so no day goes over the caps", async () => {
    const v = await as((tx) => createCalmVideo(tx, { workspaceId: owner.workspaceId, userId: owner.userId }, productId, media, { theme: "lake" }));
    const day = new Date(Date.now() + 2 * 86_400_000);
    // Ten shorts piled on one day: 6 on YouTube+Instagram, 4 on Instagram+TikTok.
    for (let i = 0; i < 10; i++) {
      await as((tx) => tx.query(
        "insert into calm_shorts (workspace_id, product_id, video_id, idx, line_from, line_to, title, targets, status, publish_at, instagram_status) values ($1,$2,$3,$4,0,1,$5,$6,'scheduled',$7,'queued')",
        [owner.workspaceId, productId, v.id, 300 + i, `S${i}`, i < 6 ? ["youtube", "instagram"] : ["instagram", "tiktok"], new Date(day.getTime() + i * 60_000).toISOString()]));
    }
    const moves: string[] = [];
    const r = await as((tx) => evenShorts(tx, { workspaceId: owner.workspaceId, userId: owner.userId }, productId, { move: async (id) => void moves.push(id) }));
    expect(r.moved).toBeGreaterThan(0);
    const rows = await as((tx) => tx.query<{ targets: string[]; publish_at: string }>("select targets, publish_at::text from calm_shorts where product_id = $1 and status = 'scheduled'", [productId]));
    const per = new Map<string, number>();
    const times = new Map<string, number>();
    for (const s of rows) for (const p of s.targets) {
      const d = new Date(s.publish_at).toISOString().slice(0, 10);
      per.set(`${p}|${d}`, (per.get(`${p}|${d}`) ?? 0) + 1);
      times.set(`${p}|${s.publish_at}`, (times.get(`${p}|${s.publish_at}`) ?? 0) + 1);
    }
    for (const [k, n] of per) expect(n).toBeLessThanOrEqual(DAILY_CAPS[k.split("|")[0] as keyof typeof DAILY_CAPS]);
    for (const n of times.values()) expect(n).toBe(1);
  });
});

import { queueExplainersForYoutube, uploadNextExplainer } from "@/server/services/explainer-youtube";
describe("explainer Reels on YouTube Shorts", () => {
  it("uploads an approved, scheduled explainer once and schedules it at its Instagram time", async () => {
    const at = new Date(Date.now() + 5 * 3_600_000);
    const id = await as(async (tx) => {
      const i = await tx.one<{ id: string }>("insert into content_items (workspace_id, product_id, channel, format, goal, funnel_stage, language, topic, title, status, scheduled_for) values ($1,$2,'instagram','reels_script','awareness','awareness','en','x','Explainer','scheduled',$3) returning id", [owner.workspaceId, productId, at.toISOString()]);
      const v = await tx.one<{ id: string }>("insert into content_versions (workspace_id, product_id, content_item_id, version, body, author_type) values ($1,$2,$3,1,'{\"caption\":\"c\"}','ai') returning id", [owner.workspaceId, productId, i.id]);
      await tx.query("update content_items set current_version_id = $1 where id = $2", [v.id, i.id]);
      const a = await tx.one<{ id: string }>("insert into creative_assets (workspace_id, product_id, kind, title, storage_path, mime_type, origin, tags) values ($1,$2,'video','r','a/r.mp4','video/mp4','generated','{desk-reel}') returning id", [owner.workspaceId, productId]);
      await tx.query(`insert into content_desk_items (content_item_id, workspace_id, product_id, kind, topic, insight, why_now, sources, hooks, chosen_hook, reel, render_status, video_asset_id)
        values ($1,$2,$3,'reel','x','insight here','now','[]','[{"text":"Hook here","mechanism":"statement"}]',0,$4,'ready',$5)`,
        [i.id, owner.workspaceId, productId, JSON.stringify({ format: "explain", intro_lines: ["Why your heart races"], steps: [] }), a.id]);
      return i.id;
    });
    // Test shortcut past the approval flow (covered elsewhere): the table owner's connection, triggers off for one update.
    const c = await pool().connect();
    try {
      await c.query("begin; set local session_replication_role = replica");
      await c.query("update content_items set status = 'scheduled', scheduled_for = $2 where id = $1", [id, at.toISOString()]);
      await c.query("commit");
    } finally { c.release(); }
    expect(await as((tx) => queueExplainersForYoutube(tx, productId))).toBe(1);
    const calls: string[] = [];
    const deps = { read: async () => new Uint8Array([1]), upload: async (m: { title: string }) => (calls.push(m.title), "ytEXPL0001"), schedule: async (vid: string, when: Date) => void calls.push(`${vid}@${when.toISOString()}`) };
    expect(await as((tx) => uploadNextExplainer(tx, productId, deps))).toEqual({ uploaded: "ytEXPL0001" });
    expect(calls).toEqual(["Why your heart races #shorts", `ytEXPL0001@${at.toISOString()}`]);
    expect(await as((tx) => uploadNextExplainer(tx, productId, deps))).toBeNull();
    expect((await as((tx) => tx.one<{ s: string }>("select youtube_status s from content_desk_items where content_item_id = $1", [id]))).s).toBe("uploaded");
  });
});
