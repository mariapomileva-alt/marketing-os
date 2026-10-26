import { createHash } from "node:crypto";
import type { Tx } from "@/server/db/client";
import { approvalHash, canonicalJson } from "@/domain/approvals";
import { checkText, outcomeOf, type GuardrailRule } from "@/domain/guardrails";
import { communityCommentSchema, communityReplySchema } from "@/domain/ai/schemas";
import { checkVoice, classifyMessage, queriesForRun, safetyDraft, scoreVideo, styleNotes, type VideoCandidate, type VoiceCheck } from "@/domain/youtube";
import { decideApproval, runAgent, type Actor } from "./content";
import { draftingKnowledge } from "./knowledge-context";
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
  // The posting gate reads its limits from the channel connection: keep the daily cap in step with the setting.
  await tx.query(
    `update channel_connections set limits = limits || jsonb_build_object('daily_limit', $2::int, 'account_daily_cap', $2::int)
      where product_id = $1 and channel = 'youtube' and status <> 'revoked'`,
    [productId, s.daily_publish_limit],
  );
}

export async function productRules(tx: Tx, productId: string): Promise<GuardrailRule[]> {
  const rows = await tx.query<{ code: string; rule_type: GuardrailRule["ruleType"]; patterns: unknown; instruction: string; severity: "block" | "warn"; rationale: string; active: boolean }>(
    "select code, rule_type, patterns, instruction, severity, rationale, active from product_guardrails where product_id = $1",
    [productId],
  );
  return rows.map((r) => ({ code: r.code, ruleType: r.rule_type, patterns: r.patterns, instruction: r.instruction, severity: r.severity, rationale: r.rationale, active: r.active }) as GuardrailRule);
}

export type CommunityChannel = "youtube" | "threads" | "instagram";
export const CHANNEL_NAME: Record<CommunityChannel, string> = { youtube: "YouTube", threads: "Threads", instagram: "Instagram" };

export async function previousTeamTexts(tx: Tx, productId: string, channel: CommunityChannel = "youtube"): Promise<string[]> {
  const rows = await tx.query<{ text: string }>(
    `select m.text from conversation_messages m join conversations c on c.id = m.conversation_id
      where m.product_id = $1 and c.channel = $2 and m.direction = 'outbound' and m.status in ('draft', 'approved', 'posted')
      order by m.created_at desc limit 300`,
    [productId, channel],
  );
  return rows.map((r) => r.text);
}

export async function brandName(tx: Tx, productId: string, s: YtSettings) {
  if (s.brand_name?.trim()) return s.brand_name.trim();
  return (await tx.one<{ name: string }>("select name from products where id = $1", [productId])).name;
}

export interface DraftCheck {
  voice: VoiceCheck;
  guardrailBlocks: string[];
  ok: boolean;
}

export function checkDraft(text: string, previous: string[], name: string, rules: GuardrailRule[], channel: CommunityChannel = "youtube"): DraftCheck {
  const voice = checkVoice(text, previous, name);
  const findings = checkText({ text, channel, format: "helpful_comment" }, rules);
  const guardrailBlocks = outcomeOf(findings) === "block" ? findings.filter((f) => f.severity === "block").map((f) => f.message) : [];
  return { voice, guardrailBlocks, ok: voice.ok && guardrailBlocks.length === 0 };
}

