import type { Tx } from "@/server/db/client";
import { compareGroups, costPer, safeDivide, type GroupStats, type Thresholds } from "@/domain/stats";

export interface PubRow {
  pub_id: string;
  content_item_id: string;
  title: string;
  channel: string;
  format: string;
  published_at: string;
  is_demo: boolean;
  segment: string | null;
  hook: string | null;
  angle: string | null;
  cta: string | null;
  topic: string | null;
  m: Record<string, number>;
  conv: Record<string, number>;
  spend: number | null;
}

export async function publicationRows(tx: Tx, productId: string, from: Date, to: Date, includeDemo: boolean): Promise<PubRow[]> {
  return tx.query<PubRow>(
    `with pubs as (
       select p.id pub_id, p.content_item_id, i.title, p.channel, i.format, p.published_at::text, p.is_demo or i.is_demo is_demo,
              e.dimensions_snapshot ->> 'segment' segment, e.dimensions_snapshot ->> 'hook' hook, e.dimensions_snapshot ->> 'angle' angle,
              e.dimensions_snapshot ->> 'cta' cta, e.dimensions_snapshot ->> 'topic' topic
         from publications p join content_items i on i.id = p.content_item_id join experiments e on e.content_item_id = i.id
        where p.product_id = $1 and p.published_at >= $2 and p.published_at < $3 and ($4 or not (p.is_demo or i.is_demo))
     ),
     m as (select publication_id, jsonb_object_agg(metric, value) m from metric_latest where product_id = $1 group by publication_id),
     conv as (
       select ul.content_item_id, jsonb_object_agg(c.type, c.n) conv from (
         select c.utm_link_id, c.type, count(*) n from conversions c left join import_batches b on b.id = c.import_batch_id
          where c.product_id = $1 and c.match_status = 'matched' and (b.id is null or b.status <> 'reverted') group by 1, 2) c
       join utm_links ul on ul.id = c.utm_link_id group by ul.content_item_id
     ),
     spend as (
       select a.content_item_id, sum(s.spend) spend from ad_daily_stats_latest s join ads a on a.id = s.ad_id
        where s.product_id = $1 and a.content_item_id is not null group by 1
     )
     select pubs.*, coalesce(m.m, '{}') m, coalesce(conv.conv, '{}') conv, spend.spend::float spend
       from pubs left join m on m.publication_id = pubs.pub_id left join conv on conv.content_item_id = pubs.content_item_id
       left join spend on spend.content_item_id = pubs.content_item_id
      order by pubs.published_at desc`,
    [productId, from.toISOString(), to.toISOString(), includeDemo],
  );
}

export const exposureOf = (r: PubRow) => r.m.impressions ?? r.m.reach ?? r.m.views ?? 0;
export const engagementOf = (r: PubRow) => (r.m.likes ?? 0) + (r.m.saves ?? 0) + (r.m.shares ?? 0) + (r.m.comments ?? 0);

export async function funnelCounts(tx: Tx, productId: string, from: Date, to: Date, includeDemo: boolean) {
  return tx.one<{ created: number; approved: number; published: number }>(
    `select (select count(*)::int from content_items where product_id = $1 and created_at >= $2 and created_at < $3 and ($4 or not is_demo)) created,
            (select count(*)::int from approval_decisions where product_id = $1 and decision = 'approved' and decided_at >= $2 and decided_at < $3) approved,
            (select count(*)::int from publications where product_id = $1 and published_at >= $2 and published_at < $3 and ($4 or not is_demo)) published`,
    [productId, from.toISOString(), to.toISOString(), includeDemo],
  );
}

export async function adsTotals(tx: Tx, productId: string, from: Date, to: Date) {
  return tx.one<{ spend: number | null; impressions: number; clicks: number; platform_conversions: number | null; currency: string | null }>(
    `select sum(spend)::float spend, coalesce(sum(impressions), 0)::float impressions, coalesce(sum(clicks), 0)::float clicks,
            sum(platform_conversions)::float platform_conversions, min(currency) currency
       from ad_daily_stats_latest where product_id = $1 and day >= $2::date and day < $3::date`,
    [productId, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)],
  );
}

export async function conversionTotals(tx: Tx, productId: string, from: Date, to: Date) {
  const rows = await tx.query<{ type: string; matched: number; total: number }>(
    `select c.type, count(*) filter (where c.match_status = 'matched')::int matched, count(*)::int total
       from conversions c left join import_batches b on b.id = c.import_batch_id
      where c.product_id = $1 and c.occurred_at >= $2 and c.occurred_at < $3 and (b.id is null or b.status <> 'reverted') group by 1`,
    [productId, from.toISOString(), to.toISOString()],
  );
  return Object.fromEntries(rows.map((r) => [r.type, r]));
}

