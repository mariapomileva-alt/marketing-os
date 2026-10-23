import type { Tx } from "@/server/db/client";
import { withContext } from "@/server/db/client";
import { approvalHash } from "@/domain/approvals";
import { classifyAdapterError, evaluatePolicy, pauseHoursFor, type Limits } from "@/domain/policy";
import { decryptSecret, encryptSecret, lastFour } from "@/server/security/crypto";
import type { Actor } from "./content";
import { receiveReply } from "./youtube";
import type { ThreadReply } from "@/server/youtube/write";

/**
 * Posting approved YouTube comments and replies as the team's channel, and reading replies back.
 * Every post goes through the same gate: publishing switched on, a connected channel, the exact approved text,
 * daily limit, minimum gap, active hours. Every attempt is written to outbound_actions; an error from YouTube
 * pauses the connection (circuit breaker) instead of retrying.
 */
export interface YoutubeWriteApi {
  accessToken(refreshToken: string): Promise<string>;
  postComment(token: string, videoId: string, text: string): Promise<{ threadId: string; commentId: string }>;
  postReply(token: string, threadId: string, text: string): Promise<{ commentId: string }>;
  listReplies(threadId: string): Promise<ThreadReply[]>;
}

export const publishingEnabled = () => process.env.YOUTUBE_PUBLISHING_ENABLED === "true";

const DEFAULT_LIMITS = (daily: number): Limits => ({ daily_limit: daily, account_daily_cap: daily, min_gap_minutes: 10, author_cooldown_days: 0, active_hours: { start: 8, end: 23, tz: "Europe/Riga" } });

export async function saveYoutubeConnection(tx: Tx, workspaceId: string, productId: string, channel: { id: string; title: string }, refreshToken: string) {
  const old = await tx.maybeOne<{ id: string; secret_id: string | null }>("select id, secret_id from channel_connections where product_id = $1 and channel = 'youtube' and status <> 'revoked'", [productId]);
  if (old) {
    await tx.query("update channel_connections set status = 'revoked', secret_id = null, revoked_at = now() where id = $1", [old.id]);
    if (old.secret_id) await tx.query("delete from secrets where id = $1", [old.secret_id]);
  }
  const enc = encryptSecret(refreshToken);
  const s = await tx.one<{ id: string }>(
    "insert into secrets (workspace_id, label, ciphertext, iv, auth_tag, key_version, last_four) values ($1,'YouTube channel token',$2,$3,$4,$5,$6) returning id",
    [workspaceId, enc.ciphertext, enc.iv, enc.authTag, enc.keyVersion, lastFour(refreshToken)],
  );
  const daily = (await tx.maybeOne<{ daily_publish_limit: number }>("select daily_publish_limit from yt_settings where product_id = $1", [productId]))?.daily_publish_limit ?? 3;
  return tx.one<{ id: string }>(
    `insert into channel_connections (workspace_id, product_id, channel, adapter_kind, account_label, external_account_id, mode, status, limits, secret_id, scopes, last_health_at)
     values ($1,$2,'youtube','official_api',$3,$4,'requires_approval','connected',$5,$6,$7, now()) returning id`,
    [workspaceId, productId, channel.title, channel.id, JSON.stringify(DEFAULT_LIMITS(daily)), s.id, ["youtube.force-ssl"]],
  );
}

export interface YtConnection {
  id: string;
  status: "connected" | "paused" | "revoked" | "error";
  paused_until: string | null;
  paused_reason: string | null;
  limits: Limits;
  account_label: string;
  external_account_id: string | null;
  secret_id: string | null;
}

export async function youtubeConnection(tx: Tx, productId: string): Promise<YtConnection | null> {
  return tx.maybeOne<YtConnection>(
    "select id, status, paused_until::text, paused_reason, limits, account_label, external_account_id, secret_id from channel_connections where product_id = $1 and channel = 'youtube' and status <> 'revoked' order by created_at desc limit 1",
    [productId],
  );
}

export async function refreshTokenFor(secretId: string) {
  // Users cannot select secrets: read with the service role, decrypt in memory only.
  const row = await withContext({ userId: null, role: "service" }, (tx) =>
    tx.one<{ ciphertext: Buffer; iv: Buffer; auth_tag: Buffer; key_version: number }>("select ciphertext, iv, auth_tag, key_version from secrets where id = $1", [secretId]),
  );
  return decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag, keyVersion: row.key_version });
}

export async function postGate(tx: Tx, productId: string, messageId: string, now = new Date()) {
  const m = await tx.one<{ text: string; status: string; conversation_id: string }>(
    "select text, status, conversation_id from conversation_messages where id = $1 and product_id = $2 and direction = 'outbound'",
    [messageId, productId],
  );
  const a = await tx.maybeOne<{ id: string; state: string; payload_hash: string; payload_snapshot: Record<string, unknown> }>(
    "select id, state, payload_hash, payload_snapshot from approval_items where conversation_message_id = $1 order by created_at desc limit 1",
    [messageId],
  );
  const conn = await youtubeConnection(tx, productId);
  const stats = await tx.one<{ n: number; last: string | null }>(
    `select count(*) filter (where created_at > $2::timestamptz - interval '1 day')::int n, max(created_at)::text last
       from outbound_actions where product_id = $1 and action in ('publish', 'reply') and result = 'executed'`,
    [productId, now.toISOString()],
  );
  const currentHash = a ? approvalHash({ ...(a.payload_snapshot as Record<string, unknown>), text: m.text } as never) : "";
  const policy = evaluatePolicy({
    action: "reply",
    now,
    connection: conn && publishingEnabled()
      ? { status: conn.status, mode: "requires_approval", pausedUntil: conn.paused_until ? new Date(conn.paused_until) : null, pausedReason: conn.paused_reason, adapterKind: "official_api", limits: conn.limits }
      : null,
    approval: a ? { state: a.state, payloadHash: a.payload_hash } : null,
    currentPayloadHash: currentHash,
    executedToday: stats.n,
    executedTodayAccount: stats.n,
    lastExecutedAt: stats.last ? new Date(stats.last) : null,
    authorLastContactedAt: null, // replies continue a conversation the person started with us
    dedupeKeyUsed: m.status === "posted",
  });
  const reason = !publishingEnabled()
    ? "Publishing is switched off (YOUTUBE_PUBLISHING_ENABLED). Post it yourself, then press “I posted it”."
    : !conn
      ? "The YouTube channel is not connected yet (Connections → Connect YouTube channel)."
      : policy.reason;
  return { allowed: publishingEnabled() && !!conn && policy.allowed, reason, checks: policy.checks, connection: conn, approvalId: a?.id ?? null, message: m };
}