/** Puts one outbound draft into the conversation and, when it passed every check, into the Approval Queue. */
export async function queueDraft(
  tx: Tx,
  actor: Actor,
  productId: string,
  conv: { id: string; thread_url: string | null; subject: string | null; channel?: string },
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
  const channel = (conv.channel ?? "youtube") as CommunityChannel;
  const payload = {
    contentVersionId: m.id,
    versionHash: createHash("sha256").update(text).digest("hex"),
    channel,
    format: variant === "reply" || variant === "safety" ? "reply" : "comment",
    destination: { account: `${CHANNEL_NAME[channel]} account of the team`, method: "manual" as const, targetUrl: conv.thread_url },
    text,
    utmUrl: null,
    media: [],
  };
  await tx.query(
    `insert into approval_items (workspace_id, product_id, item_type, conversation_message_id, subject_summary, payload_snapshot, payload_hash, destination, reason_in_queue)
     values ($1,$2,'reply',$3,$4,$5,$6,$7,$8)`,
    [actor.workspaceId, productId, m.id, `${CHANNEL_NAME[channel]} · ${conv.subject ?? "comment"}`.slice(0, 200), canonicalJson(payload), approvalHash(payload), JSON.stringify(payload.destination), reasonInQueue],
  );
  return { messageId: m.id, queued: true };
}

export async function startRun(tx: Tx, actor: Actor, productId: string, step: string) {
  return tx.one<{ id: string }>(
    "insert into workflow_runs (workspace_id, product_id, workflow, input, status, current_step) values ($1,$2,'youtube_community',$3,'running',$4) returning id",
    [actor.workspaceId, productId, JSON.stringify({ step }), step],
  );
}

