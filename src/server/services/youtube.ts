import { createHash } from "node:crypto";
import type { Tx } from "@/server/db/client";
import { approvalHash, canonicalJson } from "@/domain/approvals";
import { checkText, outcomeOf, type GuardrailRule } from "@/domain/guardrails";
import { communityCommentSchema, communityReplySchema } from "@/domain/ai/schemas";
import { checkVoice, classifyMessage, safetyDraft, scoreVideo, type VideoCandidate, type VoiceCheck } from "@/domain/youtube";
import { evaluatePolicy } from "@/domain/policy";
import { runAgent, type Actor } from "./content";
import type { VideoSource } from "@/server/youtube/source";

export interface YtSettings {
  enabled: boolean;
  queries: string[];
  languages: string[];
  min_duration_seconds: number;
  channel_cooldown_days: number;
  drafts_per_run: number;
  daily_publish_limit: number;
  published_within_days: number;
  brand_name: string | null;
  last_run_at: string | null;
}

export async function getYtSettings(tx: Tx, workspaceId: string, productId: string): Promise<YtSettings> {
  await tx.query("insert into yt_settings (product_id, workspace_id) values ($1, $2) on conflict (product_id) do nothing", [productId, workspaceId]);
  return tx.one<YtSettings>(
    `select enabled, queries, languages, min_duration_seconds, channel_cooldown_days, drafts_per_run, daily_publish_limit,
            published_within_days, brand_name, last_run_at::text from yt_settings where product_id = $1`,
    [productId],
  );
}

export async function updateYtSettings(tx: Tx, workspaceId: string, productId: string, s: Omit<YtSettings, "last_run_at">) {
  await getYtSettings(tx, workspaceId, productId);
  await tx.query(
    `update yt_settings set enabled = $2, queries = $3, languages = $4, min_duration_seconds = $5, channel_cooldown_days = $6,
            drafts_per_run = $7, daily_publish_limit = $8, published_within_days = $9, brand_name = $10 where product_id = $1`,
    [productId, s.enabled, s.queries, s.languages, s.min_duration_seconds, s.channel_cooldown_days, s.drafts_per_run, s.daily_publish_limit, s.published_within_days, s.brand_name],
  );
}

async function productRules(tx: Tx, productId: string): Promise<GuardrailRule[]> {
  const rows = await tx.query<{ code: string; rule_type: GuardrailRule["ruleType"]; patterns: unknown; instruction: string; severity: "block" | "warn"; rationale: string; active: boolean }>(
    "select code, rule_type, patterns, instruction, severity, rationale, active from product_guardrails where product_id = $1",
    [productId],
  );
  return rows.map((r) => ({ code: r.code, ruleType: r.rule_type, patterns: r.patterns, instruction: r.instruction, severity: r.severity, rationale: r.rationale, active: r.active }) as GuardrailRule);
}

async function previousTeamTexts(tx: Tx, productId: string): Promise<string[]> {
  const rows = await tx.query<{ text: string }>(
    `select m.text from conversation_messages m join conversations c on c.id = m.conversation_id
      where m.product_id = $1 and c.channel = 'youtube' and m.direction = 'outbound' and m.status in ('draft', 'approved', 'posted')
      order by m.created_at desc limit 300`,
    [productId],
  );
  return rows.map((r) => r.text);
}

async function brandName(tx: Tx, productId: string, s: YtSettings) {
  if (s.brand_name?.trim()) return s.brand_name.trim();
  return (await tx.one<{ name: string }>("select name from products where id = $1", [productId])).name;
}

export interface DraftCheck {
  voice: VoiceCheck;
  guardrailBlocks: string[];
  ok: boolean;
}

export function checkDraft(text: string, previous: string[], name: string, rules: GuardrailRule[]): DraftCheck {
  const voice = checkVoice(text, previous, name);
  const findings = checkText({ text, channel: "youtube", format: "helpful_comment" }, rules);
  const guardrailBlocks = outcomeOf(findings) === "block" ? findings.filter((f) => f.severity === "block").map((f) => f.message) : [];
  return { voice, guardrailBlocks, ok: voice.ok && guardrailBlocks.length === 0 };
}