/** Posts one approved draft. Returns what happened in words the owner can act on. */
export async function postApproved(tx: Tx, actor: Actor, productId: string, messageId: string, api: YoutubeWriteApi, now = new Date()) {
  const g = await postGate(tx, productId, messageId, now);
  if (!g.allowed || !g.connection?.secret_id) {
    await tx.query(
      "insert into outbound_actions (workspace_id, product_id, connection_id, approval_item_id, action, target_author, result, reason, policy_checks) values ($1,$2,$3,$4,'reply',null,'skipped',$5,$6)",
      [actor.workspaceId, productId, g.connection?.id ?? null, g.approvalId, g.reason, JSON.stringify(g.checks)],
    );
    return { posted: false, reason: g.reason };
  }
  const conv = await tx.one<{ external_ref: string | null; external_thread_id: string | null }>("select external_ref, external_thread_id from conversations where id = $1", [g.message.conversation_id]);
  const isReply = Boolean(conv.external_thread_id);
  try {
    const token = await api.accessToken(await refreshTokenFor(g.connection.secret_id));
    let externalId: string;
    if (isReply) {
      externalId = (await api.postReply(token, conv.external_thread_id!, g.message.text)).commentId;
    } else {
      if (!conv.external_ref) throw new Error("This conversation has no video id.");
      const r = await api.postComment(token, conv.external_ref, g.message.text);
      externalId = r.commentId;
      await tx.query("update conversations set external_thread_id = $2 where id = $1", [g.message.conversation_id, r.threadId]);
    }
    await tx.query(
      "insert into outbound_actions (workspace_id, product_id, connection_id, approval_item_id, action, dedupe_key, result, reason, policy_checks) values ($1,$2,$3,$4,$5,$6,'executed','posted after approval',$7)",
      [actor.workspaceId, productId, g.connection.id, g.approvalId, isReply ? "reply" : "publish", `yt:${messageId}`, JSON.stringify(g.checks)],
    );
    await tx.query("update conversation_messages set status = 'posted', external_id = $2, occurred_at = now() where id = $1", [messageId, externalId]);
    await tx.query("update conversations set status = 'replied' where id = $1", [g.message.conversation_id]);
    await tx.query("update yt_videos set status = 'published' where conversation_id = $1", [g.message.conversation_id]);
    await tx.query("update channel_connections set last_health_at = now(), last_error = null where id = $1", [g.connection.id]);
    return { posted: true, reason: isReply ? "Reply posted on YouTube." : "Comment posted on YouTube." };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    const errorClass = classifyAdapterError(msg);
    const hours = pauseHoursFor(errorClass);
    await tx.query(
      "insert into outbound_actions (workspace_id, product_id, connection_id, approval_item_id, action, result, reason, policy_checks, error_class) values ($1,$2,$3,$4,$5,'failed',$6,$7,$8)",
      [actor.workspaceId, productId, g.connection.id, g.approvalId, isReply ? "reply" : "publish", msg, JSON.stringify(g.checks), errorClass],
    );
    // Circuit breaker: stop instead of retrying into a limit or a restriction.
    await tx.query(
      "update channel_connections set status = 'paused', paused_reason = $2, paused_until = now() + ($3 || ' hours')::interval, last_error = $2 where id = $1",
      [g.connection.id, msg, String(hours)],
    );
    return { posted: false, reason: `YouTube refused: ${msg} Publishing is paused for ${hours} h.` };
  }
}

/** Reads new public replies under our posted comments and drafts answers for approval. */
export async function syncReplies(tx: Tx, actor: Actor, productId: string, api: Pick<YoutubeWriteApi, "listReplies">) {
  const conn = await youtubeConnection(tx, productId);
  const threads = await tx.query<{ id: string; external_thread_id: string }>(
    "select id, external_thread_id from conversations where product_id = $1 and channel = 'youtube' and external_thread_id is not null and status <> 'closed' order by coalesce(replies_checked_at, created_at) limit 30",
    [productId],
  );
  let fresh = 0;
  let highRisk = 0;
  const errors: string[] = [];
  for (const t of threads) {
    try {
      const replies = await api.listReplies(t.external_thread_id);
      const known = new Set((await tx.query<{ external_id: string }>("select external_id from conversation_messages where conversation_id = $1 and external_id is not null", [t.id])).map((r) => r.external_id));
      for (const r of replies.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))) {
        if (known.has(r.id)) continue;
        if (conn?.external_account_id && r.authorChannelId === conn.external_account_id) continue; // our own replies
        const res = await receiveReply(tx, actor, productId, t.id, r.authorName, r.text, { externalId: r.id, occurredAt: r.publishedAt });
        fresh++;
        if (res.risk === "high") highRisk++;
      }
      await tx.query("update conversations set replies_checked_at = now() where id = $1", [t.id]);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { checked: threads.length, fresh, highRisk, errors };
}
