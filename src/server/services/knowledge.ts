import { createHash, createHmac } from "node:crypto";
import { unzipSync } from "fflate";
import type { Tx } from "@/server/db/client";
import { fileStore } from "@/server/storage";
import { embedTexts } from "@/server/ai";
import { chunkCsvRows, chunkJson, chunkMarkdown, chunkPlainText, chunkTranscript, estimateTokens, type Chunk } from "@/domain/knowledge/chunker";
import { parseCsv } from "@/domain/csv";
import { assignPseudonyms, collectNames, decodeZipName, parseCourseFile, pseudonymise, type ParsedCourseFile } from "@/domain/knowledge/course";
import { PLAYBOOK_SEED } from "@/domain/knowledge/playbook";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ACCEPTED = [".md", ".markdown", ".txt", ".json", ".csv"] as const;

export type SourceType = "doc" | "transcript" | "interview" | "call" | "note" | "report" | "creative" | "url" | "image" | "dataset" | "methodology";

export interface IngestInput {
  workspaceId: string;
  productId: string | null;
  scope: "product" | "workspace";
  sourceType: SourceType;
  title: string;
  author?: string | null;
  documentDate?: string | null;
  confidence: "low" | "medium" | "high";
  containsPersonalData: boolean;
  consentRecorded: boolean;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  provenance?: Record<string, unknown>;
  importBatchId?: string | null;
  /** Already-processed text (e.g. pseudonymised); when given, stored text is this, not the raw bytes. */
  textOverride?: string;
  chunkAs?: "markdown" | "transcript" | "text" | "json" | "csv";
}

export class IngestError extends Error {}

function extensionOf(name: string): string {
  const m = /\.[a-z0-9]+$/i.exec(name);
  return m ? m[0].toLowerCase() : "";
}

export function chunkFor(kind: NonNullable<IngestInput["chunkAs"]>, text: string): Chunk[] {
  switch (kind) {
    case "markdown":
      return chunkMarkdown(text);
    case "transcript":
      return chunkTranscript(text);
    case "json":
      return chunkJson(text);
    case "csv": {
      const { header, rows } = parseCsv(text);
      return chunkCsvRows(header, rows);
    }
    default:
      return chunkPlainText(text);
  }
}

function defaultChunking(filename: string): NonNullable<IngestInput["chunkAs"]> {
  const ext = extensionOf(filename);
  if (ext === ".md" || ext === ".markdown") return "markdown";
  if (ext === ".json") return "json";
  if (ext === ".csv") return "csv";
  return "text";
}