/** Puts one outbound draft into the conversation and, when it passed every check, into the Approval Queue. */
async function queueDraft(
  tx: Tx,
  actor: Actor,
  productId: string,
  conv: { id: string; thread_url: string | null; subject: string | null },
  text: string,
  variant: "helpful" | "with_mention" | "reply" | "safety",
  check: DraftCheck,
  agentRunId: string | null,
  reasonInQueue: string,
) {
  const status = check.ok ? "draft" : "rejected";
  const m = await tx.one<{ id: string }>(
    `insert into conversation_messages (workspace_id, product_id, conversation_id, direction, text, status, variant, mentions_product, voice, agent_run_id)
     values ($1,$2,$3,'outbound',$4,$5,$6,$7,$8,$9) returning id`,
    [actor.workspaceId, productId, conv.id, text, status, variant, check.voice.mentionsProduct,
     JSON.stringify({ ...check.voice, guardrailBlocks: check.guardrailBlocks }), agentRunId],
  );
  if (!check.ok) return { messageId: m.id, queued: false };
  const payload = {
    contentVersionId: m.id,
    versionHash: createHash("sha256").update(text).digest("hex"),
    channel: "youtube",
    format: variant === "reply" || variant === "safety" ? "reply" : "comment",
    destination: { account: "YouTube channel of the team", method: "manual" as const, targetUrl: conv.thread_url },
    text,
    utmUrl: null,
    media: [],
  };
  await tx.query(
    `insert into approval_items (workspace_id, product_id, item_type, conversation_message_id, subject_summary, payload_snapshot, payload_hash, destination, reason_in_queue)
     values ($1,$2,'reply',$3,$4,$5,$6,$7,$8)`,
    [actor.workspaceId, productId, m.id, `YouTube · ${conv.subject ?? "comment"}`.slice(0, 200), canonicalJson(payload), approvalHash(payload), JSON.stringify(payload.destination), reasonInQueue],
  );
  return { messageId: m.id, queued: true };
}

async function startRun(tx: Tx, actor: Actor, productId: string, step: string) {
  return tx.one<{ id: string }>(
    "insert into workflow_runs (workspace_id, product_id, workflow, input, status, current_step) values ($1,$2,'youtube_community',$3,'running',$4) returning id",
    [actor.workspaceId, productId, JSON.stringify({ step }), step],
  );
}

