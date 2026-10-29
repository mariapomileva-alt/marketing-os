import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, type Tx } from "@/server/db/client";
import { createBackApp, createMomentro } from "@/server/services/products";
import { productBrief } from "@/server/services/marketing-brief";
import { deskCounts, generateDesk, getDeskSettings, type DeskMedia } from "@/server/services/content-desk";
import { htmlToText, importWebsite, type Fetcher } from "@/server/services/site-import";
import { asUser, createOwner } from "../helpers/db";

let owner: { userId: string; workspaceId: string };
let momentro: string;
let back: string;
const as = <T>(fn: (tx: Tx) => Promise<T>) => asUser(owner.userId, fn);

beforeAll(async () => {
  owner = await createOwner();
  back = (await as((tx) => createBackApp(tx, owner.workspaceId))).id;
  momentro = (await as((tx) => createMomentro(tx, owner.workspaceId))).id;
}, 60_000);
afterAll(closePools);

describe("Momentro as its own project", () => {
  it("has its own brief, facts and rules; Back keeps Back's", async () => {
    const m = await as((tx) => productBrief(tx, momentro));
    const b = await as((tx) => productBrief(tx, back));
    expect(m).toMatchObject({ name: "Momentro", reels: false, sensitive: false, card_brand: "Momentro" });
    expect(b).toMatchObject({ name: "Back", reels: true, sensitive: true });
    const claims = await as((tx) => tx.query<{ statement: string }>("select statement from product_claims where product_id = $1 and kind = 'prohibited_claim'", [momentro]));
    expect(claims.map((c) => c.statement).join(" ")).toMatch(/entirely offline/);
    const backFacts = await as((tx) => tx.query("select 1 from product_claims where product_id = $1 and statement ilike '%Momentro%'", [back]));
    expect(backFacts).toHaveLength(0);
  });

  it("makes no Reels for Momentro (no recorded library yet) and draws its cards in its own brand", async () => {
    const s = await as((tx) => getDeskSettings(tx, owner.workspaceId, momentro));
    expect(s.slots).toEqual(["12:30", "19:00"]);
    expect((await as((tx) => deskCounts(tx, momentro, { ...s, reels_per_day: 2 }))).reels).toBe(0);
    const brands: string[] = [];
    const media: DeskMedia = { render: async (_f, slides, brand) => { brands.push(brand?.brand ?? "?"); return slides.map(() => new Uint8Array([1])); }, store: async () => undefined };
    await as((tx) => generateDesk(tx, { workspaceId: owner.workspaceId, userId: owner.userId }, momentro, media, { posts: 1, carousels: 0, articles: 0 }));
    expect(brands).toEqual(["Momentro"]);
  });

  it("reads the website into Momentro's Knowledge from its sitemap", async () => {
    const pages: Record<string, string> = {
      "https://momentro.me/sitemap.xml": "<urlset><url><loc>https://momentro.me/</loc></url><url><loc>https://momentro.me/guides/organize-family-videos/</loc></url><url><loc>https://momentro.me/privacy/</loc></url><url><loc>https://other.site/x</loc></url></urlset>",
      "https://momentro.me/": `<html><head><title>Momentro</title><script>x()</script></head><body><nav>menu</nav><main><h1>Your best memories, finally in one film.</h1><p>${"Drop all your clips into Momentro. ".repeat(10)}</p></main></body></html>`,
      "https://momentro.me/guides/organize-family-videos/": `<html><head><title>Organize family videos</title></head><body><main><h1>Organize family videos</h1><ul><li>${"Pick the clips that feel like the day. ".repeat(8)}</li></ul></main></body></html>`,
    };
    const fetcher: Fetcher = async (url) => ({ ok: url in pages, status: url in pages ? 200 : 404, text: pages[url] ?? "", type: url.endsWith(".xml") ? "application/xml" : "text/html" });
    const r = await as((tx) => importWebsite(tx, { workspaceId: owner.workspaceId }, momentro, "https://momentro.me", fetcher));
    expect(r).toMatchObject({ pages: 2, added: 2, same: 0 });
    const again = await as((tx) => importWebsite(tx, { workspaceId: owner.workspaceId }, momentro, "https://momentro.me", fetcher));
    expect(again).toMatchObject({ added: 0, same: 2 });
    const titles = await as((tx) => tx.query<{ title: string }>("select title from knowledge_sources where product_id = $1 order by title", [momentro]));
    expect(titles.map((t) => t.title)).toEqual(["Momentro", "Organize family videos"]);
    expect(htmlToText(pages["https://momentro.me/"]).text).not.toMatch(/menu|x\(\)/);
  });
});
