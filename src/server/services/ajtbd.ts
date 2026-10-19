import { z } from "zod";
import type { Tx } from "@/server/db/client";

/** Job grammar check (AJTBD): "want + verb". A soft check that explains, never blocks. */
export function jobGrammarHint(statement: string): string | null {
  const s = statement.trim().toLowerCase();
  if (/^(i\s+)?want\s+to\s+\p{L}+/u.test(s) || /^(я\s+)?хочу\s+\p{L}+/u.test(s)) {
    if (/\b(and|и)\b/u.test(s)) return "This may contain two Jobs (it has “and”). One verb = one Job.";
    return null;
  }
  return "Write the Job as “want to + verb (+ object)”, e.g. “want to calm my breathing in a crowded place”.";
}

export const criterionLineSchema = z.object({ criterion: z.string().min(1), direction: z.string(), threshold: z.string().nullable() });

/** Parses "criterion | direction | threshold" lines into an ordered list. */
export function parseCriteriaLines(lines: string[]) {
  return lines.map((l) => {
    const [criterion = "", direction = "", threshold = ""] = l.split("|").map((x) => x.trim());
    return criterionLineSchema.parse({ criterion, direction, threshold: threshold || null });
  });
}

export async function ensureDraftCodebook(tx: Tx, workspaceId: string, productId: string) {
  const current = await tx.maybeOne<{ id: string; version: number; status: string }>(
    "select id, version, status from codebook_versions where product_id = $1 order by version desc limit 1",
    [productId],
  );
  if (current && current.status === "draft") return current;
  const version = (current?.version ?? 0) + 1;
  const created = await tx.one<{ id: string; version: number; status: string }>(
    "insert into codebook_versions (workspace_id, product_id, version) values ($1,$2,$3) returning id, version, status",
    [workspaceId, productId, version],
  );
  // Carry forward definitions from the previous version so a new draft starts from the current map.
  if (current) {
    await tx.query(
      `insert into segment_definitions (workspace_id, product_id, segment_id, codebook_version_id, core_job, criteria_order, distinguishing, inclusion_rules, exclusion_rules, status, status_target)
       select workspace_id, product_id, segment_id, $2, core_job, criteria_order, distinguishing, inclusion_rules, exclusion_rules, status, status_target
         from segment_definitions where codebook_version_id = $1`,
      [current.id, created.id],
    );
  }
  return created;
}

export async function codebookState(tx: Tx, productId: string) {
  return tx.query<{ id: string; version: number; status: string; approved_at: string | null; changelog: string; segments: number }>(
    `select v.id, v.version, v.status, v.approved_at::text, v.changelog,
            (select count(*)::int from segment_definitions d where d.codebook_version_id = v.id) segments
       from codebook_versions v where v.product_id = $1 order by v.version desc`,
    [productId],
  );
}

export async function listSegments(tx: Tx, productId: string) {
  return tx.query<{
    id: string; code: string; name: string; confidence_status: string; status: string; audience: string | null;
    core_job: string | null; criteria_order: Array<{ criterion: string; direction: string; threshold: string | null }> | null; codebook_version: number | null;
    jobs: number; fears: number; barriers: number;
  }>(
    `select s.id, s.code, s.name, s.confidence_status, s.status, a.name audience, d.core_job, d.criteria_order, v.version codebook_version,
            (select count(*)::int from jobs j where j.segment_id = s.id) jobs,
            (select count(*)::int from fears f where f.segment_id = s.id) fears,
            (select count(*)::int from barriers b where b.segment_id = s.id) barriers
       from segments s
       left join audiences a on a.id = s.audience_id
       left join lateral (
         select d.* from segment_definitions d join codebook_versions v2 on v2.id = d.codebook_version_id
          where d.segment_id = s.id order by v2.version desc limit 1) d on true
       left join codebook_versions v on v.id = d.codebook_version_id
      where s.product_id = $1 order by s.code`,
    [productId],
  );
}

export async function listJobs(tx: Tx, productId: string) {
  return tx.query<{ id: string; level: string; job_type: string; statement: string; evidence_level: string; segment_code: string | null; parent: string | null; quote: string | null; criteria: number }>(
    `select j.id, j.level, j.job_type, j.statement, j.evidence_level, s.code segment_code, p.statement parent, q.text_verbatim quote,
            (select count(*)::int from success_criteria c where c.job_id = j.id) criteria
       from jobs j left join segments s on s.id = j.segment_id left join jobs p on p.id = j.parent_job_id left join client_quotes q on q.id = j.quote_id
      where j.product_id = $1 order by case j.level when 'super_big' then 0 when 'big' then 1 when 'core' then 2 when 'small' then 3 else 4 end, j.created_at`,
    [productId],
  );
}

export async function listFears(tx: Tx, productId: string) {
  return tx.query<{ id: string; fear: string; about_way: string; class: string | null; reducible_by_communication: boolean | null; proof_available: string; segment_code: string | null; quote: string | null }>(
    `select f.id, f.fear, f.about_way, f.class, f.reducible_by_communication, f.proof_available, s.code segment_code, q.text_verbatim quote
       from fears f left join segments s on s.id = f.segment_id left join client_quotes q on q.id = f.quote_id where f.product_id = $1 order by f.created_at`,
    [productId],
  );
}

export async function listBarriers(tx: Tx, productId: string) {
  return tx.query<{ id: string; barrier: string; class: string | null; chain_node: string; owner: string | null; removal_mechanic: string | null; segment_code: string | null; quote: string | null }>(
    `select b.id, b.barrier, b.class, b.chain_node, b.owner, b.removal_mechanic, s.code segment_code, q.text_verbatim quote
       from barriers b left join segments s on s.id = b.segment_id left join client_quotes q on q.id = b.quote_id where b.product_id = $1 order by b.created_at`,
    [productId],
  );
}

export async function listQuotes(tx: Tx, productId: string) {
  return tx.query<{ id: string; text_verbatim: string; source_title: string | null; source_id: string | null; chunk_id: string | null; locator: Record<string, unknown> | null; speaker: string; created_at: string }>(
    `select q.id, q.text_verbatim, s.title source_title, s.id source_id, q.chunk_id, c.locator, q.speaker, q.created_at::text
       from client_quotes q left join knowledge_chunks c on c.id = q.chunk_id left join knowledge_sources s on s.id = c.source_id
      where q.product_id = $1 and not exists (select 1 from client_quotes n where n.supersedes_id = q.id)
      order by q.created_at desc`,
    [productId],
  );
}

/** Finds the chunk of a product source that contains the exact excerpt (quotes must be verbatim). */
export async function findChunkForExcerpt(tx: Tx, productId: string, sourceId: string, excerpt: string) {
  return tx.maybeOne<{ id: string }>(
    `select c.id from knowledge_chunks c join knowledge_sources s on s.id = c.source_id
      where s.id = $1 and s.product_id = $2 and s.scope = 'product' and strpos(c.content, $3) > 0 order by c.ordinal limit 1`,
    [sourceId, productId, excerpt],
  );
}

export async function segmentHistory(tx: Tx, productId: string, limit = 30) {
  return tx.query<{ occurred_at: string; actor_type: string; action: string; entity_type: string; summary: string }>(
    `select occurred_at::text, actor_type, action, entity_type,
            coalesce(after ->> 'code', after ->> 'core_job', after ->> 'name', before ->> 'code', after ->> 'status', '') summary
       from audit_logs where product_id = $1 and entity_type in ('segments', 'segment_definitions', 'codebook_versions', 'segment_assignments', 'segment_migrations')
      order by occurred_at desc limit $2`,
    [productId, limit],
  );
}
