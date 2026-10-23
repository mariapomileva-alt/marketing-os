import type { Tx } from "@/server/db/client";
import { resolveProvider } from "@/server/ai";
import { PROMPTS } from "@/domain/ai/prompts";
import { contentOutputSchema, hooksOutputSchema, reviewOutputSchema, type ContentBody } from "@/domain/ai/schemas";
import { BudgetExceededError, type AiTask } from "@/domain/ai/types";
import { checkText, outcomeOf, type GuardrailRule } from "@/domain/guardrails";
import { approvalHash, type ApprovalPayload } from "@/domain/approvals";
import { defaultPrimaryMetric, diffBodies, publishableText, renderText, withUtm } from "@/domain/content";
import { buildUtmLink, DEFAULT_UTM } from "@/domain/utm";
import { allowedHosts } from "./products";
import type { z } from "zod";

export interface Actor {
  workspaceId: string;
  userId: string;
}

// ---------------------------------------------------------------------------
// Prompt versions and AI runs
// ---------------------------------------------------------------------------
async function promptVersion(tx: Tx, workspaceId: string, key: string) {
  const seed = PROMPTS.find((p) => p.key === key);
  if (!seed) throw new Error(`Unknown prompt ${key}`);
  const existing = await tx.maybeOne<{ id: string; system_prompt: string }>(
    `select v.id, v.system_prompt from prompt_template_versions v join prompt_templates t on t.id = v.template_id
      where t.workspace_id = $1 and t.key = $2 order by v.version desc limit 1`,
    [workspaceId, key],
  );
  if (existing) return existing;
  const t = await tx.one<{ id: string }>("insert into prompt_templates (workspace_id, key, role, description) values ($1,$2,$3,$4) returning id", [workspaceId, key, seed.role, `Seeded ${key}`]);
  return tx.one<{ id: string; system_prompt: string }>(
    "insert into prompt_template_versions (workspace_id, template_id, version, system_prompt, output_schema_name, change_note) values ($1,$2,$3,$4,$5,'Initial version') returning id, system_prompt",
    [workspaceId, t.id, seed.version, seed.system, seed.outputSchema],
  );
}

async function checkBudget(tx: Tx, workspaceId: string) {
  const r = await tx.one<{ spent: string; cap: string }>(
    `select coalesce(sum(cost_usd), 0)::text spent,
            coalesce((select ai_daily_budget_usd from workspace_settings where workspace_id = $1), 5)::text cap
       from agent_runs where workspace_id = $1 and created_at > now() - interval '1 day'`,
    [workspaceId],
  );
  if (Number(r.spent) >= Number(r.cap)) throw new BudgetExceededError(`Daily AI budget reached (${r.spent} of ${r.cap} USD). Raise it in Settings or try tomorrow.`);
}

interface RunArgs<T> {
  actor: Actor;
  productId: string;
  workflowRunId: string;
  step: string;
  task: AiTask;
  promptKey: string;
  schema: z.ZodType<T>;
  input: Record<string, unknown>;
  sourceIds: string[];
}

