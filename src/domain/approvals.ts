import { createHash } from "node:crypto";

/** Canonical JSON: object keys sorted recursively, so the same payload always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export interface ApprovalPayload {
  contentVersionId: string;
  versionHash: string;
  channel: string;
  format: string;
  destination: { account: string; method: "export" | "api" | "manual"; targetUrl?: string | null };
  text: string;
  utmUrl: string | null;
  media: string[];
}

/** Hash of exactly what would be sent and where. Any change requires a new approval. */
export function approvalHash(payload: ApprovalPayload): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}