/** Drafts the team's comment for one found video: a helpful variant and, when it fits, an open mention. */
export async function draftVideoComment(tx: Tx, actor: Actor, productId: string, ytVideoId: string, seed = 0) {
  const v = await tx.one<{ id: string; title: string; description: string; channel_title: string; url: string; conversation_id: string | null; video_id: string }>(
    "select id, title, description, channel_title, url, conversation_id, video_id from yt_videos where id = $1 and product_id = $2",
    [ytVideoId, productId],
  );
  if (v.conversation_id) throw new Error("This video already has drafts.");
  const s = await getYtSettings(tx, actor.workspaceId, productId);
  const name = await brandName(tx, productId, s);
  const previous = await previousTeamTexts(tx, productId);
  const rules = await productRules(tx, productId);
  const wf = await startRun(tx, actor, productId, "comment");
  const r = await runAgent(tx, {
    actor, productId, workflowRunId: wf.id, step: "community_comment", task: "community_comment", promptKey: "community_comment.v1",
    schema: communityCommentSchema, sourceIds: [],
    input: { productName: name, videoTitle: v.title, videoDescription: v.description.slice(0, 1500), channel: v.channel_title, previousComments: previous.slice(0, 20), seed },
  });
  await tx.query("update workflow_runs set status = 'waiting_for_human' where id = $1", [wf.id]);
  if (r.output.skip) {
    await tx.query("update yt_videos set status = 'skipped', reason = $2 where id = $1", [v.id, `Drafter skipped: ${r.output.skip_reason || "no comment fits"}`]);
    return { queued: 0, rejected: 0, skipped: true };
  }
  const conv = await tx.one<{ id: string; thread_url: string | null; subject: string | null }>(
    `insert into conversations (workspace_id, product_id, channel, thread_url, status, external_ref, subject, risk)
     values ($1,$2,'youtube',$3,'needs_reply',$4,$5,'low') returning id, thread_url, subject`,
    [actor.workspaceId, productId, v.url, v.video_id, `${v.channel_title} · ${v.title}`],
  );
  let queued = 0;
  let rejected = 0;
  // Variants are alternatives for the same video (only one gets posted): each is compared with earlier comments, not with its sibling.
  for (const variant of r.output.variants) {
    const check = checkDraft(variant.text, previous, name, rules);
    const q = await queueDraft(tx, actor, productId, conv, variant.text, variant.variant, check, r.agentRunId,
      `Comment under a video by ${v.channel_title}. Drafted from the title and description only. Responds to: ${r.output.responds_to}`);
    if (q.queued) queued++; else rejected++;
  }
  await tx.query("update yt_videos set status = 'drafted', conversation_id = $2 where id = $1", [v.id, conv.id]);
  return { queued, rejected, skipped: false };
}

export interface DiscoveryStats {
  source: string;
  found: number;
  newVideos: number;
  eligible: number;
  drafted: number;
  draftsQueued: number;
  draftsRejected: number;
  errors: string[];
}

/** One discovery run: search, filter, record every video with its reason, draft comments for the best few. */
export async function runDiscovery(tx: Tx, actor: Actor, productId: string, source: VideoSource, now = new Date()): Promise<DiscoveryStats> {
  const s = await getYtSettings(tx, actor.workspaceId, productId);
  const stats: DiscoveryStats = { source: source.kind, found: 0, newVideos: 0, eligible: 0, drafted: 0, draftsQueued: 0, draftsRejected: 0, errors: [] };
  const publishedAfter = new Date(now.getTime() - s.published_within_days * 86_400_000);
  const seen = new Map<string, { v: VideoCandidate; query: string }>();
  for (const query of s.queries) {
    const language = /[а-яё]/i.test(query) ? "ru" : s.languages.includes("en") ? "en" : null;
    try {
      for (const v of await source.find(query, { publishedAfter, language, max: 15 })) if (!seen.has(v.videoId)) seen.set(v.videoId, { v, query });
    } catch (e) {
      stats.errors.push(`"${query}": ${(e as Error).message}`);
      if (/quota|forbidden|403|429/i.test((e as Error).message)) break; // stop on limits instead of hammering the API
    }
  }
  stats.found = seen.size;
  const existing = new Set((await tx.query<{ video_id: string }>("select video_id from yt_videos where product_id = $1 and video_id = any($2)", [productId, [...seen.keys()]])).map((r) => r.video_id));
  const lastByChannel = new Map(
    (await tx.query<{ channel_id: string; last: string }>(
      "select channel_id, max(found_at)::text last from yt_videos where product_id = $1 and status in ('drafted', 'reviewed', 'approved', 'published') group by 1",
      [productId],
    )).map((r) => [r.channel_id, new Date(r.last)]),
  );
  const fresh: Array<{ id: string; relevance: number; channel: string }> = [];
  for (const { v, query } of seen.values()) {
    if (existing.has(v.videoId)) continue;
    const verdict = scoreVideo(v, { queries: s.queries, minDurationSeconds: s.min_duration_seconds, channelCooldownDays: s.channel_cooldown_days }, lastByChannel.get(v.channelId) ?? null, now);
    const row = await tx.one<{ id: string }>(
      `insert into yt_videos (workspace_id, product_id, video_id, url, title, description, channel_id, channel_title, published_at, language, views, duration_seconds,
                              matched_keywords, found_by_query, relevance, reason, flags, status, is_demo)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning id`,
      [actor.workspaceId, productId, v.videoId, `https://www.youtube.com/watch?v=${v.videoId}`, v.title, v.description.slice(0, 5000), v.channelId, v.channelTitle,
       v.publishedAt, v.language, v.views, v.durationSeconds, verdict.matchedKeywords, query, verdict.relevance, verdict.reason, verdict.flags,
       verdict.eligible ? "new" : "skipped", source.kind === "demo"],
    );
    stats.newVideos++;
    if (verdict.eligible) { stats.eligible++; fresh.push({ id: row.id, relevance: verdict.relevance, channel: v.channelId }); }
  }
  // Best first; one draft per channel per run.
  const picked: typeof fresh = [];
  for (const f of fresh.sort((a, b) => b.relevance - a.relevance)) {
    if (picked.length >= s.drafts_per_run) break;
    if (picked.some((p) => p.channel === f.channel)) continue;
    picked.push(f);
  }
  for (const [i, p] of picked.entries()) {
    const d = await draftVideoComment(tx, actor, productId, p.id, i + stats.newVideos);
    if (!d.skipped) stats.drafted++;
    stats.draftsQueued += d.queued;
    stats.draftsRejected += d.rejected;
  }
  await tx.query("update yt_settings set last_run_at = $2 where product_id = $1", [productId, now.toISOString()]);
  await tx.query(
    "insert into automation_runs (workspace_id, product_id, kind, status, stats, finished_at) values ($1,$2,'youtube_discovery',$3,$4, now())",
    [actor.workspaceId, productId, stats.errors.length && !stats.found ? "error" : "ok", JSON.stringify(stats)],
  );
  return stats;
}