/** Drafts the team's comment for one found video: a helpful variant and, when it fits, an open mention. */
export async function draftVideoComment(tx: Tx, actor: Actor, productId: string, ytVideoId: string, seed = 0, viewerComments: string[] = []) {
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
    actor, productId, workflowRunId: wf.id, step: "community_comment", task: "community_comment", promptKey: "community_comment.v2",
    schema: communityCommentSchema, sourceIds: [],
    input: { productName: name, videoTitle: v.title, videoDescription: v.description.slice(0, 1500), channel: v.channel_title, whatViewersSay: viewerComments.slice(0, 12), previousComments: previous.slice(0, 20), styleNotes: styleNotes(previous, "comments"), seed,
             knowledge: await draftingKnowledge(tx, actor.workspaceId, productId, v.title) },
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
  // YouTube search costs 100 of 10,000 daily quota units: at most 15 phrases per run, rotating daily.
  for (const query of queriesForRun(s.queries, 15, now)) {
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
  // Best first; one draft per channel per run. Suitable videos found earlier but not drafted yet stay candidates.
  const waiting = await tx.query<{ id: string; relevance: number; channel: string }>(
    `select id, relevance, channel_id channel from yt_videos
      where product_id = $1 and status = 'new' and conversation_id is null and (published_at is null or published_at >= $2)`,
    [productId, publishedAfter.toISOString()],
  );
  const pool = [...new Map([...fresh, ...waiting].map((x) => [x.id, x])).values()];
  const picked: typeof fresh = [];
  for (const f of pool.sort((a, b) => b.relevance - a.relevance)) {
    if (picked.length >= s.drafts_per_run) break;
    if (picked.some((p) => p.channel === f.channel)) continue;
    picked.push(f);
  }
  for (const [i, p] of picked.entries()) {
    const videoId = (await tx.one<{ video_id: string }>("select video_id from yt_videos where id = $1", [p.id])).video_id;
    const viewers = await source.topComments(videoId, 12).catch(() => []);
    try {
      const d = await draftVideoComment(tx, actor, productId, p.id, i + stats.newVideos, viewers);
      if (!d.skipped) stats.drafted++;
      stats.draftsQueued += d.queued;
      stats.draftsRejected += d.rejected;
    } catch (e) {
      // One failed draft (e.g. the AI provider is out of credit) must not lose the whole search.
      stats.errors.push(`Draft for a video failed: ${(e as Error).message}`);
      if (/401|403|credit|billing|api key/i.test((e as Error).message)) break;
    }
  }
  await tx.query("update yt_settings set last_run_at = $2 where product_id = $1", [productId, now.toISOString()]);
  await tx.query(
    "insert into automation_runs (workspace_id, product_id, kind, status, stats, finished_at) values ($1,$2,'youtube_discovery',$3,$4, now())",
    [actor.workspaceId, productId, stats.errors.length && !stats.found ? "error" : "ok", JSON.stringify(stats)],
  );
  return stats;
}

/** A person answered under our comment: record it, judge the risk, and draft a reply (or a safety note) for approval. */
export async function receiveReply(
  tx: Tx, actor: Actor, productId: string, conversationId: string, author: string | null, text: string,
  opts: { externalId?: string; occurredAt?: string } = {},
) {
  const conv = await tx.one<{ id: string; thread_url: string | null; subject: string | null; external_ref: string | null; channel: CommunityChannel }>(
    "select id, thread_url, subject, external_ref, channel from conversations where id = $1 and product_id = $2 and channel in ('youtube', 'threads', 'instagram')",
    [conversationId, productId],
  );
  const cls = classifyMessage(text);
  await tx.query(
    "insert into conversation_messages (workspace_id, product_id, conversation_id, direction, author_handle, text, kind, external_id, occurred_at) values ($1,$2,$3,'inbound',$4,$5,$6,$7,coalesce($8::timestamptz, now()))",
    [actor.workspaceId, productId, conv.id, author, text, cls.kind, opts.externalId ?? null, opts.occurredAt ?? null],
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
  const previous = await previousTeamTexts(tx, productId, conv.channel);

  if (high) {
    // No AI, no product, no ordinary conversation: a fixed caring note that a person may send or not.
    const note = safetyDraft(/[а-яё]/i.test(text) ? "ru" : "en");
    const check = checkDraft(note, [], name, rules, conv.channel); // similarity to earlier safety notes is expected and fine
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
    actor, productId, workflowRunId: wf.id, step: "community_reply", task: "community_reply",
    promptKey: conv.channel === "youtube" ? "community_reply.v2" : "community_social_reply.v1",
    schema: communityReplySchema, sourceIds: [],
    input: conv.channel === "youtube"
      ? { productName: name, video: conv.subject, thread, message: text, messageKind: cls.kind, productAlreadyMentioned: productMentioned, highRisk: false, styleNotes: styleNotes(previous, "replies"), knowledge: await draftingKnowledge(tx, actor.workspaceId, productId, text) }
      : { platform: CHANNEL_NAME[conv.channel], productName: name, post: conv.subject, thread, message: text, messageKind: cls.kind, productAlreadyMentioned: productMentioned, highRisk: false, styleNotes: styleNotes(previous, "replies"), knowledge: await draftingKnowledge(tx, actor.workspaceId, productId, text) },
  });
  await tx.query("update workflow_runs set status = 'waiting_for_human' where id = $1", [wf.id]);
  const check = checkDraft(r.output.text, previous, name, rules, conv.channel);
  if (r.output.handoff_to_human) check.voice.warnings.push("The drafter asks a person to decide whether to answer at all.");
  const q = await queueDraft(tx, actor, productId, conv, r.output.text, "reply", check, r.agentRunId,
    `${r.output.handoff_to_human ? "Drafter asks you to decide. " : ""}What they mean: ${r.output.understanding} (${cls.kind.replaceAll("_", " ")}, risk ${cls.risk}).`);
  return { kind: cls.kind, risk: cls.risk, queued: q.queued };
}

/**
 * Approve one draft from the thread view. If the owner edited the text, the new text is checked again (voice,
 * repetition, safety rules), the old queue item is invalidated and the exact new text is what gets approved.
 */
export async function approveDraft(tx: Tx, actor: Actor, productId: string, messageId: string, editedText: string | null) {
  const m = await tx.one<{ id: string; text: string; status: string; conversation_id: string; variant: string | null }>(
    "select id, text, status, conversation_id, variant from conversation_messages where id = $1 and product_id = $2 and direction = 'outbound'",
    [messageId, productId],
  );
  if (m.status !== "draft") throw new Error("Only drafts waiting for approval can be approved.");
  const text = editedText?.trim() ?? m.text;
  let approvalId: string;
  if (text !== m.text) {
    const s = await getYtSettings(tx, actor.workspaceId, productId);
    const name = await brandName(tx, productId, s);
    const channel = (await tx.one<{ channel: CommunityChannel }>("select channel from conversations where id = $1", [m.conversation_id])).channel;
    const others = (await previousTeamTexts(tx, productId, channel)).filter((t) => t !== m.text);
    const check = checkDraft(text, m.variant === "safety" ? [] : others, name, await productRules(tx, productId), channel);
    const blocking = [...check.guardrailBlocks, ...check.voice.problems];
    if (blocking.length) return { ok: false as const, problems: blocking };
    await tx.query("update approval_items set state = 'invalidated' where conversation_message_id = $1 and state = 'pending'", [m.id]);
    await tx.query("update conversation_messages set text = $2, voice = $3, mentions_product = $4 where id = $1", [m.id, text, JSON.stringify({ ...check.voice, edited: true }), check.voice.mentionsProduct]);
    const conv = await tx.one<{ id: string; thread_url: string | null; subject: string | null }>("select id, thread_url, subject from conversations where id = $1", [m.conversation_id]);
    const payload = {
      contentVersionId: m.id, versionHash: createHash("sha256").update(text).digest("hex"), channel, format: "comment",
      destination: { account: `${CHANNEL_NAME[channel]} account of the team`, method: "manual" as const, targetUrl: conv.thread_url }, text, utmUrl: null, media: [],
    };
    approvalId = (await tx.one<{ id: string }>(
      `insert into approval_items (workspace_id, product_id, item_type, conversation_message_id, subject_summary, payload_snapshot, payload_hash, destination, reason_in_queue)
       values ($1,$2,'reply',$3,$4,$5,$6,$7,'Edited by you in the thread view.') returning id`,
      [actor.workspaceId, productId, m.id, `${CHANNEL_NAME[channel]} · ${conv.subject ?? "comment"}`.slice(0, 200), canonicalJson(payload), approvalHash(payload), JSON.stringify(payload.destination)],
    )).id;
  } else {
    approvalId = (await tx.one<{ id: string }>("select id from approval_items where conversation_message_id = $1 and state = 'pending' order by created_at desc limit 1", [m.id])).id;
  }
  await decideApproval(tx, actor, productId, approvalId, "approved", "Approved in the thread view");
  // The other variant for the same video is no longer needed.
  if (m.variant === "helpful" || m.variant === "with_mention") {
    const siblings = await tx.query<{ id: string }>(
      `select a.id from approval_items a join conversation_messages x on x.id = a.conversation_message_id
        where x.conversation_id = $1 and x.id <> $2 and x.variant in ('helpful', 'with_mention') and a.state = 'pending'`,
      [m.conversation_id, m.id],
    );
    for (const sib of siblings) await decideApproval(tx, actor, productId, sib.id, "rejected", "Another variant was chosen");
  }
  await tx.query("update yt_videos set status = 'approved' where conversation_id = $1 and status in ('drafted', 'reviewed')", [m.conversation_id]);
  await tx.query("update social_posts set status = 'approved' where conversation_id = $1 and status in ('drafted', 'reviewed')", [m.conversation_id]);
  return { ok: true as const, problems: [] };
}

export async function rejectDraft(tx: Tx, actor: Actor, productId: string, messageId: string) {
  const a = await tx.maybeOne<{ id: string }>("select id from approval_items where conversation_message_id = $1 and product_id = $2 and state = 'pending' order by created_at desc limit 1", [messageId, productId]);
  if (a) await decideApproval(tx, actor, productId, a.id, "rejected", "Rejected in the thread view");
  else await tx.query("update conversation_messages set status = 'rejected' where id = $1 and product_id = $2 and status = 'draft'", [messageId, productId]);
}
