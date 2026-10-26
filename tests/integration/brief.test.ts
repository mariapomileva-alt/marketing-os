import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withContext, type Tx } from "@/server/db/client";
import { createBackApp } from "@/server/services/products";
import { createBrief, gatherFacts, latestBrief } from "@/server/services/brief";
import { asUser, createOwner } from "../helpers/db";

let owner: { userId: string; workspaceId: string };
let productId: string;
const as = <T>(fn: (tx: Tx) => Promise<T>) => asUser(owner.userId, fn);

beforeAll(async () => {
  owner = await createOwner();
  productId = (await as((tx) => createBackApp(tx, owner.workspaceId))).id;
  await withContext({ userId: null, role: "service", actorType: "system" }, async (tx) => {
    const ins = (source: string, ago: string, kind = "pageview") =>
      tx.query(`insert into site_events (workspace_id, product_id, kind, source, visitor_hash, path, occurred_at) values ($1,$2,$3,$4,'v','/guides/x', now() - $5::interval)`, [owner.workspaceId, productId, kind, source, ago]);
    await ins("chatgpt", "2 days");
    await ins("google", "3 days");
    await ins("google", "3 days", "app_store_click");
    await ins("instagram", "10 days");
  });
}, 60_000);
afterAll(closePools);

describe("morning brief", () => {
  it("counts the facts itself, by window", async () => {
    const f = await as((tx) => gatherFacts(tx, productId));
    expect(f.website.visits).toMatchObject({ last7: 2, prev7: 1 });
    expect(f.website.from_ai_assistants.last7).toBe(1);
    expect(f.website.app_store_clicks.last7).toBe(1);
    expect(f.not_connected[0]).toMatch(/App Store Connect/);
    expect(f.website.top_landing_pages_7d[0].page).toBe("/guides/x");
  });

  it("stores one brief per day and replaces it when refreshed", async () => {
    const spoken: string[] = [];
    const voice = { speak: async (t: string) => { spoken.push(t); return new Uint8Array([1]); }, put: async () => {} };
    await as((tx) => createBrief(tx, owner, productId, voice));
    await as((tx) => createBrief(tx, owner, productId, voice));
    const b = await as((tx) => latestBrief(tx, productId));
    expect(b?.brief?.greeting).toMatch(/MOCK/);
    expect(b?.is_mock).toBe(true);
    expect(spoken).toHaveLength(0); // the mock brief is never voiced
    const n = await as((tx) => tx.one<{ n: number }>("select count(*)::int n from daily_briefs where product_id = $1", [productId]));
    expect(n.n).toBe(1);
  });
});