/** A person answered under our comment: record it, judge the risk, and draft a reply (or a safety note) for approval. */
export async function receiveReply(tx: Tx, actor: Actor, productId: string, conversationId: string, author: string | null, text: string) {
  const conv = await tx.one<{ id: string; thread_url: string | null; subject: string | null; external_ref: string | null }>(
    "select id, thread_url, subject, external_ref from conversations where id = $1 and product_id = $2 and channel = 'youtube'",
    [conversationId, productId],
  );
  const cls = classifyMessage(text);
  await tx.query(
    "insert into conversation_messages (workspace_id, product_id, conversation_id, direction, author_handle, text, kind) values ($1,$2,$3,'inbound',$4,$5,$6)",
    [actor.workspaceId, productId, conv.id, author, text, cls.kind],
  );
  const high = cls.risk === "high";
  await tx.query(
    `update conversations set status = 'needs_reply',
            risk = case when $2 = 'high' or risk = 'high' then 'high' when $2 = 'medium' or risk = 'medium' then 'medium' else 'low' end,
            risk_reason = case when $2 = 'high' then $3 else risk_reason end,
            sensitive = sensitive or $4
      where id = $1`,
    [conv.id, cls.risk, cls.reason, high],
  );
  const s = await getYtSettings(tx, actor.workspaceId, productId);
  const name = await brandName(tx, productId, s);
  const rules = await productRules(tx, productId);
  const previous = await previousTeamTexts(tx, productId);

  if (high) {
    // No AI, no product, no ordinary conversation: a fixed caring note that a person may send or not.
    const note = safetyDraft(/[а-яё]/i.test(text) ? "ru" : "en");
    const check = checkDraft(note, [], name, rules); // similarity to earlier safety notes is expected and fine
    await queueDraft(tx, actor, productId, conv, note, "safety", { ...check, ok: check.guardrailBlocks.length === 0 }, null,
      `HIGH RISK: ${cls.reason} Decide yourself whether and how to answer.`);
    return { kind: cls.kind, risk: cls.risk, queued: true };
  }

  const thread = await tx.query<{ direction: string; author_handle: string | null; text: string }>(
    "select direction, author_handle, text from conversation_messages where conversation_id = $1 and (direction = 'inbound' or status in ('approved', 'posted')) order by occurred_at",
    [conv.id],
  );
  const productMentioned = thread.some((m) => m.direction === "outbound" && new RegExp(`\\b${name}\\b`).test(m.text));
  const wf = await startRun(tx, actor, productId, "reply");
  const r = await runAgent(tx, {
    actor, productId, workflowRunId: wf.id, step: "community_reply", task: "community_reply", promptKey: "community_reply.v1",
    schema: communityReplySchema, sourceIds: [],
    input: { productName: name, video: conv.subject, thread, message: text, messageKind: cls.kind, productAlreadyMentioned: productMentioned, highRisk: false },
  });
  await tx.query("update workflow_runs set status = 'waiting_for_human' where id = $1", [wf.id]);
  const check = checkDraft(r.output.text, previous, name, rules);
  if (r.output.handoff_to_human) check.voice.warnings.push("The drafter asks a person to decide whether to answer at all.");
  const q = await queueDraft(tx, actor, productId, conv, r.output.text, "reply", check, r.agentRunId,
    `${r.output.handoff_to_human ? "Drafter asks you to decide. " : ""}What they mean: ${r.output.understanding} (${cls.kind.replaceAll("_", " ")}, risk ${cls.risk}).`);
  return { kind: cls.kind, risk: cls.risk, queued: q.queued };
}