/** Runs one model call and records it in agent_runs, success or failure (input, sources, prompt version, model, output, cost, duration). */
export async function runAgent<T>(tx: Tx, a: RunArgs<T>): Promise<{ output: T; agentRunId: string; isMock: boolean }> {
  await checkBudget(tx, a.actor.workspaceId);
  const pv = await promptVersion(tx, a.actor.workspaceId, a.promptKey);
  const provider = await resolveProvider(a.actor.workspaceId);
  const role = PROMPTS.find((p) => p.key === a.promptKey)!.role;
  const started = Date.now();
  try {
    const r = await provider.generate({ task: a.task, system: pv.system_prompt, input: JSON.stringify(a.input), schema: a.schema, context: a.input });
    const run = await tx.one<{ id: string }>(
      `insert into agent_runs (workspace_id, product_id, workflow_run_id, step, role, provider, model, is_mock, prompt_template_version_id,
         input_snapshot, source_ids, output, raw_output, input_tokens, output_tokens, cost_usd, duration_ms)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id`,
      [a.actor.workspaceId, a.productId, a.workflowRunId, a.step, role, r.provider, r.model, r.isMock, pv.id, JSON.stringify(a.input), JSON.stringify(a.sourceIds),
       JSON.stringify(r.output), r.raw, r.usage.inputTokens, r.usage.outputTokens, r.costUsd, r.latencyMs],
    );
    await tx.query("update workflow_runs set total_cost_usd = total_cost_usd + $2, current_step = $3 where id = $1", [a.workflowRunId, r.costUsd ?? 0, a.step]);
    return { output: r.output, agentRunId: run.id, isMock: r.isMock };
  } catch (e) {
    await tx.query(
      `insert into agent_runs (workspace_id, product_id, workflow_run_id, step, role, provider, model, is_mock, prompt_template_version_id, input_snapshot, source_ids, duration_ms, error)
       values ($1,$2,$3,$4,$5,$6,'unknown',$7,$8,$9,$10,$11,$12)`,
      [a.actor.workspaceId, a.productId, a.workflowRunId, a.step, role, provider.id, provider.isMock, pv.id, JSON.stringify(a.input), JSON.stringify(a.sourceIds), Date.now() - started, (e as Error).message],
    );
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Ideas and hooks
// ---------------------------------------------------------------------------
export interface IdeaInput {
  title: string;
  insight: string;
  audienceId: string | null;
  segmentId: string | null;
  jobId: string | null;
  fearId: string | null;
  quoteId: string | null;
  signalId: string | null;
  topic: string;
  funnelStage: string | null;
  sourceIds: string[];
}

export async function createIdea(tx: Tx, actor: Actor, productId: string, i: IdeaInput) {
  let topicId: string | null = null;
  if (i.topic) {
    topicId = (await tx.one<{ id: string }>(
      `insert into taxonomy_terms (workspace_id, product_id, vocabulary, label) values ($1,$2,'topic',$3)
       on conflict (product_id, vocabulary, label) do update set archived = false returning id`,
      [actor.workspaceId, productId, i.topic],
    )).id;
  }
  const idea = await tx.one<{ id: string }>(
    `insert into ideas (workspace_id, product_id, title, insight, audience_id, segment_id, job_id, fear_id, quote_id, signal_id, topic_term_id, funnel_stage)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [actor.workspaceId, productId, i.title, i.insight, i.audienceId, i.segmentId, i.jobId, i.fearId, i.quoteId, i.signalId, topicId, i.funnelStage],
  );
  for (const s of i.sourceIds) await tx.query("insert into idea_sources (idea_id, workspace_id, source_id) values ($1,$2,$3)", [idea.id, actor.workspaceId, s]);
  return idea;
}

/** Everything the AI is allowed to know for an idea: product facts, rules, segment, Job, fears, quotes, sources, approved playbook. */
export async function ideaContext(tx: Tx, productId: string, ideaId: string) {
  const idea = await tx.one<{
    id: string; title: string; insight: string; funnel_stage: string | null; product_name: string; segment_code: string | null; segment_name: string | null;
    core_job: string | null; criteria: unknown; job: string | null; fear: string | null; quote: string | null; quote_id: string | null; topic: string | null; signal_hook: string | null; signal_angle: string | null;
  }>(
    `select i.id, i.title, i.insight, i.funnel_stage, p.name product_name, s.code segment_code, s.name segment_name, d.core_job, d.criteria_order criteria,
            j.statement job, f.fear, q.text_verbatim quote, q.id quote_id, t.label topic, sg.hook signal_hook, sg.angle signal_angle
       from ideas i join products p on p.id = i.product_id
       left join segments s on s.id = i.segment_id
       left join lateral (select d.core_job, d.criteria_order from segment_definitions d join codebook_versions v on v.id = d.codebook_version_id where d.segment_id = s.id order by v.version desc limit 1) d on true
       left join jobs j on j.id = i.job_id left join fears f on f.id = i.fear_id left join client_quotes q on q.id = i.quote_id
       left join taxonomy_terms t on t.id = i.topic_term_id left join signals sg on sg.id = i.signal_id
      where i.id = $1 and i.product_id = $2`,
    [ideaId, productId],
  );
  const sources = await tx.query<{ id: string; title: string; scope: string }>(
    "select s.id, s.title, s.scope from idea_sources x join knowledge_sources s on s.id = x.source_id where x.idea_id = $1",
    [ideaId],
  );
  const facts = await tx.query<{ statement: string }>("select statement from product_claims where product_id = $1 and kind = 'approved_fact' and not archived", [productId]);
  const prohibited = await tx.query<{ statement: string }>("select statement from product_claims where product_id = $1 and kind = 'prohibited_claim' and not archived", [productId]);
  const rules = await tx.query<{ code: string; rationale: string; instruction: string }>("select code, rationale, instruction from product_guardrails where product_id = $1 and active", [productId]);
  const brand = await tx.maybeOne<{ tone_of_voice: string }>("select tone_of_voice from brand_profiles where product_id = $1", [productId]);
  const playbook = await tx.query<{ code: string; statement: string }>(
    `select r.code, r.statement from playbook_rules r join products p on p.workspace_id = r.workspace_id and p.id = $1
      where r.status = 'approved' and not exists (select 1 from product_rule_overrides o where o.rule_id = r.id and o.product_id = $1 and o.applicability = 'not_applicable')`,
    [productId],
  );
  return { idea, sources, facts: facts.map((f) => f.statement), prohibited: prohibited.map((p) => p.statement), rules, tone: brand?.tone_of_voice ?? "", playbook };
}

export async function startWorkflow(tx: Tx, actor: Actor, productId: string, ideaId: string, input: Record<string, unknown>) {
  return tx.one<{ id: string }>("insert into workflow_runs (workspace_id, product_id, idea_id, input, status) values ($1,$2,$3,$4,'running') returning id", [
    actor.workspaceId, productId, ideaId, JSON.stringify(input),
  ]);
}

export async function generateHooks(tx: Tx, actor: Actor, productId: string, ideaId: string, count = 3) {
  const ctx = await ideaContext(tx, productId, ideaId);
  const wf = await startWorkflow(tx, actor, productId, ideaId, { step: "hooks", count });
  const input = {
    productName: ctx.idea.product_name,
    idea: ctx.idea.title,
    insight: ctx.idea.insight,
    segmentName: ctx.idea.segment_name ? `${ctx.idea.segment_code} ${ctx.idea.segment_name}` : null,
    coreJob: ctx.idea.core_job,
    criteria: ctx.idea.criteria,
    jobStatement: ctx.idea.job ?? ctx.idea.core_job,
    fears: ctx.idea.fear ? [ctx.idea.fear] : [],
    quotes: ctx.idea.quote ? [{ id: ctx.idea.quote_id, text: ctx.idea.quote }] : [],
    sources: ctx.sources.map((s) => ({ id: s.id, title: s.title })),
    productFacts: ctx.facts,
    prohibitedClaims: ctx.prohibited,
    productRules: ctx.rules.map((r) => r.rationale || r.instruction),
    tone: ctx.tone,
    playbook: ctx.playbook.map((p) => p.statement),
    count,
  };
  const r = await runAgent(tx, { actor, productId, workflowRunId: wf.id, step: "hooks", task: "hooks", promptKey: "hooks.v1", schema: hooksOutputSchema, input, sourceIds: ctx.sources.map((s) => s.id) });
  for (const v of r.output.variants) {
    await tx.query(
      "insert into hooks (workspace_id, product_id, idea_id, text, hook_type, rationale, origin, agent_run_id) values ($1,$2,$3,$4,$5,$6,'ai',$7)",
      [actor.workspaceId, productId, ideaId, v.hook, v.hook_type, JSON.stringify({ ...v.rationale, evidence_ids: v.evidence_ids, angle: v.angle_name }), r.agentRunId],
    );
    await tx.query(
      `insert into angles (workspace_id, product_id, idea_id, name, description, origin, agent_run_id) values ($1,$2,$3,$4,$5,'ai',$6)`,
      [actor.workspaceId, productId, ideaId, v.angle_name, v.angle_description, r.agentRunId],
    );
  }
  await tx.query("update workflow_runs set status = 'waiting_for_human', current_step = 'choose_hook' where id = $1", [wf.id]);
  return { workflowRunId: wf.id, count: r.output.variants.length, isMock: r.isMock };
}

// ---------------------------------------------------------------------------
// Content generation, editing and reviews
// ---------------------------------------------------------------------------
export interface GenerateContentInput {
  ideaId: string;
  hookId: string;
  channel: string;
  format: string;
  goal: string;
  language: string;
  ctaTermId: string | null;
  campaignId: string | null;
}

export async function generateContent(tx: Tx, actor: Actor, productId: string, g: GenerateContentInput) {
  const ctx = await ideaContext(tx, productId, g.ideaId);
  const hook = await tx.one<{ id: string; text: string; rationale: Record<string, unknown> }>("select id, text, rationale from hooks where id = $1 and product_id = $2", [g.hookId, productId]);
  const angle = await tx.maybeOne<{ id: string; name: string }>(
    "select id, name from angles where idea_id = $1 and product_id = $2 and name = $3 order by created_at desc limit 1",
    [g.ideaId, productId, String(hook.rationale?.angle ?? "")],
  );
  const cta = g.ctaTermId ? await tx.maybeOne<{ label: string }>("select label from taxonomy_terms where id = $1 and product_id = $2", [g.ctaTermId, productId]) : null;
  await tx.query("update hooks set status = 'chosen' where id = $1", [hook.id]);
  if (angle) await tx.query("update angles set status = 'chosen' where id = $1", [angle.id]);

  const wf = await startWorkflow(tx, actor, productId, g.ideaId, { step: "content", ...g });
  const input = {
    productName: ctx.idea.product_name,
    channel: g.channel,
    format: g.format,
    goal: g.goal,
    language: g.language,
    hook: hook.text,
    angle: angle?.name ?? null,
    cta: cta?.label ?? null,
    segmentName: ctx.idea.segment_name ? `${ctx.idea.segment_code} ${ctx.idea.segment_name}` : null,
    jobStatement: ctx.idea.job ?? ctx.idea.core_job,
    fears: ctx.idea.fear ? [ctx.idea.fear] : [],
    quotes: ctx.idea.quote ? [{ id: ctx.idea.quote_id, text: ctx.idea.quote }] : [],
    sources: ctx.sources.map((s) => ({ id: s.id, title: s.title })),
    productFacts: ctx.facts,
    prohibitedClaims: ctx.prohibited,
    tone: ctx.tone,
    playbook: ctx.playbook.map((p) => p.statement),
  };
  const r = await runAgent(tx, { actor, productId, workflowRunId: wf.id, step: "content", task: "content", promptKey: "content.v1", schema: contentOutputSchema, input, sourceIds: ctx.sources.map((s) => s.id) });

  const created: string[] = [];
  for (const v of r.output.variants) {
    const item = await tx.one<{ id: string }>(
      `insert into content_items (workspace_id, product_id, idea_id, campaign_id, channel, format, goal, funnel_stage, language, topic, cta_term_id, title)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [actor.workspaceId, productId, g.ideaId, g.campaignId, g.channel, g.format, g.goal, ctx.idea.funnel_stage ?? "", g.language, ctx.idea.topic ?? "", g.ctaTermId, `${ctx.idea.title}: ${v.label}`],
    );
    const evidence = [
      ...v.evidence_ids.map((id) => ({ kind: "source", id })),
      ...(ctx.idea.quote_id ? [{ kind: "quote", id: ctx.idea.quote_id }] : []),
    ];
    const ver = await tx.one<{ id: string }>(
      `insert into content_versions (workspace_id, product_id, content_item_id, version, body, visual_concept, hook_id, angle_id, rationale, evidence, author_type, agent_run_id)
       values ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,'ai',$10) returning id`,
      [actor.workspaceId, productId, item.id, JSON.stringify(v.body), v.visual_concept, hook.id, angle?.id ?? null, JSON.stringify(v.rationale), JSON.stringify(evidence), r.agentRunId],
    );
    await tx.query("update content_items set current_version_id = $1 where id = $2", [ver.id, item.id]);
    const snapshot = {
      product: ctx.idea.product_name,
      segment: ctx.idea.segment_code,
      job: ctx.idea.job ?? ctx.idea.core_job,
      insight_sources: ctx.sources.map((s) => s.title),
      quote: ctx.idea.quote,
      channel: g.channel,
      format: g.format,
      topic: ctx.idea.topic,
      angle: angle?.name ?? null,
      hook: hook.text,
      cta: cta?.label ?? null,
      visual_concept: v.visual_concept,
      funnel_stage: ctx.idea.funnel_stage,
      goal: g.goal,
      language: g.language,
      prompt: "content.v1",
      model: r.isMock ? "mock-1" : "provider",
    };
    await tx.query(
      "insert into experiments (workspace_id, product_id, content_item_id, dimensions_snapshot, hypothesis, primary_metric) values ($1,$2,$3,$4,$5,$6)",
      [actor.workspaceId, productId, item.id, JSON.stringify(snapshot), `${v.rationale.intended_outcome}`, defaultPrimaryMetric(g.goal)],
    );
    created.push(item.id);
  }
  await tx.query("update ideas set status = 'in_production' where id = $1", [g.ideaId]);
  await tx.query("update workflow_runs set status = 'waiting_for_human', current_step = 'review' where id = $1", [wf.id]);
  for (const id of created) await runReviews(tx, actor, productId, id, wf.id);
  return { itemIds: created, isMock: r.isMock };
}

export async function getItem(tx: Tx, productId: string, itemId: string) {
  return tx.maybeOne<{
    id: string; status: string; channel: string; format: string; goal: string; language: string; title: string; idea_id: string | null; scheduled_for: string | null;
    current_version_id: string; version: number; body: ContentBody; visual_concept: string; rationale: Record<string, unknown>; evidence: Array<{ kind: string; id: string }>;
    author_type: string; content_hash: string; hook: string | null; angle: string | null; cta: string | null; is_mock: boolean | null;
  }>(
    `select i.id, i.status, i.channel, i.format, i.goal, i.language, i.title, i.idea_id, i.scheduled_for::text, i.current_version_id, v.version, v.body, v.visual_concept,
            v.rationale, v.evidence, v.author_type, v.content_hash, h.text hook, a.name angle, t.label cta, ar.is_mock
       from content_items i join content_versions v on v.id = i.current_version_id
       left join hooks h on h.id = v.hook_id left join angles a on a.id = v.angle_id left join taxonomy_terms t on t.id = i.cta_term_id
       left join agent_runs ar on ar.id = v.agent_run_id
      where i.id = $1 and i.product_id = $2`,
    [itemId, productId],
  );
}

/** Guardrails (code) first, then AI brand and compliance reviews. Moves the item to "needs your review" or back to draft. */
export async function runReviews(tx: Tx, actor: Actor, productId: string, itemId: string, workflowRunId?: string) {
  const item = await getItem(tx, productId, itemId);
  if (!item) throw new Error("Content item not found");
  if (item.status === "draft") await tx.query("update content_items set status = 'ai_review' where id = $1", [itemId]);
  const rules = await tx.query<{ code: string; rule_type: GuardrailRule["ruleType"]; patterns: unknown; instruction: string; severity: "block" | "warn"; rationale: string; active: boolean }>(
    "select code, rule_type, patterns, instruction, severity, rationale, active from product_guardrails where product_id = $1",
    [productId],
  );
  const utm = await tx.maybeOne<{ full_url: string }>("select full_url from utm_links where content_item_id = $1 order by created_at desc limit 1", [itemId]);
  const text = withUtm(renderText(item.body, item.format), utm?.full_url ?? null);
  const findings = checkText(
    { text, channel: item.channel, format: item.format, allowedHosts: await allowedHosts(tx, productId) },
    rules.map((r) => ({ code: r.code, ruleType: r.rule_type, patterns: r.patterns, instruction: r.instruction, severity: r.severity, rationale: r.rationale, active: r.active })),
  );
  // Length/link limits apply to what is published (caption), not to production notes.
  const outcome = outcomeOf(findings);
  await tx.query(
    "insert into content_reviews (workspace_id, product_id, content_version_id, reviewer, outcome, findings) values ($1,$2,$3,'guardrails',$4,$5)",
    [actor.workspaceId, productId, item.current_version_id, outcome, JSON.stringify(findings)],
  );

  const wf = workflowRunId ?? (await startWorkflow(tx, actor, productId, item.idea_id ?? (await tx.one<{ id: string }>("select idea_id id from content_items where id = $1", [itemId])).id, { step: "review", itemId })).id;
  const tone = (await tx.maybeOne<{ tone_of_voice: string }>("select tone_of_voice from brand_profiles where product_id = $1", [productId]))?.tone_of_voice ?? "";
  const prohibited = (await tx.query<{ statement: string }>("select statement from product_claims where product_id = $1 and kind = 'prohibited_claim' and not archived", [productId])).map((p) => p.statement);
  let aiBlock = false;
  for (const [task, key, reviewer] of [["brand_review", "brand_review.v1", "brand_ai"], ["compliance_review", "compliance_review.v1", "compliance_ai"]] as const) {
    const r = await runAgent(tx, {
      actor, productId, workflowRunId: wf, step: task, task, promptKey: key, schema: reviewOutputSchema,
      input: { text, channel: item.channel, format: item.format, tone, prohibitedClaims: prohibited, rules: rules.filter((x) => x.active).map((x) => x.rationale || x.instruction) },
      sourceIds: [],
    });
    if (r.output.outcome === "block") aiBlock = true;
    await tx.query(
      "insert into content_reviews (workspace_id, product_id, content_version_id, reviewer, outcome, findings, agent_run_id) values ($1,$2,$3,$4,$5,$6,$7)",
      [actor.workspaceId, productId, item.current_version_id, reviewer, r.output.outcome, JSON.stringify(r.output.findings), r.agentRunId],
    );
  }
  const blocked = outcome === "block" || aiBlock;
  await tx.query("update content_items set status = $2 where id = $1", [itemId, blocked ? "draft" : "needs_human_review"]);
  return { outcome: blocked ? "block" : outcome, findings };
}

export async function reviewsFor(tx: Tx, versionId: string) {
  return tx.query<{ reviewer: string; outcome: string; findings: Array<{ code: string; severity: string; message: string; excerpt?: string }>; created_at: string }>(
    "select reviewer, outcome, findings, created_at::text from content_reviews where content_version_id = $1 order by created_at",
    [versionId],
  );
}

/** A human edit creates a new immutable version with a field diff; approvals of older versions are invalidated by the database. */
export async function editContent(tx: Tx, actor: Actor, productId: string, itemId: string, body: ContentBody, visualConcept: string, note: string) {
  const item = await getItem(tx, productId, itemId);
  if (!item) throw new Error("Content item not found");
  if (item.status === "published") throw new Error("Published content cannot be edited. Duplicate it instead.");
  const diff = diffBodies(item.body as Record<string, unknown>, body as Record<string, unknown>);
  if (visualConcept !== item.visual_concept) diff.push({ field: "visual_concept", before: item.visual_concept, after: visualConcept });
  if (!diff.length) return { changed: false };
  const prev = await tx.one<{ hook_id: string | null; angle_id: string | null; rationale: unknown; evidence: unknown }>("select hook_id, angle_id, rationale, evidence from content_versions where id = $1", [item.current_version_id]);
  const v = await tx.one<{ id: string }>(
    `insert into content_versions (workspace_id, product_id, content_item_id, version, body, visual_concept, hook_id, angle_id, rationale, evidence, author_type, diff_from_previous, edit_note)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'human',$11,$12) returning id`,
    [actor.workspaceId, productId, itemId, item.version + 1, JSON.stringify(body), visualConcept, prev.hook_id, prev.angle_id, JSON.stringify(prev.rationale), JSON.stringify(prev.evidence), JSON.stringify(diff), note],
  );
  await tx.query("update content_items set current_version_id = $1 where id = $2", [v.id, itemId]);
  // Not yet published: an edited item goes back through review.
  const st = await tx.one<{ status: string }>("select status from content_items where id = $1", [itemId]);
  if (st.status !== "draft") await tx.query("update content_items set status = 'draft', scheduled_for = null where id = $1", [itemId]);
  return { changed: true, diff };
}

export async function versionsOf(tx: Tx, itemId: string) {
  return tx.query<{ id: string; version: number; author_type: string; author_email: string | null; edit_note: string; diff_from_previous: Array<{ field: string; before: unknown; after: unknown }> | null; created_at: string; model: string | null }>(
    `select v.id, v.version, v.author_type, u.email author_email, v.edit_note, v.diff_from_previous, v.created_at::text, ar.model
       from content_versions v left join users u on u.id = v.created_by left join agent_runs ar on ar.id = v.agent_run_id
      where v.content_item_id = $1 order by v.version desc`,
    [itemId],
  );
}

// ---------------------------------------------------------------------------
// UTM, approval, scheduling, export, publication
// ---------------------------------------------------------------------------
export async function createUtmForItem(tx: Tx, actor: Actor, productId: string, itemId: string, landingUrl: string) {
  const item = await tx.one<{ id: string; channel: string; campaign_id: string | null; product_slug: string; status: string }>(
    "select i.id, i.channel, i.campaign_id, i.status, p.slug product_slug from content_items i join products p on p.id = i.product_id where i.id = $1 and i.product_id = $2",
    [itemId, productId],
  );
  if (["approved", "scheduled", "published"].includes(item.status)) {
    throw new Error("The link is part of what you approve. Send the item back to draft to change it.");
  }
  const tpl = await tx.maybeOne<{ utm_source: string; utm_medium: string }>("select utm_source, utm_medium from utm_templates where product_id = $1 and channel = $2", [productId, item.channel]);
  const camp = item.campaign_id ? await tx.maybeOne<{ utm_campaign: string }>("select utm_campaign from campaigns where id = $1", [item.campaign_id]) : null;
  const exp = await tx.one<{ id: string }>("select id from experiments where content_item_id = $1", [itemId]);
  const month = new Date().toISOString().slice(0, 7).replace("-", "");
  const d = DEFAULT_UTM[item.channel] ?? { source: item.channel, medium: "social" };
  const link = buildUtmLink({
    landingUrl,
    source: tpl?.utm_source ?? d.source,
    medium: tpl?.utm_medium ?? d.medium,
    campaign: camp?.utm_campaign ?? `${item.product_slug}-${month}`,
    content: `ci_${itemId.slice(0, 8)}`,
  });
  const hosts = await allowedHosts(tx, productId);
  const host = new URL(link.landingUrl).hostname.replace(/^www\./, "");
  if (!hosts.includes(host)) throw new Error(`${host} is not one of this product's links. Add it under Products → Links first.`);
  const existing = await tx.maybeOne<{ id: string; full_url: string }>("select id, full_url from utm_links where product_id = $1 and full_url = $2", [productId, link.fullUrl]);
  if (existing) return existing;
  // A different landing page for the same item gets its own utm_content suffix so links stay unique.
  const taken = await tx.maybeOne<{ n: number }>("select count(*)::int n from utm_links where product_id = $1 and utm_campaign = $2 and utm_content like $3", [productId, link.utm_campaign, `${link.utm_content}%`]);
  const content = taken && taken.n > 0 ? `${link.utm_content}-${taken.n + 1}` : link.utm_content;
  const final = content === link.utm_content ? link : buildUtmLink({ landingUrl, source: link.utm_source, medium: link.utm_medium, campaign: link.utm_campaign, content });
  return tx.one<{ id: string; full_url: string }>(
    `insert into utm_links (workspace_id, product_id, content_item_id, experiment_id, campaign_id, channel, landing_url, utm_source, utm_medium, utm_campaign, utm_content, utm_term, full_url)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id, full_url`,
    [actor.workspaceId, productId, itemId, exp.id, item.campaign_id, item.channel, final.landingUrl, final.utm_source, final.utm_medium, final.utm_campaign, final.utm_content, final.utm_term, final.fullUrl],
  );
}

export async function buildApprovalPayload(tx: Tx, productId: string, itemId: string): Promise<ApprovalPayload> {
  const item = await getItem(tx, productId, itemId);
  if (!item) throw new Error("Content item not found");
  const utm = await tx.maybeOne<{ full_url: string }>("select full_url from utm_links where content_item_id = $1 order by created_at desc limit 1", [itemId]);
  const conn = await tx.maybeOne<{ account_label: string; adapter_kind: string }>("select account_label, adapter_kind from channel_connections where product_id = $1 and channel = $2 and status <> 'revoked' order by created_at desc limit 1", [productId, item.channel]);
  return {
    contentVersionId: item.current_version_id,
    versionHash: item.content_hash,
    channel: item.channel,
    format: item.format,
    destination: { account: conn?.account_label || "posted manually by you", method: conn?.adapter_kind === "official_api" ? "api" : "export" },
    text: withUtm(publishableText(item.body, item.format), utm?.full_url ?? null),
    utmUrl: utm?.full_url ?? null,
    media: [],
  };
}

export async function submitForApproval(tx: Tx, actor: Actor, productId: string, itemId: string) {
  const item = await getItem(tx, productId, itemId);
  if (!item) throw new Error("Content item not found");
  if (item.status !== "needs_human_review") throw new Error("Only items that passed review can go to the Approval Queue. Run the reviews first.");
  const blocking = await tx.maybeOne<{ n: number }>("select count(*)::int n from content_reviews where content_version_id = $1 and outcome = 'block'", [item.current_version_id]);
  if (blocking && blocking.n > 0) throw new Error("This version has blocking review findings. Edit the text first.");
  const payload = await buildApprovalPayload(tx, productId, itemId);
  const hash = approvalHash(payload);
  const existing = await tx.maybeOne<{ id: string }>("select id from approval_items where content_version_id = $1 and state = 'pending'", [item.current_version_id]);
  if (existing) return existing;
  return tx.one<{ id: string }>(
    `insert into approval_items (workspace_id, product_id, item_type, content_version_id, subject_summary, payload_snapshot, payload_hash, destination, reason_in_queue)
     values ($1,$2,'content_version',$3,$4,$5,$6,$7,$8) returning id`,
    [actor.workspaceId, productId, item.current_version_id, item.title, JSON.stringify(payload), hash, JSON.stringify(payload.destination), "Every publication needs your approval in v0.1."],
  );
}

export async function decideApproval(tx: Tx, actor: Actor, productId: string, approvalId: string, decision: "approved" | "rejected" | "changes_requested", note: string) {
  const a = await tx.one<{ id: string; content_version_id: string; payload_hash: string; state: string; item_type: string; conversation_message_id: string | null }>(
    "select id, content_version_id, payload_hash, state, item_type, conversation_message_id from approval_items where id = $1 and product_id = $2 for update",
    [approvalId, productId],
  );
  if (a.item_type === "reply") {
    await tx.query("insert into approval_decisions (workspace_id, product_id, approval_item_id, decision, payload_hash, note) values ($1,$2,$3,$4,$5,$6)", [
      actor.workspaceId, productId, a.id, decision, a.payload_hash, note,
    ]);
    await tx.query("update conversation_messages set status = $2 where id = $1", [a.conversation_message_id, decision === "approved" ? "approved" : "rejected"]);
    return decision;
  }
  const item = await tx.one<{ id: string; current_version_id: string }>("select id, current_version_id from content_items where current_version_id = $1", [a.content_version_id]).catch(() => null);
  if (!item) throw new Error("The content changed after it was queued. Review the new version.");
  // Recompute: what is approved must equal what would be sent now.
  const payload = await buildApprovalPayload(tx, productId, item.id);
  if (approvalHash(payload) !== a.payload_hash) {
    await tx.query("update approval_items set state = 'invalidated' where id = $1", [a.id]);
    throw new Error("The content, link or destination changed since it was queued. It has been sent back for review.");
  }
  await tx.query("insert into approval_decisions (workspace_id, product_id, approval_item_id, decision, payload_hash, note) values ($1,$2,$3,$4,$5,$6)", [
    actor.workspaceId, productId, a.id, decision, a.payload_hash, note,
  ]);
  const next = decision === "approved" ? "approved" : decision === "rejected" ? "rejected" : "draft";
  await tx.query("update content_items set status = $2 where id = $1", [item.id, next]);
  return next;
}

export async function scheduleItem(tx: Tx, productId: string, itemId: string, when: Date | null) {
  const item = await tx.one<{ status: string }>("select status from content_items where id = $1 and product_id = $2", [itemId, productId]);
  if (when) {
    if (!["approved", "scheduled"].includes(item.status)) throw new Error("Only approved content can be placed on the calendar.");
    await tx.query("update content_items set status = 'scheduled', scheduled_for = $3 where id = $1 and product_id = $2", [itemId, productId, when.toISOString()]);
  } else {
    await tx.query("update content_items set status = 'approved', scheduled_for = null where id = $1 and product_id = $2 and status = 'scheduled'", [itemId, productId]);
  }
}

export async function approvedQueueItem(tx: Tx, productId: string, itemId: string) {
  return tx.maybeOne<{ id: string; payload_hash: string; payload_snapshot: ApprovalPayload }>(
    `select a.id, a.payload_hash, a.payload_snapshot from approval_items a join content_items i on i.current_version_id = a.content_version_id
      where i.id = $1 and i.product_id = $2 and a.state = 'approved' order by a.decided_at desc limit 1`,
    [itemId, productId],
  );
}

export async function markPublished(tx: Tx, actor: Actor, productId: string, itemId: string, externalUrl: string, publishedAt: Date) {
  const item = await getItem(tx, productId, itemId);
  if (!item) throw new Error("Content item not found");
  if (!["approved", "scheduled"].includes(item.status)) throw new Error("Only approved content can be marked as published.");
  const approval = await approvedQueueItem(tx, productId, itemId);
  if (!approval) throw new Error("No approval found for the current version.");
  if (!/^https?:\/\//i.test(externalUrl)) throw new Error("Paste the link to the live post (https://…). Metrics are matched to it.");
  const utm = await tx.maybeOne<{ id: string }>("select id from utm_links where content_item_id = $1 order by created_at desc limit 1", [itemId]);
  const conn = await tx.maybeOne<{ id: string }>("select id from channel_connections where product_id = $1 and channel = $2 and status <> 'revoked' order by created_at desc limit 1", [productId, item.channel]);
  const pub = await tx.one<{ id: string }>(
    `insert into publications (workspace_id, product_id, content_item_id, content_version_id, channel, connection_id, method, external_url, utm_link_id, approval_item_id, published_at)
     values ($1,$2,$3,$4,$5,$6,'export',$7,$8,$9,$10) returning id`,
    [actor.workspaceId, productId, itemId, item.current_version_id, item.channel, conn?.id ?? null, externalUrl, utm?.id ?? null, approval.id, publishedAt.toISOString()],
  );
  await tx.query("update content_items set status = 'published', published_at = $2 where id = $1", [itemId, publishedAt.toISOString()]);
  return pub;
}