/** Stores the original file privately, then the parsed chunks and their embeddings, with full provenance. */
export async function ingestSource(tx: Tx, input: IngestInput): Promise<{ id: string; chunks: number; duplicate: boolean }> {
  const ext = extensionOf(input.filename);
  if (!ACCEPTED.includes(ext as (typeof ACCEPTED)[number])) {
    throw new IngestError(`${input.filename}: this build accepts ${ACCEPTED.join(", ")}. PDF, DOCX, URLs and images arrive in v0.2.`);
  }
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) throw new IngestError(`${input.filename} is larger than 5 MB.`);
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const dup = await tx.maybeOne<{ id: string }>("select id from knowledge_sources where workspace_id = $1 and sha256 = $2", [input.workspaceId, sha256]);
  if (dup) return { id: dup.id, chunks: 0, duplicate: true };

  let text = input.textOverride ?? new TextDecoder("utf-8", { fatal: false }).decode(input.bytes);
  text = text.replace(/^﻿/, "");
  let chunks: Chunk[];
  try {
    chunks = chunkFor(input.chunkAs ?? defaultChunking(input.filename), text);
  } catch (e) {
    throw new IngestError(`${input.filename} could not be parsed: ${(e as Error).message}`);
  }
  if (!chunks.length) throw new IngestError(`${input.filename} has no readable text.`);

  const key = `${input.workspaceId}/${input.productId ?? "workspace"}/${sha256}${ext}`;
  // Pseudonymised imports store the processed text, never the raw original with real names.
  const stored = input.textOverride !== undefined ? new TextEncoder().encode(input.textOverride) : input.bytes;
  await fileStore().put(key, stored, input.mimeType || "text/plain");

  const src = await tx.one<{ id: string }>(
    `insert into knowledge_sources (workspace_id, product_id, scope, source_type, title, original_filename, mime_type, storage_path, author,
       document_date, confidence, sha256, byte_size, contains_personal_data, consent_recorded, provenance, import_batch_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id`,
    [input.workspaceId, input.productId, input.scope, input.sourceType, input.title, input.filename, input.mimeType, key, input.author ?? null,
     input.documentDate || null, input.confidence, sha256, input.bytes.byteLength, input.containsPersonalData, input.consentRecorded,
     JSON.stringify(input.provenance ?? {}), input.importBatchId ?? null],
  );
  const ids: string[] = [];
  for (const c of chunks) {
    const r = await tx.one<{ id: string }>(
      "insert into knowledge_chunks (workspace_id, source_id, ordinal, content, locator, token_estimate) values ($1,$2,$3,$4,$5,$6) returning id",
      [input.workspaceId, src.id, c.ordinal, c.content, JSON.stringify(c.locator), estimateTokens(c.content)],
    );
    ids.push(r.id);
  }
  const emb = await embedTexts(chunks.map((c) => c.content));
  for (let i = 0; i < ids.length; i++) {
    await tx.query("insert into knowledge_embeddings (chunk_id, workspace_id, model, dims, embedding) values ($1,$2,$3,$4,$5)", [
      ids[i], input.workspaceId, emb.model, emb.dims, `[${emb.vectors[i].join(",")}]`,
    ]);
  }
  return { id: src.id, chunks: chunks.length, duplicate: false };
}

export interface SearchHit {
  chunk_id: string;
  source_id: string;
  title: string;
  scope: "product" | "workspace";
  source_type: string;
  content: string;
  locator: Record<string, unknown>;
  score: number;
}

/**
 * Hybrid search: full-text rank and vector similarity merged by reciprocal rank fusion.
 * Product evidence of the selected product plus (optionally) workspace methodology; never another product.
 */
export async function searchKnowledge(tx: Tx, opts: { workspaceId: string; productId: string; query: string; includeMethodology: boolean; limit?: number; scope?: "all" | "product" | "workspace" }): Promise<SearchHit[]> {
  const q = opts.query.trim();
  if (!q) return [];
  const emb = await embedTexts([q]);
  const scopeFilter =
    opts.scope === "workspace" ? "s.scope = 'workspace'"
    : opts.scope === "product" ? "s.product_id = $2"
    : opts.includeMethodology ? "(s.product_id = $2 or s.scope = 'workspace')" : "s.product_id = $2";
  return tx.query<SearchHit>(
    `with candidates as (
       select c.id, c.source_id, c.content, c.locator, s.title, s.scope, s.source_type,
              ts_rank(c.fts, websearch_to_tsquery('simple', $3)) as fts_rank,
              (select 1 - (e.embedding <=> $4::vector) from knowledge_embeddings e where e.chunk_id = c.id and e.model = $5) as sim
         from knowledge_chunks c join knowledge_sources s on s.id = c.source_id
        where s.workspace_id = $1 and s.status = 'ready' and ${scopeFilter}
     ),
     ranked as (
       select *, row_number() over (order by fts_rank desc) as r_fts, row_number() over (order by sim desc nulls last) as r_vec from candidates
     )
     select id as chunk_id, source_id, title, scope, source_type, content, locator,
            (case when fts_rank > 0 then 1.0 / (60 + r_fts) else 0 end) + (1.0 / (60 + r_vec)) as score
       from ranked
      order by score desc
      limit $6`,
    [opts.workspaceId, opts.productId, q, `[${emb.vectors[0].join(",")}]`, emb.model, opts.limit ?? 12],
  );
}

