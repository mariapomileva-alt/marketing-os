import type { QueryResultRow } from "pg";
import type { Tx } from "@/server/db/client";
import { withContext } from "@/server/db/client";
import { decryptSecret, encryptSecret, lastFour } from "@/server/security/crypto";
import type { AscCredentials } from "@/server/appstore/api";

/**
 * App Store Connect for downloads analytics. The connection keeps the API key encrypted (Issuer ID, Key ID and the
 * .p8 text together, as one secret); the app's ongoing report request is created once. Every morning the newest daily
 * reports are read and stored per instance: downloads by day, how people found the app (search, browse, web or app
 * referrer) and the campaign token from our App Store links (ct=web, ct=instagram, …). Read-only: nothing is changed
 * in App Store Connect except the report request itself.
 */
export interface AscDeps {
  app(c: AscCredentials, appId: string): Promise<{ name: string; bundleId: string }>;
  ensureRequest(c: AscCredentials, appId: string): Promise<string>;
  report(c: AscCredentials, requestId: string): Promise<{ id: string; name: string } | null>;
  instances(c: AscCredentials, reportId: string): Promise<Array<{ id: string; processingDate: string }>>;
  segments(c: AscCredentials, instanceId: string): Promise<Array<{ id: string; url: string }>>;
  read(url: string): Promise<Array<Record<string, string>>>;
}

export async function connectAppStore(tx: Tx, workspaceId: string, productId: string, creds: AscCredentials, appId: string, deps: Pick<AscDeps, "app" | "ensureRequest">) {
  if (!/^\d{6,12}$/.test(appId)) throw new Error("The app's Apple ID is the number in its App Store link (id6811918141 → 6811918141).");
  const app = await deps.app(creds, appId); // fails with a clear message if the key is wrong
  const requestId = await deps.ensureRequest(creds, appId);
  const old = await tx.maybeOne<{ id: string; secret_id: string | null }>("select id, secret_id from channel_connections where product_id = $1 and channel = 'app_store' and status <> 'revoked'", [productId]);
  if (old) {
    await tx.query("update channel_connections set status = 'revoked', secret_id = null, revoked_at = now() where id = $1", [old.id]);
    if (old.secret_id) await tx.query("delete from secrets where id = $1", [old.secret_id]);
  }
  const enc = encryptSecret(JSON.stringify(creds));
  const sec = await tx.one<{ id: string }>(
    "insert into secrets (workspace_id, label, ciphertext, iv, auth_tag, key_version, last_four) values ($1,'App Store Connect API key',$2,$3,$4,$5,$6) returning id",
    [workspaceId, enc.ciphertext, enc.iv, enc.authTag, enc.keyVersion, lastFour(creds.keyId)],
  );
  await tx.query(
    `insert into channel_connections (workspace_id, product_id, channel, adapter_kind, account_label, external_account_id, mode, status, secret_id, scopes, last_health_at)
     values ($1,$2,'app_store','official_api',$3,$4,'draft_only','connected',$5,'{analytics_reports}', now())`,
    [workspaceId, productId, app.name, appId, sec.id],
  );
  await tx.query(
    `insert into app_store_sync (product_id, workspace_id, app_apple_id, app_name, request_id, last_error) values ($1,$2,$3,$4,$5,null)
     on conflict (product_id) do update set app_apple_id = excluded.app_apple_id, app_name = excluded.app_name, request_id = excluded.request_id, last_error = null`,
    [productId, workspaceId, appId, app.name, requestId],
  );
  return { app: app.name };
}

export async function disconnectAppStore(tx: Tx, productId: string) {
  const c = await tx.maybeOne<{ id: string; secret_id: string | null }>("select id, secret_id from channel_connections where product_id = $1 and channel = 'app_store' and status <> 'revoked'", [productId]);
  if (!c) return;
  await tx.query("update channel_connections set status = 'revoked', secret_id = null, revoked_at = now() where id = $1", [c.id]);
  if (c.secret_id) await tx.query("delete from secrets where id = $1", [c.secret_id]);
}

async function credentials(tx: Tx, productId: string) {
  const c = await tx.maybeOne<{ secret_id: string | null }>("select secret_id from channel_connections where product_id = $1 and channel = 'app_store' and status = 'connected'", [productId]);
  if (!c?.secret_id) return null;
  const s = await withContext({ userId: null, role: "service" }, (x) =>
    x.one<{ ciphertext: Buffer; iv: Buffer; auth_tag: Buffer; key_version: number }>("select ciphertext, iv, auth_tag, key_version from secrets where id = $1", [c.secret_id]),
  );
  return JSON.parse(decryptSecret({ ciphertext: s.ciphertext, iv: s.iv, authTag: s.auth_tag, keyVersion: s.key_version })) as AscCredentials;
}

