"use server";

import { revalidatePath } from "next/cache";
import { db, getProduct } from "@/server/context";
import { describeDbError } from "@/server/db/client";
import {
  addManualMetrics, ADS_ALIASES, CONVERSION_ALIASES, importAdsCsv, importConversionsCsv, importMetricsCsv, METRIC_KEYS, proposeMapping, proposeMappingWith, revertBatch, type MetricKey,
} from "@/server/services/measurement";
import { parseCsv, parseNumber } from "@/domain/csv";
import { fail, ok, str, toFailure, type ActionResult } from "@/lib/action-result";
import type { CsvPreview, CsvPreviewResult } from "@/lib/csv-preview";

const MAX = 5 * 1024 * 1024;

async function readPreview(kind: CsvPreview["kind"], data: FormData, extra: Record<string, string>): Promise<CsvPreviewResult> {
  const file = data.get("file");
  if (!(file instanceof File) || !file.size) return { ok: false, message: "Choose a CSV file." };
  if (file.size > MAX) return { ok: false, message: "The file is larger than 5 MB." };
  const csv = await file.text();
  try {
    const { header, rows } = parseCsv(csv);
    if (!header.length || !rows.length) return { ok: false, message: "The file has no data rows." };
    const mapping =
      kind === "metrics" ? proposeMapping(header, ["post_url", "date", ...METRIC_KEYS])
      : kind === "conversions" ? proposeMappingWith(header, CONVERSION_ALIASES)
      : proposeMappingWith(header, ADS_ALIASES);
    return { ok: true, message: "", preview: { kind, header, sample: rows.slice(0, 5), rows: rows.length, mapping, csv, extra } };
  } catch (e) {
    return { ok: false, message: `The CSV could not be read: ${(e as Error).message}` };
  }
}

function mappingFrom(data: FormData): Record<string, string> {
  const m: Record<string, string> = {};
  for (const [k, v] of data.entries()) if (k.startsWith("map:") && v) m[k.slice(4)] = String(v);
  return m;
}

function summary(r: { imported: number; skipped: Array<{ row: number; reason: string }> }, unit: string, extra = ""): string {
  const skipped = r.skipped.length ? ` Skipped ${r.skipped.length}: ${r.skipped.slice(0, 3).map((s) => `row ${s.row} (${s.reason})`).join("; ")}${r.skipped.length > 3 ? "…" : ""}` : "";
  return `Imported ${r.imported} ${unit}.${extra}${skipped}`;
}

export async function previewMetricsAction(_: CsvPreviewResult | null, data: FormData) {
  return readPreview("metrics", data, {});
}
export async function previewConversionsAction(_: CsvPreviewResult | null, data: FormData) {
  return readPreview("conversions", data, {});
}
export async function previewAdsAction(_: CsvPreviewResult | null, data: FormData) {
  return readPreview("ads", data, { platform: str(data.get("platform")), account_id: str(data.get("account_id")) });
}

export async function commitMetricsAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const r = await db((tx, ctx) => importMetricsCsv(tx, ctx.workspaceId, product.id, String(data.get("csv") ?? ""), mappingFrom(data), "Metrics CSV"), { reason: "metrics CSV import" });
    revalidatePath(`/p/${slug}`, "layout");
    return ok(summary(r, "metric values"));
  } catch (e) {
    return toFailure(e, (x) => (x instanceof Error && !("code" in x) ? x.message : describeDbError(x)));
  }
}

export async function commitConversionsAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const r = await db((tx, ctx) => importConversionsCsv(tx, ctx.workspaceId, product.id, String(data.get("csv") ?? ""), mappingFrom(data), "Conversions CSV"), { reason: "conversions CSV import" });
    revalidatePath(`/p/${slug}`, "layout");
    return ok(summary(r, "conversions", ` ${r.matched} matched to a tracking link; unmatched ones count in totals but not per post.`));
  } catch (e) {
    return toFailure(e, (x) => (x instanceof Error && !("code" in x) ? x.message : describeDbError(x)));
  }
}

export async function commitAdsAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const platform = str(data.get("platform")) as "meta_ads" | "google_ads";
    if (!["meta_ads", "google_ads"].includes(platform)) return fail("Choose Meta Ads or Google Ads.");
    const r = await db((tx, ctx) => importAdsCsv(tx, ctx.workspaceId, product.id, platform, str(data.get("account_id")), String(data.get("csv") ?? ""), mappingFrom(data), `${platform} report`), { reason: "ads report import" });
    revalidatePath(`/p/${slug}`, "layout");
    return ok(summary(r, "daily ad rows"));
  } catch (e) {
    return toFailure(e, (x) => (x instanceof Error && !("code" in x) ? x.message : describeDbError(x)));
  }
}

export async function manualMetricsAction(slug: string, publicationId: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const values: Partial<Record<MetricKey, number>> = {};
    for (const k of METRIC_KEYS) {
      const n = parseNumber(str(data.get(k)));
      if (n !== null) {
        if (n < 0) return fail(`${k} cannot be negative.`);
        values[k] = n;
      }
    }
    if (!Object.keys(values).length) return fail("Enter at least one number.");
    const raw = str(data.get("observed_at"));
    const at = raw ? new Date(raw) : new Date();
    const n = await db((tx, ctx) => addManualMetrics(tx, ctx.workspaceId, product.id, publicationId, at, values), { reason: "manual metrics" });
    revalidatePath(`/p/${slug}`, "layout");
    return ok(`Saved ${n} values.`);
  } catch (e) {
    return toFailure(e, describeDbError);
  }
}

export async function revertBatchAction(slug: string, batchId: string) {
  const product = await getProduct(slug);
  await db((tx) => revertBatch(tx, product.id, batchId), { reason: "import reverted" });
  revalidatePath(`/p/${slug}`, "layout");
}

export async function addSpendAction(slug: string, _: ActionResult | null, data: FormData): Promise<ActionResult> {
  try {
    const product = await getProduct(slug);
    const amount = parseNumber(str(data.get("amount")));
    if (amount === null || amount < 0) return fail("Enter the amount spent.");
    await db((tx, ctx) =>
      tx.query("insert into spend_entries (workspace_id, product_id, day, amount, currency, kind, note) values ($1,$2,$3,$4,$5,$6,$7)", [
        ctx.workspaceId, product.id, str(data.get("day")) || new Date().toISOString().slice(0, 10), amount, str(data.get("currency")) || "EUR", str(data.get("kind")) || "ad_spend", str(data.get("note")),
      ]),
    );
    revalidatePath(`/p/${slug}`, "layout");
    return ok("Spend recorded.");
  } catch (e) {
    return toFailure(e, describeDbError);
  }
}
