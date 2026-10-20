/**
 * "Demo: Calm app": a separate product filled with invented, clearly labelled data (is_demo = true) so the
 * Analytics, Experiments and Overview screens can be tried before real data exists. Never mixes with real products.
 */
import type { Tx } from "@/server/db/client";
import { createProduct } from "./products";
import { approvalHash } from "@/domain/approvals";
import { buildUtmLink } from "@/domain/utm";

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

export async function seedDemo(tx: Tx, workspaceId: string): Promise<{ created: boolean; publications: number }> {
  const existing = await tx.maybeOne<{ id: string }>("select id from products where workspace_id = $1 and slug = 'demo-calm'", [workspaceId]);
  if (existing) {
    return { created: false, publications: 0 };
  }
  const p = await createProduct(tx, workspaceId, { name: "Demo: Calm app", slug: "demo-calm", short_description: "Demo product with invented data for trying Analytics. Not a real product.", category: "Demo", website_url: "https://demo.example" }, { isDemo: true });
  const seg = await tx.one<{ id: string }>("insert into segments (workspace_id, product_id, code, name) values ($1,$2,'DM-S1','Demo segment: commuters') returning id", [workspaceId, p.id]);
  const idea = await tx.one<{ id: string }>("insert into ideas (workspace_id, product_id, title, insight, segment_id) values ($1,$2,'Demo idea','Demo data, invented.',$3) returning id", [workspaceId, p.id, seg.id]);
  const hooks = [
    { text: "Demo hook A: a question", angle: "Name the moment", ctr: 0.045 },
    { text: "Demo hook B: a statement", angle: "Normalise", ctr: 0.018 },
    { text: "Demo hook C: one small step", angle: "Micro-step", ctr: 0.03 },
  ];
  const rand = rng(42);
  let n = 0;
  for (const [hi, h] of hooks.entries()) {
    const posts = hi === 2 ? 3 : 7; // hook C deliberately below the sample threshold
    for (let k = 0; k < posts; k++) {
      const channel = k % 2 ? "threads" : "instagram";
      const format = channel === "threads" ? "short_post" : k % 3 ? "caption" : "carousel";
      const item = await tx.one<{ id: string }>(
        "insert into content_items (workspace_id, product_id, idea_id, channel, format, goal, language, title, is_demo) values ($1,$2,$3,$4,$5,'Traffic','en',$6,true) returning id",
        [workspaceId, p.id, idea.id, channel, format, `Demo post ${++n}`],
      );
      const v = await tx.one<{ id: string; content_hash: string }>(
        "insert into content_versions (workspace_id, product_id, content_item_id, version, body, author_type) values ($1,$2,$3,1,$4,'human') returning id, content_hash",
        [workspaceId, p.id, item.id, JSON.stringify({ hook: h.text, body: "Demo body text.", caption: "Demo caption." })],
      );
      await tx.query("update content_items set current_version_id = $1 where id = $2", [v.id, item.id]);
      const published = new Date(Date.now() - (5 + n * 2) * 86_400_000);
      await tx.query(
        "insert into experiments (workspace_id, product_id, content_item_id, dimensions_snapshot, hypothesis, primary_metric, is_demo) values ($1,$2,$3,$4,'Demo hypothesis','clicks',true)",
        [workspaceId, p.id, item.id, JSON.stringify({ segment: "DM-S1", hook: h.text, angle: h.angle, channel, format, cta: "Download the app", topic: "Commuting" })],
      );
      const link = buildUtmLink({ landingUrl: "https://demo.example/start", source: channel, medium: "social", campaign: "demo-calm-demo", content: `ci_${item.id.slice(0, 8)}` });
      const utm = await tx.one<{ id: string }>(
        `insert into utm_links (workspace_id, product_id, content_item_id, channel, landing_url, utm_source, utm_medium, utm_campaign, utm_content, full_url)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [workspaceId, p.id, item.id, channel, link.landingUrl, link.utm_source, link.utm_medium, link.utm_campaign, link.utm_content, link.fullUrl],
      );
      const payload = { contentVersionId: v.id, versionHash: v.content_hash, channel, format, destination: { account: "demo", method: "export" as const }, text: "Demo", utmUrl: link.fullUrl, media: [] };
      const hash = approvalHash(payload);
      const a = await tx.one<{ id: string }>(
        "insert into approval_items (workspace_id, product_id, item_type, content_version_id, subject_summary, payload_snapshot, payload_hash) values ($1,$2,'content_version',$3,$4,$5,$6) returning id",
        [workspaceId, p.id, v.id, `Demo post ${n}`, JSON.stringify(payload), hash],
      );
      await tx.query("insert into approval_decisions (workspace_id, product_id, approval_item_id, decision, payload_hash, note) values ($1,$2,$3,'approved',$4,'Demo data')", [workspaceId, p.id, a.id, hash]);
      for (const st of ["ai_review", "needs_human_review", "approved"]) await tx.query("update content_items set status = $2 where id = $1", [item.id, st]);
      const pub = await tx.one<{ id: string }>(
        "insert into publications (workspace_id, product_id, content_item_id, content_version_id, channel, method, external_url, utm_link_id, approval_item_id, published_at, is_demo) values ($1,$2,$3,$4,$5,'export',$6,$7,$8,$9,true) returning id",
        [workspaceId, p.id, item.id, v.id, channel, `https://demo.example/post/${n}`, utm.id, a.id, published.toISOString()],
      );
      await tx.query("update content_items set status = 'published', published_at = $2 where id = $1", [item.id, published.toISOString()]);
      const reach = Math.round(1200 + rand() * 1800);
      const clicks = Math.round(reach * h.ctr * (0.8 + rand() * 0.4));
      const metrics = { reach, views: Math.round(reach * 1.3), likes: Math.round(reach * 0.05), saves: Math.round(reach * (0.01 + rand() * 0.02)), shares: Math.round(reach * 0.004), comments: Math.round(reach * 0.003), clicks };
      for (const [metric, value] of Object.entries(metrics)) {
        await tx.query("insert into metric_events (workspace_id, product_id, publication_id, metric, value, observed_at, source, is_demo) values ($1,$2,$3,$4,$5,$6,'manual',true)", [
          workspaceId, p.id, pub.id, metric, value, new Date(published.getTime() + 3 * 86_400_000).toISOString(),
        ]);
      }
      const regs = Math.round(clicks * 0.15);
      for (let r = 0; r < regs; r++) {
        await tx.query(
          "insert into conversions (workspace_id, product_id, type, occurred_at, external_ref, utm_link_id, match_status, is_demo) values ($1,$2,'registration',$3,$4,$5,'matched',true)",
          [workspaceId, p.id, new Date(published.getTime() + 86_400_000).toISOString(), `demo-${n}-${r}`, utm.id],
        );
      }
    }
  }
  return { created: true, publications: n };
}