/**
 * The only door to posting on YouTube. In this version it always refuses unless publishing is switched on AND the
 * exact text was approved AND the daily and per-channel limits allow it. Even then it reports what would be sent:
 * the API call itself is added only after the dry-run period (owner decision).
 */
export async function publishGate(tx: Tx, productId: string, messageId: string, now = new Date()) {
  const m = await tx.one<{ text: string; status: string; conversation_id: string }>(
    "select text, status, conversation_id from conversation_messages where id = $1 and product_id = $2 and direction = 'outbound'",
    [messageId, productId],
  );
  const a = await tx.maybeOne<{ state: string; payload_hash: string; payload_snapshot: Record<string, unknown> }>(
    "select state, payload_hash, payload_snapshot from approval_items where conversation_message_id = $1 order by created_at desc limit 1",
    [messageId],
  );
  const s = await tx.one<{ daily_publish_limit: number }>("select daily_publish_limit from yt_settings where product_id = $1", [productId]);
  const today = await tx.one<{ n: number }>(
    "select count(*)::int n from outbound_actions where product_id = $1 and action in ('publish', 'reply') and result = 'executed' and created_at > $2::timestamptz - interval '1 day'",
    [productId, now.toISOString()],
  );
  const currentHash = a ? approvalHash({ ...(a.payload_snapshot as Record<string, unknown>), text: m.text } as never) : "";
  const enabled = process.env.YOUTUBE_PUBLISHING_ENABLED === "true";
  const policy = evaluatePolicy({
    action: "reply", now,
    connection: enabled
      ? { status: "connected", mode: "requires_approval", pausedUntil: null, pausedReason: null, adapterKind: "official_api",
          limits: { daily_limit: s.daily_publish_limit, account_daily_cap: s.daily_publish_limit, min_gap_minutes: 30, author_cooldown_days: 0, active_hours: { start: 8, end: 22, tz: "Europe/Riga" } } }
      : null,
    approval: a ? { state: a.state, payloadHash: a.payload_hash } : null,
    currentPayloadHash: currentHash,
    executedToday: today.n,
    executedTodayAccount: today.n,
    lastExecutedAt: null,
    authorLastContactedAt: null,
    dedupeKeyUsed: m.status === "posted",
  });
  const reason = !enabled ? "Publishing to YouTube is turned off (dry run). Post approved comments yourself from the channel, then mark them as posted." : policy.reason;
  return { allowed: enabled && policy.allowed, reason, checks: policy.checks };
}