export async function listSources(tx: Tx, workspaceId: string, productId: string) {
  return tx.query<{
    id: string; title: string; scope: string; source_type: string; author: string | null; document_date: string | null; confidence: string;
    original_filename: string | null; imported_at: string; chunks: number; contains_personal_data: boolean; provenance: Record<string, unknown>;
  }>(
    `select s.id, s.title, s.scope, s.source_type, s.author, s.document_date::text, s.confidence, s.original_filename, s.imported_at::text,
            s.contains_personal_data, s.provenance, (select count(*)::int from knowledge_chunks c where c.source_id = s.id) chunks
       from knowledge_sources s
      where s.workspace_id = $1 and (s.product_id = $2 or s.scope = 'workspace') and s.status <> 'archived'
      order by s.scope desc, s.imported_at desc, s.title`,
    [workspaceId, productId],
  );
}

// ---------------------------------------------------------------------------
// Course methodology import
// ---------------------------------------------------------------------------

function pseudonymKey(): string {
  const base = process.env.ENCRYPTION_KEY_V1;
  if (!base) throw new Error("ENCRYPTION_KEY_V1 is required to pseudonymise course participants");
  return createHmac("sha256", Buffer.from(base, "base64")).update("course-pseudonyms").digest("hex");
}

export interface CourseImportResult {
  batchId: string;
  imported: number;
  duplicates: number;
  skipped: Array<{ path: string; reason: string }>;
  participantsPseudonymised: number;
  playbookRules: number;
}

