import type { Tx } from "@/server/db/client";
import type { Source } from "@/domain/traffic";

export interface SiteSettings {
  site_key: string;
  domain: string | null;
  app_store_url: string | null;
  app_store_pt: string | null;
}

export async function getSiteSettings(tx: Tx, workspaceId: string, productId: string): Promise<SiteSettings> {
  await tx.query("insert into site_settings (product_id, workspace_id) values ($1, $2) on conflict (product_id) do nothing", [productId, workspaceId]);
  return tx.one<SiteSettings>("select site_key, domain, app_store_url, app_store_pt from site_settings where product_id = $1", [productId]);
}

export async function updateSiteSettings(tx: Tx, workspaceId: string, productId: string, s: Omit<SiteSettings, "site_key">) {
  await getSiteSettings(tx, workspaceId, productId);
  await tx.query("update site_settings set domain = $2, app_store_url = $3, app_store_pt = $4 where product_id = $1", [productId, s.domain, s.app_store_url, s.app_store_pt]);
}

export interface SourceRow {
  source: Source;
  visits: number;
  visitors: number;
  app_store_clicks: number;
}

export async function trafficBySource(tx: Tx, productId: string, from: Date): Promise<{ rows: SourceRow[]; campaigns: Array<{ campaign: string; source: string; visits: number; app_store_clicks: number }>; days: Array<{ day: string; visits: number }>; first: string | null }> {
  const rows = await tx.query<SourceRow>(
    `select source, count(*) filter (where kind = 'pageview')::int visits,
            count(distinct visitor_hash || to_char(occurred_at, 'YYYY-MM-DD')) filter (where kind = 'pageview')::int visitors,
            count(*) filter (where kind = 'app_store_click')::int app_store_clicks
       from site_events where product_id = $1 and occurred_at >= $2 group by source order by visits desc`,
    [productId, from.toISOString()],
  );
  const campaigns = await tx.query<{ campaign: string; source: string; visits: number; app_store_clicks: number }>(
    `select campaign, source, count(*) filter (where kind = 'pageview')::int visits, count(*) filter (where kind = 'app_store_click')::int app_store_clicks
       from site_events where product_id = $1 and occurred_at >= $2 and campaign is not null group by campaign, source order by visits desc limit 20`,
    [productId, from.toISOString()],
  );
  const days = await tx.query<{ day: string; visits: number }>(
    `select to_char(date_trunc('day', occurred_at at time zone 'Europe/Riga'), 'YYYY-MM-DD') as "day", count(*)::int visits
       from site_events where product_id = $1 and occurred_at >= $2 and kind = 'pageview' group by 1 order by 1`,
    [productId, from.toISOString()],
  );
  const first = (await tx.one<{ first: string | null }>("select min(occurred_at)::text first from site_events where product_id = $1", [productId])).first;
  return { rows, campaigns, days, first };
}

export async function youtubeCommentTotals(tx: Tx, productId: string, from: Date) {
  return tx.one<{ posted: number; replies_posted: number; likes: number; replies_received: number; conversations: number }>(
    `select count(*) filter (where m.variant is distinct from 'reply' and m.variant is distinct from 'safety')::int posted,
            count(*) filter (where m.variant = 'reply')::int replies_posted,
            coalesce(sum(m.like_count), 0)::int likes,
            coalesce(sum(m.reply_count) filter (where m.variant is distinct from 'reply'), 0)::int replies_received,
            count(distinct m.conversation_id) filter (where coalesce(m.reply_count, 0) > 0)::int conversations
       from conversation_messages m join conversations c on c.id = m.conversation_id
      where m.product_id = $1 and c.channel = 'youtube' and m.direction = 'outbound' and m.status = 'posted' and m.occurred_at >= $2`,
    [productId, from.toISOString()],
  );
}