const num = (v: string | undefined) => {
  const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/**
 * Reads new or updated daily report instances (at most `maxInstances` per run) and replaces their rows. Instances
 * already imported with the same number of segments are skipped.
 */
export async function syncAppStore(tx: Tx, productId: string, deps: AscDeps, maxInstances = 14) {
  const s = await tx.maybeOne<{ workspace_id: string; app_apple_id: string; request_id: string | null }>("select workspace_id, app_apple_id, request_id from app_store_sync where product_id = $1", [productId]);
  const creds = await credentials(tx, productId);
  if (!s || !creds) return { skipped: "App Store Connect is not connected" };
  try {
    const requestId = s.request_id ?? (await deps.ensureRequest(creds, s.app_apple_id));
    const report = await deps.report(creds, requestId);
    if (!report) {
      await tx.query("update app_store_sync set request_id = $2, last_synced_at = now(), last_error = null where product_id = $1", [productId, requestId]);
      return { imported: 0, note: "Apple has not made the downloads report yet (the first one comes 1–2 days after connecting)." };
    }
    const instances = (await deps.instances(creds, report.id)).sort((a, b) => b.processingDate.localeCompare(a.processingDate));
    const known = new Map((await tx.query<{ instance_id: string; segments: number }>(
      "select instance_id, segments from app_store_instances where product_id = $1", [productId])).map((r) => [r.instance_id, r.segments]));
    let imported = 0;
    let rows = 0;
    for (const inst of instances.slice(0, 40)) {
      if (imported >= maxInstances) break;
      const segs = await deps.segments(creds, inst.id);
      if (known.get(inst.id) === segs.length) continue;
      const data: Array<Record<string, string>> = [];
      for (const seg of segs) data.push(...(await deps.read(seg.url)));
      const mine = data.filter((r) => !r["App Apple Identifier"] || r["App Apple Identifier"] === s.app_apple_id);
      await tx.query(
        `insert into app_store_instances (instance_id, workspace_id, product_id, processing_date, segments, rows) values ($1,$2,$3,$4,$5,$6)
         on conflict (instance_id) do update set segments = excluded.segments, rows = excluded.rows, imported_at = now()`,
        [inst.id, s.workspace_id, productId, inst.processingDate, segs.length, mine.length],
      );
      await tx.query("delete from app_store_downloads where instance_id = $1", [inst.id]);
      for (let i = 0; i < mine.length; i += 500) {
        const chunk = mine.slice(i, i + 500);
        const vals: unknown[] = [];
        const ph = chunk.map((r, j) => {
          vals.push(s.workspace_id, productId, inst.id, r["Date"] || inst.processingDate, r["Download Type"] ?? "", r["Source Type"] ?? "", r["Source Info"] ?? "",
            r["Campaign"] ?? "", r["Page Type"] ?? "", r["Territory"] ?? "", r["Device"] ?? "", num(r["Counts"]));
          const b = j * 12;
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12})`;
        });
        await tx.query(
          `insert into app_store_downloads (workspace_id, product_id, instance_id, day, download_type, source_type, source_info, campaign, page_type, territory, device, counts) values ${ph.join(",")}`,
          vals,
        );
      }
      imported++;
      rows += mine.length;
    }
    await tx.query(
      `update app_store_sync set request_id = $2, report_name = $3, last_synced_at = now(), last_error = null,
              last_data_date = (select max(day) from app_store_downloads where product_id = $1) where product_id = $1`,
      [productId, requestId, report.name],
    );
    return { imported, rows };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    await tx.query("update app_store_sync set last_synced_at = now(), last_error = $2 where product_id = $1", [productId, msg]);
    return { error: msg };
  }
}

export interface AppStoreSummary {
  connected: boolean;
  sync: { app_name: string | null; app_apple_id: string; report_name: string | null; last_synced_at: string | null; last_data_date: string | null; last_error: string | null } | null;
  total: number;
  byCampaign: Array<{ campaign: string; downloads: number }>;
  bySource: Array<{ source: string; downloads: number }>;
  byDay: Array<{ day: string; downloads: number }>;
  byTerritory: Array<{ territory: string; downloads: number }>;
}

/** First-time downloads over the last `days` days, by campaign token, by source, by day and by country. */
export async function appStoreSummary(tx: Tx, productId: string, days = 30): Promise<AppStoreSummary> {
  const connected = Boolean(await tx.maybeOne("select 1 from channel_connections where product_id = $1 and channel = 'app_store' and status = 'connected'", [productId]));
  const sync = await tx.maybeOne<AppStoreSummary["sync"] & object>(
    "select app_name, app_apple_id, report_name, last_synced_at::text, last_data_date::text, last_error from app_store_sync where product_id = $1", [productId]);
  const where = `product_id = $1 and day > current_date - $2::int and download_type ilike 'first%'`;
  const q = <T extends QueryResultRow>(sql: string) => tx.query<T>(sql, [productId, days]);
  const t = await q<{ n: number }>(`select coalesce(sum(counts), 0)::int n from app_store_downloads where ${where}`);
  const byCampaign = await q<{ campaign: string; downloads: number }>(`select coalesce(nullif(campaign, ''), '(no campaign)') campaign, sum(counts)::int downloads from app_store_downloads where ${where} group by 1 order by 2 desc limit 20`);
  const bySource = await q<{ source: string; downloads: number }>(`select coalesce(nullif(source_type, ''), 'Unknown') || coalesce(' · ' || nullif(source_info, ''), '') source, sum(counts)::int downloads from app_store_downloads where ${where} group by 1 order by 2 desc limit 20`);
  const byDay = await q<{ day: string; downloads: number }>(`select day::text, sum(counts)::int downloads from app_store_downloads where ${where} group by 1 order by 1 desc`);
  const byTerritory = await q<{ territory: string; downloads: number }>(`select coalesce(nullif(territory, ''), 'Unknown') territory, sum(counts)::int downloads from app_store_downloads where ${where} group by 1 order by 2 desc limit 10`);

  return { connected, sync, total: t[0]?.n ?? 0, byCampaign, bySource, byDay, byTerritory };
}
