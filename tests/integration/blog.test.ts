import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, type Tx } from "@/server/db/client";
import { createBackApp } from "@/server/services/products";
import { syncBlog } from "@/server/services/blog";
import { getSiteSettings, updateSiteSettings } from "@/server/services/traffic";
import { getCalmSettings } from "@/server/services/calm";
import { searchKnowledge } from "@/server/services/knowledge";
import { asUser, createOwner } from "../helpers/db";

let owner: { userId: string; workspaceId: string };
let productId: string;
const as = <T>(fn: (tx: Tx) => Promise<T>) => asUser(owner.userId, fn);

const PAGES: Record<string, string> = {
  "https://backapp.live/sitemap.xml": `<urlset><url><loc>https://backapp.live/</loc></url><url><loc>https://backapp.live/guides/panic-at-night/</loc><lastmod>2026-10-22</lastmod></url></urlset>`,
  "https://backapp.live/guides/panic-at-night/": `<html><head><meta name="description" content="A plan for the next minute at night."></head><body><main><h1>Panic at night: the next minute</h1>${"<p>When you wake up with your heart racing, put your feet on the cold floor and name three sounds you can hear. It is a small, physical thing to do while the wave peaks and passes.</p>".repeat(4)}</main></body></html>`,
};
const fetcher = async (url: string) => ({ ok: url in PAGES, status: url in PAGES ? 200 : 404, text: async () => PAGES[url] ?? "" });

beforeAll(async () => {
  owner = await createOwner();
  productId = (await as((tx) => createBackApp(tx, owner.workspaceId))).id;
  await as(async (tx) => {
    await getSiteSettings(tx, owner.workspaceId, productId);
    await updateSiteSettings(tx, owner.workspaceId, productId, { domain: "backapp.live", app_store_url: null, app_store_pt: null });
    await getCalmSettings(tx, owner.workspaceId, productId);
  });
}, 60_000);
afterAll(closePools);

describe("our blog", () => {
  it("turns a new article into knowledge, a calm topic and drafted Threads posts, once", async () => {
    const actor = { workspaceId: owner.workspaceId, userId: owner.userId };
    const r = await as((tx) => syncBlog(tx, actor, productId, fetcher));
    expect(r).toMatchObject({ found: 1, added: 1, drafted: 1 });
    const hits = await as((tx) => searchKnowledge(tx, { workspaceId: owner.workspaceId, productId, query: "feet cold floor", includeMethodology: false }));
    expect(hits[0]?.title).toMatch(/Our article/);
    const s = await as((tx) => getCalmSettings(tx, owner.workspaceId, productId));
    expect(s.topics[0]).toBe("panic at night: the next minute");
    const posts = await as((tx) => tx.query("select id from content_items where product_id = $1 and channel = 'threads'", [productId]));
    expect(posts.length).toBeGreaterThan(0);
    const again = await as((tx) => syncBlog(tx, actor, productId, fetcher));
    expect(again.added).toBe(0);
  });
});
