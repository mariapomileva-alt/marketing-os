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
