import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withContext, type Tx } from "@/server/db/client";
import { createBackApp } from "@/server/services/products";
import { createCalmVideo, type CalmMedia } from "@/server/services/calm";
import { evenShorts, deskTimesFor, DAILY_CAPS } from "@/server/services/even-plan";
import { asUser, createOwner } from "../helpers/db";

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
