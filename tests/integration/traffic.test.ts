import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withContext, type Tx } from "@/server/db/client";
import { createBackApp } from "@/server/services/products";
import { getSiteSettings, trafficBySource, updateSiteSettings } from "@/server/services/traffic";
import { asUser, createOwner } from "../helpers/db";

let owner: { userId: string; workspaceId: string };
let productId: string;
const as = <T>(fn: (tx: Tx) => Promise<T>) => asUser(owner.userId, fn);

beforeAll(async () => {
  owner = await createOwner();
  productId = (await as((tx) => createBackApp(tx, owner.workspaceId))).id;
}, 60_000);
afterAll(closePools);

describe("website traffic", () => {
  it("gives each product a public site key and editable settings", async () => {
    const s = await as((tx) => getSiteSettings(tx, owner.workspaceId, productId));
    expect(s.site_key).toMatch(/^[a-f0-9]{32}$/);
    await as((tx) => updateSiteSettings(tx, owner.workspaceId, productId, { domain: "backapp.live", app_store_url: "https://apps.apple.com/app/id6811918141", app_store_pt: "123456" }));
    expect((await as((tx) => getSiteSettings(tx, owner.workspaceId, productId))).domain).toBe("backapp.live");
  });

  it("sums visits, visitors and App Store clicks per source", async () => {
    await withContext({ userId: null, role: "service", actorType: "system" }, async (tx) => {
      const ins = (kind: string, source: string, visitor: string, campaign: string | null = null) =>
        tx.query("insert into site_events (workspace_id, product_id, kind, source, visitor_hash, campaign) values ($1,$2,$3,$4,$5,$6)", [owner.workspaceId, productId, kind, source, visitor, campaign]);
      await ins("pageview", "instagram", "a", "instagram_bio");
      await ins("pageview", "instagram", "a", "instagram_bio");
      await ins("pageview", "instagram", "b");
      await ins("app_store_click", "instagram", "a", "instagram_bio");
      await ins("pageview", "youtube", "c");
    });
    const t = await as((tx) => trafficBySource(tx, productId, new Date(Date.now() - 86_400_000)));
    expect(t.rows[0]).toMatchObject({ source: "instagram", visits: 3, visitors: 2, app_store_clicks: 1 });
    expect(t.rows.find((r) => r.source === "youtube")?.visits).toBe(1);
    expect(t.campaigns[0]).toMatchObject({ campaign: "instagram_bio", visits: 2, app_store_clicks: 1 });
  });

  it("does not let the app user write or change visit history", async () => {
    await expect(as((tx) => tx.query("update site_events set source = 'x' where product_id = $1", [productId]))).rejects.toThrow();
  });
});