/** Reads a course vault zip (or loose files) and imports every text file as workspace methodology. */
export function readCourseFiles(input: { zip?: Uint8Array; files?: Array<{ name: string; bytes: Uint8Array }> }): Array<{ path: string; bytes: Uint8Array }> {
  const out: Array<{ path: string; bytes: Uint8Array }> = [];
  if (input.zip) {
    const entries = unzipSync(input.zip);
    for (const [name, bytes] of Object.entries(entries)) {
      if (name.endsWith("/") || name.startsWith("__MACOSX") || /(^|\/)\./.test(name)) continue;
      const decoded = decodeZipName(name).replace(/^[^/]*Vault\//, "");
      out.push({ path: decoded, bytes });
    }
  }
  for (const f of input.files ?? []) out.push({ path: f.name, bytes: f.bytes });
  return out;
}

export async function importCourse(tx: Tx, workspaceId: string, files: Array<{ path: string; bytes: Uint8Array }>): Promise<CourseImportResult> {
  const batch = await tx.one<{ id: string }>(
    "insert into import_batches (workspace_id, kind, source_label) values ($1, 'course_methodology', 'AI Mindset Marketing Sprint + AJTBD') returning id",
    [workspaceId],
  );
  const parsed: ParsedCourseFile[] = [];
  const skipped: CourseImportResult["skipped"] = [];
  for (const f of files) {
    const text = f.path.toLowerCase().endsWith(".pdf") ? "" : new TextDecoder().decode(f.bytes);
    const p = parseCourseFile(f.path, text);
    if (p.kind === "pdf") skipped.push({ path: f.path, reason: "PDF parsing arrives in v0.2" });
    else if (p.kind === "other") skipped.push({ path: f.path, reason: "Unsupported file type" });
    else parsed.push(p);
  }

  // Pseudonymise participants consistently across all files; keep speakers and course staff named.
  const names = collectNames(parsed);
  const secret = pseudonymKey();
  const existing = new Map(
    (await tx.query<{ name_hmac: string; pseudonym: string }>("select name_hmac, pseudonym from pseudonyms where workspace_id = $1", [workspaceId])).map((r) => [r.name_hmac, r.pseudonym]),
  );
  const assigned = assignPseudonyms(secret, names.participants, existing);
  for (const { hmac, pseudonym } of assigned.values()) {
    await tx.query("insert into pseudonyms (workspace_id, name_hmac, pseudonym) values ($1,$2,$3) on conflict do nothing", [workspaceId, hmac, pseudonym]);
  }
  const map = new Map([...assigned].map(([n, v]) => [n, v.pseudonym]));

  let imported = 0;
  let duplicates = 0;
  for (const p of parsed) {
    const clean = pseudonymise(p.text, map);
    const isJson = p.path.toLowerCase().endsWith(".json");
    const filename = p.path.split("/").pop() ?? p.path;
    try {
      const r = await ingestSource(tx, {
        workspaceId,
        productId: null,
        scope: "workspace",
        sourceType: "methodology",
        title: p.title,
        author: p.author,
        documentDate: p.date,
        confidence: p.kind === "chat" ? "low" : p.kind === "transcript" ? "medium" : "high",
        containsPersonalData: p.kind === "chat" || p.kind === "transcript" || p.kind === "card",
        consentRecorded: false,
        filename: isJson ? filename : filename.replace(/\.(md|markdown)$/i, "") + ".md",
        mimeType: isJson ? "application/json" : "text/markdown",
        bytes: new TextEncoder().encode(clean),
        textOverride: clean,
        chunkAs: isJson ? "json" : p.kind === "transcript" ? "transcript" : p.kind === "chat" ? "text" : "markdown",
        importBatchId: batch.id,
        provenance: {
          origin: p.kind === "ajtbd" ? "AJTBD pipeline files (course materials)" : "AI Mindset Marketing Sprint vault (export 2026-10-15)",
          path: p.path,
          kind: p.kind,
          section: p.section,
          session_id: p.sessionId,
          speakers: p.speakers,
          pseudonymised: true,
        },
      });
      if (r.duplicate) duplicates++;
      else imported++;
    } catch (e) {
      skipped.push({ path: p.path, reason: (e as Error).message });
    }
  }
  const playbookRules = await seedPlaybook(tx, workspaceId);
  await tx.query("update import_batches set status = 'completed', stats = $2 where id = $1", [
    batch.id,
    JSON.stringify({ imported, duplicates, skipped: skipped.length, participants: map.size, playbookRules }),
  ]);
  return { batchId: batch.id, imported, duplicates, skipped, participantsPseudonymised: map.size, playbookRules };
}

/** Creates Playbook v1 rules (status: proposed) with citations found in the imported methodology. */
export async function seedPlaybook(tx: Tx, workspaceId: string): Promise<number> {
  let created = 0;
  for (const rule of PLAYBOOK_SEED) {
    const exists = await tx.maybeOne<{ id: string }>("select id from playbook_rules where workspace_id = $1 and code = $2", [workspaceId, rule.code]);
    if (exists) continue;
    const r = await tx.one<{ id: string }>(
      "insert into playbook_rules (workspace_id, code, kind, area, title, statement) values ($1,$2,$3,$4,$5,$6) returning id",
      [workspaceId, rule.code, rule.kind, rule.area, rule.title, rule.statement],
    );
    created++;
    for (const phrase of rule.cite) {
      const hit = await tx.maybeOne<{ id: string }>(
        `select c.id from knowledge_chunks c join knowledge_sources s on s.id = c.source_id
          where s.workspace_id = $1 and s.scope = 'workspace' and position(lower($2) in lower(replace(c.content, '**', ''))) > 0
          order by s.imported_at, c.ordinal limit 1`,
        [workspaceId, phrase],
      );
      if (hit) {
        await tx.query("insert into playbook_rule_sources (rule_id, workspace_id, chunk_id, note) values ($1,$2,$3,$4) on conflict do nothing", [r.id, workspaceId, hit.id, `Matched: “${phrase}”`]);
      }
    }
  }
  return created;
}

export async function listPlaybook(tx: Tx, workspaceId: string, productId: string) {
  return tx.query<{
    id: string; code: string; kind: string; area: string; title: string; statement: string; status: string;
    applicability: string | null; citations: Array<{ chunk_id: string; source_id: string; title: string; locator: Record<string, unknown> }>;
  }>(
    `select r.id, r.code, r.kind, r.area, r.title, r.statement, r.status, o.applicability,
            coalesce((select json_agg(json_build_object('chunk_id', c.id, 'source_id', s.id, 'title', s.title, 'locator', c.locator))
                        from playbook_rule_sources rs join knowledge_chunks c on c.id = rs.chunk_id join knowledge_sources s on s.id = c.source_id
                       where rs.rule_id = r.id), '[]') citations
       from playbook_rules r left join product_rule_overrides o on o.rule_id = r.id and o.product_id = $2
      where r.workspace_id = $1 and r.status <> 'retired'
      order by r.area, r.code`,
    [workspaceId, productId],
  );
}
