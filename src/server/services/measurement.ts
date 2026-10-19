import type { Tx } from "@/server/db/client";
import { parseCsv, parseNumber } from "@/domain/csv";
import { parseUtm } from "@/domain/utm";

export const METRIC_KEYS = ["reach", "impressions", "views", "retention_avg_pct", "likes", "saves", "shares", "comments", "clicks", "profile_visits", "follows"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

/** Header aliases used to propose a column mapping; the owner confirms it before import. */
const ALIASES: Record<string, string[]> = {
  post_url: ["post_url", "url", "permalink", "link", "post link", "ссылка", "post"],
  date: ["date", "observed_at", "day", "дата", "reporting starts", "day "],
  reach: ["reach", "accounts reached", "охват"],
  impressions: ["impressions", "показы"],
  views: ["views", "plays", "video views", "просмотры"],
  retention_avg_pct: ["retention", "avg watch %", "average watch percentage"],
  likes: ["likes", "лайки", "reactions"],
  saves: ["saves", "saved", "сохранения"],
  shares: ["shares", "reposts", "репосты"],
  comments: ["comments", "replies", "комментарии"],
  clicks: ["clicks", "link clicks", "клики"],
  profile_visits: ["profile visits", "profile_visits"],
  follows: ["follows", "new followers", "подписки"],
};

export function proposeMapping(header: string[], targets: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  header.forEach((h) => {
    const n = h.trim().toLowerCase();
    for (const t of targets) {
      if (Object.values(map).includes(t)) continue;
      if ((ALIASES[t] ?? [t]).some((a) => n === a || n.replace(/[_\s]+/g, " ") === a)) {
        map[h] = t;
        break;
      }
    }
  });
  return map;
}

function normaliseUrl(u: string): string {
  try {
    const x = new URL(u.trim());
    return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}

function parseDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s);
  const d = m ? new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12)) : new Date(s.length === 10 ? `${s}T12:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface ImportSummary {
  batchId: string;
  rows: number;
  imported: number;
  skipped: Array<{ row: number; reason: string }>;
}

async function newBatch(tx: Tx, workspaceId: string, productId: string, kind: string, label: string, isDemo = false) {
  return tx.one<{ id: string }>("insert into import_batches (workspace_id, product_id, kind, source_label, is_demo) values ($1,$2,$3,$4,$5) returning id", [workspaceId, productId, kind, label, isDemo]);
}

async function finishBatch(tx: Tx, id: string, s: Omit<ImportSummary, "batchId">) {
  await tx.query("update import_batches set status = 'completed', stats = $2 where id = $1", [id, JSON.stringify({ rows: s.rows, imported: s.imported, skipped: s.skipped.length })]);
}

export async function addManualMetrics(tx: Tx, workspaceId: string, productId: string, publicationId: string, observedAt: Date, values: Partial<Record<MetricKey, number>>) {
  const pub = await tx.maybeOne<{ id: string; is_demo: boolean }>("select id, is_demo from publications where id = $1 and product_id = $2", [publicationId, productId]);
  if (!pub) throw new Error("Publication not found");
  let n = 0;
  for (const [metric, value] of Object.entries(values)) {
    if (value === undefined || value === null || Number.isNaN(value)) continue;
    await tx.query(
      "insert into metric_events (workspace_id, product_id, publication_id, metric, value, observed_at, source, is_demo) values ($1,$2,$3,$4,$5,$6,'manual',$7)",
      [workspaceId, productId, publicationId, metric, value, observedAt.toISOString(), pub.is_demo],
    );
    n++;
  }
  return n;
}

/** Metrics CSV: one row per post (and optionally per date). Rows are matched to publications by the post link. */
export async function importMetricsCsv(tx: Tx, workspaceId: string, productId: string, csv: string, mapping: Record<string, string>, label: string): Promise<ImportSummary> {
  const { header, rows } = parseCsv(csv);
  const col = (target: string) => header.findIndex((h) => mapping[h] === target);
  const urlCol = col("post_url");
  if (urlCol < 0) throw new Error("Map one column to the post link: rows are matched to publications by it.");
  const dateCol = col("date");
  const metricCols = METRIC_KEYS.map((m) => [m, col(m)] as const).filter(([, i]) => i >= 0);
  if (!metricCols.length) throw new Error("Map at least one metric column.");
  const pubs = await tx.query<{ id: string; external_url: string | null; is_demo: boolean }>("select id, external_url, is_demo from publications where product_id = $1", [productId]);
  const byUrl = new Map(pubs.filter((p) => p.external_url).map((p) => [normaliseUrl(p.external_url!), p]));
  const batch = await newBatch(tx, workspaceId, productId, "metrics_csv", label);
  const skipped: ImportSummary["skipped"] = [];
  let imported = 0;
  for (const [i, r] of rows.entries()) {
    const pub = byUrl.get(normaliseUrl(r[urlCol] ?? ""));
    if (!pub) {
      skipped.push({ row: i + 2, reason: `No publication with link ${r[urlCol] || "(empty)"}` });
      continue;
    }
    const at = dateCol >= 0 ? parseDate(r[dateCol]) : new Date();
    if (!at) {
      skipped.push({ row: i + 2, reason: `Unreadable date "${r[dateCol]}"` });
      continue;
    }
    for (const [metric, c] of metricCols) {
      const v = parseNumber(r[c]);
      if (v === null) continue;
      if (v < 0 || (metric === "retention_avg_pct" && v > 100)) {
        skipped.push({ row: i + 2, reason: `${metric} value ${v} is out of range` });
        continue;
      }
      await tx.query(
        "insert into metric_events (workspace_id, product_id, publication_id, metric, value, observed_at, source, import_batch_id, is_demo) values ($1,$2,$3,$4,$5,$6,'csv',$7,$8)",
        [workspaceId, productId, pub.id, metric, v, at.toISOString(), batch.id, pub.is_demo],
      );
      imported++;
    }
  }
  await finishBatch(tx, batch.id, { rows: rows.length, imported, skipped });
  return { batchId: batch.id, rows: rows.length, imported, skipped };
}

const CONVERSION_TYPES = ["registration", "trial_start", "payment", "cancellation", "refund", "lead"] as const;

/** Conversions CSV (from app analytics, store or payment exports). Matched to UTM links by URL or utm_campaign + utm_content. Unmatched rows are kept and reported, never guessed. */
export async function importConversionsCsv(tx: Tx, workspaceId: string, productId: string, csv: string, mapping: Record<string, string>, label: string): Promise<ImportSummary & { matched: number }> {
  const { header, rows } = parseCsv(csv);
  const col = (t: string) => header.findIndex((h) => mapping[h] === t);
  const [typeC, dateC, refC, amountC, currC, urlC, campC, contC] = ["type", "occurred_at", "external_ref", "amount", "currency", "landing_url", "utm_campaign", "utm_content"].map(col);
  if (typeC < 0 || dateC < 0) throw new Error("Map the conversion type and date columns.");
  const links = await tx.query<{ id: string; utm_campaign: string; utm_content: string }>("select id, utm_campaign, utm_content from utm_links where product_id = $1", [productId]);
  const key = (c?: string, k?: string) => `${(c ?? "").toLowerCase()}|${(k ?? "").toLowerCase()}`;
  const byKey = new Map(links.map((l) => [key(l.utm_campaign, l.utm_content), l.id]));
  const batch = await newBatch(tx, workspaceId, productId, "conversions_csv", label);
  const skipped: ImportSummary["skipped"] = [];
  let imported = 0;
  let matched = 0;
  for (const [i, r] of rows.entries()) {
    const rawType = (r[typeC] ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/s$/, "");
    const type = (CONVERSION_TYPES as readonly string[]).includes(rawType) ? rawType : rawType === "trial" ? "trial_start" : rawType === "signup" || rawType === "sign_up" ? "registration" : null;
    if (!type) {
      skipped.push({ row: i + 2, reason: `Unknown conversion type "${r[typeC]}"` });
      continue;
    }
    const at = parseDate(r[dateC]);
    if (!at) {
      skipped.push({ row: i + 2, reason: `Unreadable date "${r[dateC]}"` });
      continue;
    }
    const fromUrl = urlC >= 0 ? parseUtm(r[urlC] ?? "") : {};
    const camp = (campC >= 0 ? r[campC] : undefined) || fromUrl.utm_campaign;
    const cont = (contC >= 0 ? r[contC] : undefined) || fromUrl.utm_content;
    const linkId = camp && cont ? byKey.get(key(camp, cont)) ?? null : null;
    const ref = refC >= 0 && r[refC] ? r[refC].trim() : `row-${batch.id.slice(0, 8)}-${i + 2}`;
    const res = await tx.query(
      `insert into conversions (workspace_id, product_id, type, amount, currency, occurred_at, external_ref, utm_link_id, raw_utm, match_status, import_batch_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (product_id, type, external_ref) do nothing returning id`,
      [workspaceId, productId, type, amountC >= 0 ? parseNumber(r[amountC]) : null, currC >= 0 ? (r[currC] || null) : null, at.toISOString(), ref, linkId,
       JSON.stringify({ utm_campaign: camp ?? null, utm_content: cont ?? null }), linkId ? "matched" : "unmatched", batch.id],
    );
    if (!res.length) {
      skipped.push({ row: i + 2, reason: `Duplicate ${type} ${ref}` });
      continue;
    }
    imported++;
    if (linkId) matched++;
  }
  await finishBatch(tx, batch.id, { rows: rows.length, imported, skipped });
  return { batchId: batch.id, rows: rows.length, imported, skipped, matched };
}

/** Paid ads report CSV (Meta Ads Manager or Google Ads export): daily rows per ad with spend and results. */
export async function importAdsCsv(
  tx: Tx, workspaceId: string, productId: string, platform: "meta_ads" | "google_ads", accountId: string, csv: string, mapping: Record<string, string>, label: string,
): Promise<ImportSummary> {
  const { header, rows } = parseCsv(csv);
  const col = (t: string) => header.findIndex((h) => mapping[h] === t);
  const c = Object.fromEntries(["day", "campaign", "ad_group", "ad_name", "ad_id", "spend", "impressions", "clicks", "results", "reach", "currency", "final_url"].map((t) => [t, col(t)]));
  if (c.day < 0 || c.spend < 0 || c.campaign < 0 || (c.ad_name < 0 && c.ad_id < 0)) throw new Error("Map at least: day, campaign, ad (name or id) and spend.");
  if (!accountId.trim()) throw new Error("Enter the ad account id.");
  const account = await tx.one<{ id: string; currency: string }>(
    `insert into ad_accounts (workspace_id, product_id, platform, external_account_id, name) values ($1,$2,$3,$4,$4)
     on conflict (product_id, platform, external_account_id) do update set updated_at = now() returning id, currency`,
    [workspaceId, productId, platform, accountId.trim()],
  );
  const links = await tx.query<{ id: string; utm_campaign: string; utm_content: string; content_item_id: string | null }>("select id, utm_campaign, utm_content, content_item_id from utm_links where product_id = $1", [productId]);
  const batch = await newBatch(tx, workspaceId, productId, "ads_report", label);
  const skipped: ImportSummary["skipped"] = [];
  let imported = 0;
  const cache = new Map<string, string>();
  const upsert = async (sql: string, args: unknown[], k: string) => {
    if (cache.has(k)) return cache.get(k)!;
    const r = await tx.one<{ id: string }>(sql, args);
    cache.set(k, r.id);
    return r.id;
  };
  for (const [i, r] of rows.entries()) {
    const day = parseDate(r[c.day]);
    const spend = parseNumber(r[c.spend]);
    if (!day || spend === null) {
      skipped.push({ row: i + 2, reason: !day ? `Unreadable day "${r[c.day]}"` : "Missing spend" });
      continue;
    }
    const campName = (r[c.campaign] ?? "").trim() || "(no campaign)";
    const groupName = c.ad_group >= 0 ? (r[c.ad_group] ?? "").trim() || "(no group)" : "(no group)";
    const adName = c.ad_name >= 0 ? (r[c.ad_name] ?? "").trim() : "";
    const adExt = c.ad_id >= 0 && r[c.ad_id] ? r[c.ad_id].trim() : `name:${adName}`;
    const campId = await upsert(
      `insert into ad_campaigns (workspace_id, product_id, ad_account_id, external_id, name) values ($1,$2,$3,$4,$4)
       on conflict (ad_account_id, external_id) do update set updated_at = now() returning id`,
      [workspaceId, productId, account.id, campName], `c:${campName}`,
    );
    const groupId = await upsert(
      `insert into ad_groups (workspace_id, product_id, ad_campaign_id, external_id, name) values ($1,$2,$3,$4,$4)
       on conflict (ad_campaign_id, external_id) do update set updated_at = now() returning id`,
      [workspaceId, productId, campId, groupName], `g:${campName}|${groupName}`,
    );
    const url = c.final_url >= 0 ? r[c.final_url] ?? "" : "";
    const utm = parseUtm(url.includes("://") ? url : `https://x.invalid/?${url}`);
    const link = links.find((l) => l.utm_campaign === utm.utm_campaign && l.utm_content === utm.utm_content);
    const adId = await upsert(
      `insert into ads (workspace_id, product_id, ad_group_id, external_id, name, utm_link_id, content_item_id) values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (ad_group_id, external_id) do update set name = excluded.name, utm_link_id = coalesce(excluded.utm_link_id, ads.utm_link_id), updated_at = now() returning id`,
      [workspaceId, productId, groupId, adExt, adName || adExt, link?.id ?? null, link?.content_item_id ?? null], `a:${groupId}|${adExt}`,
    );
    const currency = (c.currency >= 0 && r[c.currency]) || account.currency;
    await tx.query(
      `insert into ad_daily_stats (workspace_id, product_id, ad_id, day, spend, currency, impressions, reach, clicks, platform_conversions, import_batch_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [workspaceId, productId, adId, day.toISOString().slice(0, 10), spend, currency, parseNumber(r[c.impressions]) ?? 0, c.reach >= 0 ? parseNumber(r[c.reach]) : null,
       parseNumber(r[c.clicks]) ?? 0, c.results >= 0 ? parseNumber(r[c.results]) : null, batch.id],
    );
    imported++;
  }
  await finishBatch(tx, batch.id, { rows: rows.length, imported, skipped });
  return { batchId: batch.id, rows: rows.length, imported, skipped };
}

/** Undo an import: rows stay (history is append-only) but the batch is excluded from every view and analysis. */
export async function revertBatch(tx: Tx, productId: string, batchId: string) {
  await tx.query("update import_batches set status = 'reverted' where id = $1 and product_id = $2 and status = 'completed'", [batchId, productId]);
  await tx.query("delete from conversions where import_batch_id = $1 and product_id = $2", [batchId, productId]);
}

export const ADS_ALIASES: Record<string, string[]> = {
  day: ["day", "date", "reporting starts", "дата"],
  campaign: ["campaign", "campaign name", "кампания"],
  ad_group: ["ad set name", "ad set", "ad group", "ad group name"],
  ad_name: ["ad name", "ad", "объявление"],
  ad_id: ["ad id", "ad_id"],
  spend: ["amount spent", "amount spent (eur)", "spend", "cost", "расход"],
  impressions: ["impressions", "impr.", "показы"],
  clicks: ["link clicks", "clicks", "клики"],
  results: ["results", "conversions", "результаты"],
  reach: ["reach", "охват"],
  currency: ["currency", "currency code"],
  final_url: ["url tags", "final url", "website url", "link"],
};

export const CONVERSION_ALIASES: Record<string, string[]> = {
  type: ["type", "event", "event name", "conversion", "тип"],
  occurred_at: ["date", "occurred_at", "time", "timestamp", "дата"],
  external_ref: ["id", "transaction id", "user id", "external_ref", "order id"],
  amount: ["amount", "revenue", "price", "сумма"],
  currency: ["currency"],
  landing_url: ["landing_url", "landing page", "url", "first touch url"],
  utm_campaign: ["utm_campaign", "campaign"],
  utm_content: ["utm_content", "content"],
};

export function proposeMappingWith(header: string[], aliases: Record<string, string[]>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const h of header) {
    const n = h.trim().toLowerCase();
    for (const [t, list] of Object.entries(aliases)) {
      if (Object.values(map).includes(t)) continue;
      if (list.includes(n)) {
        map[h] = t;
        break;
      }
    }
  }
  return map;
}