export interface Totals {
  reach: number;
  exposure: number;
  engagement: number;
  saves: number;
  clicks: number;
  registrations: number;
  trials: number;
  payments: number;
  spend: number | null;
  conversionRate: number | null;
  cpl: number | null;
  cac: number | null;
}

export function totalsOf(rows: PubRow[], adSpend: number | null, conv: Record<string, { matched: number; total: number }>): Totals {
  const sum = (f: (r: PubRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const clicks = sum((r) => r.m.clicks ?? 0);
  const registrations = conv.registration?.total ?? 0;
  const payments = conv.payment?.total ?? 0;
  const spend = adSpend;
  return {
    reach: sum((r) => r.m.reach ?? 0),
    exposure: sum(exposureOf),
    engagement: sum(engagementOf),
    saves: sum((r) => r.m.saves ?? 0),
    clicks,
    registrations,
    trials: conv.trial_start?.total ?? 0,
    payments,
    spend,
    conversionRate: safeDivide(registrations, clicks),
    cpl: costPer(spend, registrations + (conv.lead?.total ?? 0)),
    cac: costPer(spend, payments),
  };
}

export const DIMENSIONS = {
  channel: "Channel",
  format: "Format",
  segment: "Segment",
  hook: "Hook",
  angle: "Angle",
  cta: "CTA",
  topic: "Topic",
} as const;
export type Dimension = keyof typeof DIMENSIONS;

/** Groups publications by one dimension and compares click-through on exposure with sample thresholds. */
export function compareBy(rows: PubRow[], dim: Dimension, t: Thresholds) {
  const groups = new Map<string, GroupStats & { engagement: number; saves: number; registrations: number }>();
  for (const r of rows) {
    const raw = (r as unknown as Record<string, string | null>)[dim];
    const key = raw && raw.trim() ? raw : "(not set)";
    const g = groups.get(key) ?? { key, label: key, publications: 0, impressions: 0, successes: 0, engagement: 0, saves: 0, registrations: 0 };
    g.publications += 1;
    g.impressions += exposureOf(r);
    g.successes += r.m.clicks ?? 0;
    g.engagement += engagementOf(r);
    g.saves += r.m.saves ?? 0;
    g.registrations += r.conv.registration ?? 0;
    groups.set(key, g);
  }
  const list = [...groups.values()];
  const cmp = compareGroups(list, t);
  return { ...cmp, extra: Object.fromEntries(list.map((g) => [g.key, { engagement: g.engagement, saves: g.saves, registrations: g.registrations }])) };
}

export async function thresholdsFor(tx: Tx, workspaceId: string): Promise<Thresholds & { minShare: number }> {
  const s = await tx.maybeOne<{ min_publications_per_group: number; min_impressions_per_group: number; min_n_share_cell: number }>(
    "select min_publications_per_group, min_impressions_per_group, min_n_share_cell from workspace_settings where workspace_id = $1",
    [workspaceId],
  );
  return { minPublicationsPerGroup: s?.min_publications_per_group ?? 5, minImpressionsPerGroup: s?.min_impressions_per_group ?? 1000, minShare: s?.min_n_share_cell ?? 20 };
}

/** Per-product summary for the workspace-level comparison ("performance by product"). */
export async function productSummaries(tx: Tx, workspaceId: string, from: Date, to: Date) {
  return tx.query<{ id: string; slug: string; name: string; is_demo: boolean; published: number; clicks: number; registrations: number; spend: number | null }>(
    `select p.id, p.slug, p.name, p.is_demo,
            (select count(*)::int from publications x where x.product_id = p.id and x.published_at >= $2 and x.published_at < $3) published,
            (select coalesce(sum(value), 0)::float from metric_latest ml join publications x on x.id = ml.publication_id
              where ml.product_id = p.id and ml.metric = 'clicks' and x.published_at >= $2 and x.published_at < $3) clicks,
            (select count(*)::int from conversions c where c.product_id = p.id and c.type = 'registration' and c.occurred_at >= $2 and c.occurred_at < $3) registrations,
            (select sum(spend)::float from ad_daily_stats_latest s where s.product_id = p.id and s.day >= $2::date and s.day < $3::date) spend
       from products p where p.workspace_id = $1 and p.status <> 'archived' order by p.created_at`,
    [workspaceId, from.toISOString(), to.toISOString()],
  );
}
