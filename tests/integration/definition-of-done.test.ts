/**
 * Definition of Done, checked against the real database with row-level security on (mock AI):
 * three products stay isolated; one full pipeline per product (idea → hooks → content → reviews → UTM → approval →
 * publication); a metrics CSV is matched to publications; comparisons by hook / angle / channel run; disconnecting
 * a channel keeps publications and metrics; every step leaves an activity-log entry.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, type Tx } from "@/server/db/client";
import { createProduct } from "@/server/services/products";
import { createIdea, createUtmForItem, decideApproval, generateContent, generateHooks, markPublished, submitForApproval, type Actor } from "@/server/services/content";
import { importMetricsCsv, revertBatch } from "@/server/services/measurement";
import { compareBy, publicationRows } from "@/server/services/analytics";
import { connectChannel, revokeChannel } from "@/server/services/connections";
import { DEFAULT_THRESHOLDS } from "@/domain/stats";
import { asUser, createOwner } from "../helpers/db";

let owner: { userId: string; workspaceId: string };
let stranger: { userId: string; workspaceId: string };
let actor: Actor;
const products: Array<{ id: string; slug: string; pubs: Array<{ id: string; url: string; itemId: string }> }> = [];

const as = <T>(fn: (tx: Tx) => Promise<T>) => asUser(owner.userId, fn);

async function publishOne(productId: string, slug: string, n: number) {
  return as(async (tx) => {
    const idea = await createIdea(tx, actor, productId, {
      title: `Idea ${n}`, insight: "Test insight", audienceId: null, segmentId: null, jobId: null, fearId: null, quoteId: null,
      signalId: null, topic: "Testing", funnelStage: null, sourceIds: [],
    });
    await generateHooks(tx, actor, productId, idea.id, 3);
    const hook = await tx.one<{ id: string }>("select id from hooks where idea_id = $1 order by created_at limit 1", [idea.id]);
    const { itemIds } = await generateContent(tx, actor, productId, { ideaId: idea.id, hookId: hook.id, channel: "threads", format: "short_post", goal: "Traffic", language: "en", ctaTermId: null, campaignId: null });
    const out = [];
    for (const [k, itemId] of itemIds.entries()) {
      const status = await tx.one<{ status: string }>("select status from content_items where id = $1", [itemId]);
      expect(status.status).toBe("needs_human_review"); // mock reviews never pass silently
      await createUtmForItem(tx, actor, productId, itemId, `https://${slug}.example/start`);
      const approval = await submitForApproval(tx, actor, productId, itemId);
      expect(await decideApproval(tx, actor, productId, approval.id, "approved", "ok")).toBe("approved");
      const url = `https://www.threads.net/@${slug}/post/${n}-${k}`;
      const pub = await markPublished(tx, actor, productId, itemId, url, new Date(Date.now() - 86_400_000));
      out.push({ id: pub.id, url, itemId });
    }
    return out;
  });
}

beforeAll(async () => {
  owner = await createOwner();
  stranger = await createOwner();
  actor = { workspaceId: owner.workspaceId, userId: owner.userId };
  for (const slug of ["dod-one", "dod-two", "dod-three"]) {
    const p = await as((tx) => createProduct(tx, owner.workspaceId, { name: slug, slug, short_description: "", category: "", website_url: `https://${slug}.example` }));
    products.push({ id: p.id, slug, pubs: [] });
  }
  // Product one gets a connected channel before publishing, so we can disconnect it later.
  await as((tx) => connectChannel(tx, owner.workspaceId, products[0].id, "threads", "@dod-one", "requires_approval"));
  for (const p of products) p.pubs = await publishOne(p.id, p.slug, 1);
}, 120_000);
afterAll(closePools);

describe("three products in one workspace", () => {
  it("each product sees only its own publications", async () => {
    for (const p of products) {
      const rows = await as((tx) => publicationRows(tx, p.id, new Date(0), new Date(Date.now() + 86_400_000), false));
      expect(rows.map((r) => r.pub_id).sort()).toEqual(p.pubs.map((x) => x.id).sort());
    }
  });

  it("refuses a UTM landing page on another product's domain", async () => {
    const itemId = products[0].pubs[0].itemId;
    await expect(as((tx) => createUtmForItem(tx, actor, products[1].id, itemId, "https://dod-two.example/x"))).rejects.toThrow();
  });

  it("hides every product from a member of another workspace", async () => {
    const seen = await asUser(stranger.userId, (tx) => tx.query("select id from publications where product_id = any($1)", [products.map((p) => p.id)]));
    expect(seen).toHaveLength(0);
  });
});

describe("metrics CSV import", () => {
  it("matches rows by post link, skips unknown links and can be reverted", async () => {
    const p = products[0];
    const csv = [
      "Post link,Date,Reach,Clicks",
      ...p.pubs.map((x, i) => `${x.url}?igsh=abc,2026-10-10,${1500 + i * 100},${40 + i}`),
      "https://www.threads.net/@someone-else/post/zzz,2026-10-10,999,9",
    ].join("\n");
    const mapping = { "Post link": "post_url", Date: "date", Reach: "reach", Clicks: "clicks" };
    const s = await as((tx) => importMetricsCsv(tx, owner.workspaceId, p.id, csv, mapping, "test.csv"));
    expect(s.rows).toBe(p.pubs.length + 1);
    expect(s.imported).toBe(p.pubs.length * 2);
    expect(s.skipped).toHaveLength(1);

    const rows = await as((tx) => publicationRows(tx, p.id, new Date(0), new Date(Date.now() + 86_400_000), false));
    expect(rows.every((r) => r.m.clicks >= 40)).toBe(true);

    // Product two is untouched by product one's import.
    const other = await as((tx) => publicationRows(tx, products[1].id, new Date(0), new Date(Date.now() + 86_400_000), false));
    expect(other.every((r) => r.m.clicks === undefined)).toBe(true);

    await as((tx) => revertBatch(tx, p.id, s.batchId));
    const after = await as((tx) => publicationRows(tx, p.id, new Date(0), new Date(Date.now() + 86_400_000), false));
    expect(after.every((r) => r.m.clicks === undefined)).toBe(true);
    // Re-import so later tests have data.
    await as((tx) => importMetricsCsv(tx, owner.workspaceId, p.id, csv, mapping, "test-again.csv"));
  });
});

describe("comparisons", () => {
  it("groups by hook, angle and channel and refuses to name a leader on a small sample", async () => {
    const rows = await as((tx) => publicationRows(tx, products[0].id, new Date(0), new Date(Date.now() + 86_400_000), false));
    for (const dim of ["hook", "angle", "channel"] as const) {
      const r = compareBy(rows, dim, DEFAULT_THRESHOLDS);
      expect(r.groups.reduce((a, g) => a + g.publications, 0)).toBe(rows.length);
      expect(r.verdict.kind).toBe("not_enough_data");
    }
    expect(rows.every((r) => r.hook && r.angle && r.channel === "threads")).toBe(true);
  });
});

describe("disconnecting an integration", () => {
  it("revokes the connection but keeps publications, links and metrics", async () => {
    const p = products[0];
    const conn = await as((tx) => tx.one<{ id: string }>("select id from channel_connections where product_id = $1 and status <> 'revoked'", [p.id]));
    const linked = await as((tx) => tx.query("select id from publications where connection_id = $1", [conn.id]));
    expect(linked.length).toBe(p.pubs.length);

    await as((tx) => revokeChannel(tx, p.id, conn.id));
    const state = await as((tx) => tx.one<{ status: string; revoked_at: string | null }>("select status, revoked_at from channel_connections where id = $1", [conn.id]));
    expect(state.status).toBe("revoked");
    expect(state.revoked_at).not.toBeNull();

    const still = await as((tx) => tx.query("select id from publications where connection_id = $1", [conn.id]));
    expect(still.length).toBe(p.pubs.length);
    const rows = await as((tx) => publicationRows(tx, p.id, new Date(0), new Date(Date.now() + 86_400_000), false));
    expect(rows.every((r) => r.m.clicks >= 40)).toBe(true);
  });
});

describe("activity log", () => {
  it("records who did what for every step, per product", async () => {
    const p = products[0];
    const log = await as((tx) =>
      tx.query<{ entity_type: string; action: string; actor_type: string }>("select entity_type, action, actor_type from audit_logs where product_id = $1", [p.id]),
    );
    const entities = new Set(log.map((l) => l.entity_type));
    for (const e of ["ideas", "content_items", "approval_decisions", "publications", "utm_links", "channel_connections", "import_batches"]) {
      expect(entities, e).toContain(e);
    }
    expect(log.some((l) => l.entity_type === "channel_connections" && l.action === "update")).toBe(true);
    // Nobody can edit history.
    await expect(as((tx) => tx.query("delete from audit_logs where product_id = $1", [p.id]))).rejects.toThrow(/permission denied/);
  });
});