export async function topYoutubeComments(tx: Tx, productId: string) {
  return tx.query<{ id: string; text: string; like_count: number | null; reply_count: number | null; subject: string | null; thread_url: string | null; occurred_at: string }>(
    `select m.id, m.text, m.like_count, m.reply_count, c.subject, c.thread_url, m.occurred_at::text
       from conversation_messages m join conversations c on c.id = m.conversation_id
      where m.product_id = $1 and c.channel = 'youtube' and m.direction = 'outbound' and m.status = 'posted'
        and m.variant is distinct from 'reply' and m.variant is distinct from 'safety'
      order by coalesce(m.like_count, 0) + 2 * coalesce(m.reply_count, 0) desc, m.occurred_at desc limit 10`,
    [productId],
  );
}

const SEARCH = ["google", "bing", "duckduckgo", "yandex"];

export interface PageRow {
  path: string;
  visitors: number;
  entries: number;
  views: number;
  ai: number;
  search: number;
  app_store_clicks: number;
  sources: Array<{ source: string; entries: number }>;
}

/**
 * Pages (articles first of all) by the visits they bring in: a visit "enters" through its first page, and the App Store
 * clicks of that visit count for the page it entered through. Older events without a landing page count by their own page.
 */
export async function pagePerformance(tx: Tx, productId: string, from: Date, aiSources: readonly string[]): Promise<PageRow[]> {
  const base = `select coalesce(landing_path, path) lp, path, kind, source, visitor_hash, occurred_at from site_events where product_id = $1 and occurred_at >= $2`;
  const rows = await tx.query<Omit<PageRow, "sources" | "views">>(
    `with e as (${base})
     select lp as path,
            count(distinct visitor_hash || to_char(occurred_at, 'YYYY-MM-DD')) filter (where kind = 'pageview' and path = lp)::int visitors,
            count(*) filter (where kind = 'pageview' and path = lp)::int entries,
            count(*) filter (where kind = 'pageview' and path = lp and source = any($3))::int ai,
            count(*) filter (where kind = 'pageview' and path = lp and source = any($4))::int search,
            count(*) filter (where kind = 'app_store_click')::int app_store_clicks
       from e group by lp having count(*) filter (where kind = 'pageview' and path = lp) > 0
      order by entries desc limit 40`,
    [productId, from.toISOString(), [...aiSources], SEARCH],
  );
  const views = await tx.query<{ path: string; views: number }>(
    "select path, count(*)::int views from site_events where product_id = $1 and occurred_at >= $2 and kind = 'pageview' group by path",
    [productId, from.toISOString()],
  );
  const src = await tx.query<{ lp: string; source: string; entries: number }>(
    `with e as (${base}) select lp, source, count(*)::int entries from e where kind = 'pageview' and path = lp group by lp, source order by entries desc`,
    [productId, from.toISOString()],
  );
  const v = new Map(views.map((x) => [x.path, x.views]));
  return rows.map((r) => ({ ...r, views: v.get(r.path) ?? r.entries, sources: src.filter((s) => s.lp === r.path).slice(0, 4).map(({ source, entries }) => ({ source, entries })) }));
}

/** Visits that arrived with no referrer and no tag: where they land, on what device, from which country, at what hour. */
export async function directBreakdown(tx: Tx, productId: string, from: Date) {
  const p = [productId, from.toISOString()];
  const where = `product_id = $1 and occurred_at >= $2 and kind = 'pageview' and source = 'direct' and path = coalesce(landing_path, path)`;
  const q = (sql: string) => tx.query<{ key: string; n: number }>(sql, p);
  const pages = await q(`select path key, count(*)::int n from site_events where ${where} group by 1 order by 2 desc limit 8`);
  const devices = await q(`select coalesce(device, 'unknown') key, count(*)::int n from site_events where ${where} group by 1 order by 2 desc`);
  const countries = await q(`select coalesce(country, '—') key, count(*)::int n from site_events where ${where} group by 1 order by 2 desc limit 8`);
  const hours = await q(`select extract(hour from occurred_at at time zone 'Europe/Riga')::int::text key, count(*)::int n from site_events where ${where} group by 1 order by 1::int`);
  return { pages, devices, countries, hours };
}
