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

export const publishingEnabled = (channel: string = "youtube") =>
  channel === "youtube" ? process.env.YOUTUBE_PUBLISHING_ENABLED === "true" : channel === "threads" ? process.env.THREADS_PUBLISHING_ENABLED === "true" : false;

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

export interface ThreadsWriteApi {
  publish(token: string, userId: string, text: string, replyToId: string | null): Promise<{ id: string; permalink: string | null }>;
  refresh(token: string): Promise<{ accessToken: string; expiresAt: Date }>;
}
export interface WriteApis {
  youtube?: YoutubeWriteApi;
  threads?: ThreadsWriteApi;
}
type PostChannel = "youtube" | "threads" | "instagram";
const CHANNEL_LABEL: Record<PostChannel, string> = { youtube: "YouTube", threads: "Threads", instagram: "Instagram" };

export async function channelConnection(tx: Tx, productId: string, channel: string): Promise<(YtConnection & { token_expires_at: string | null }) | null> {
  return tx.maybeOne(
    `select id, status, paused_until::text, paused_reason, limits, account_label, external_account_id, secret_id, token_expires_at::text
       from channel_connections where product_id = $1 and channel = $2 and status <> 'revoked' and adapter_kind = 'official_api' order by created_at desc limit 1`,
    [productId, channel],
  );
}

/** Stores the secret encrypted (service-role readable only) and replaces any earlier connection for this channel. */
export async function saveTokenConnection(
  tx: Tx, workspaceId: string, productId: string, channel: "threads",
  account: { id: string; label: string }, token: string, expiresAt: Date | null, scopes: string[],
) {
  const old = await tx.maybeOne<{ id: string; secret_id: string | null }>("select id, secret_id from channel_connections where product_id = $1 and channel = $2 and status <> 'revoked'", [productId, channel]);
  if (old) {
    await tx.query("update channel_connections set status = 'revoked', secret_id = null, revoked_at = now() where id = $1", [old.id]);
    if (old.secret_id) await tx.query("delete from secrets where id = $1", [old.secret_id]);
  }
  const enc = encryptSecret(token);
  const sec = await tx.one<{ id: string }>(
    "insert into secrets (workspace_id, label, ciphertext, iv, auth_tag, key_version, last_four) values ($1,$2,$3,$4,$5,$6,$7) returning id",
    [workspaceId, `${CHANNEL_LABEL[channel]} account token`, enc.ciphertext, enc.iv, enc.authTag, enc.keyVersion, lastFour(token)],
  );
  return tx.one<{ id: string }>(
    `insert into channel_connections (workspace_id, product_id, channel, adapter_kind, account_label, external_account_id, mode, status, limits, secret_id, scopes, last_health_at, token_expires_at)
     values ($1,$2,$3,'official_api',$4,$5,'requires_approval','connected',$6,$7,$8, now(), $9) returning id`,
    [workspaceId, productId, channel, account.label, account.id, JSON.stringify(DEFAULT_LIMITS(3)), sec.id, scopes, expiresAt?.toISOString() ?? null],
  );
}

/** A usable Threads token: refreshed (and re-stored) when it expires within a week. */
export async function threadsToken(tx: Tx, conn: { id: string; secret_id: string | null; token_expires_at: string | null }, api: Pick<ThreadsWriteApi, "refresh">) {
  if (!conn.secret_id) throw new Error("The Threads account is not connected.");
  const token = await refreshTokenFor(conn.secret_id);
  const expires = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (expires && expires - Date.now() > 7 * 86_400_000) return token;
  const r = await api.refresh(token);
  const enc = encryptSecret(r.accessToken);
  await withContext({ userId: null, role: "service" }, (s) =>
    s.query("update secrets set ciphertext = $2, iv = $3, auth_tag = $4, key_version = $5, last_four = $6, rotated_at = now() where id = $1",
      [conn.secret_id, enc.ciphertext, enc.iv, enc.authTag, enc.keyVersion, lastFour(r.accessToken)]),
  );
  await tx.query("update channel_connections set token_expires_at = $2 where id = $1", [conn.id, r.expiresAt.toISOString()]);
  return r.accessToken;
}

export async function postGate(tx: Tx, productId: string, messageId: string, now = new Date()) {
  const m = await tx.one<{ text: string; status: string; conversation_id: string; channel: PostChannel }>(
    `select m.text, m.status, m.conversation_id, c.channel from conversation_messages m join conversations c on c.id = m.conversation_id
      where m.id = $1 and m.product_id = $2 and m.direction = 'outbound'`,
    [messageId, productId],
  );
  const a = await tx.maybeOne<{ id: string; state: string; payload_hash: string; payload_snapshot: Record<string, unknown> }>(
    "select id, state, payload_hash, payload_snapshot from approval_items where conversation_message_id = $1 order by created_at desc limit 1",
    [messageId],
  );
  const enabled = publishingEnabled(m.channel);
  const conn = m.channel === "instagram" ? null : await channelConnection(tx, productId, m.channel);
  const stats = await tx.one<{ n: number; last: string | null }>(
    `select count(*) filter (where created_at > $2::timestamptz - interval '1 day')::int n, max(created_at)::text last
       from outbound_actions where product_id = $1 and action in ('publish', 'reply') and result = 'executed' and connection_id is not distinct from $3
          and coalesce(dedupe_key, '') not like 'threads-post:%'`,
    [productId, now.toISOString(), conn?.id ?? null],
  );
  const currentHash = a ? approvalHash({ ...(a.payload_snapshot as Record<string, unknown>), text: m.text } as never) : "";
  const policy = evaluatePolicy({
    action: "reply",
    now,
    connection: conn && enabled
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
  const label = CHANNEL_LABEL[m.channel];
  const reason = m.channel === "instagram"
    ? "Instagram does not allow apps to comment on other people's reels. Copy the text, post it yourself, then press “I posted it myself”."
    : !enabled
      ? `Posting to ${label} is switched off (${m.channel.toUpperCase()}_PUBLISHING_ENABLED). Post it yourself, then press “I posted it myself”.`
      : !conn
        ? `The ${label} account is not connected yet (Connections → Connect ${label}).`
        : policy.reason;
  return { allowed: enabled && !!conn && policy.allowed, reason, checks: policy.checks, connection: conn, approvalId: a?.id ?? null, message: m };
}

function asApis(x: WriteApis | YoutubeWriteApi): WriteApis {
  return "accessToken" in x ? { youtube: x as YoutubeWriteApi } : (x as WriteApis);
}

/** Posts one approved draft. Returns what happened in words the owner can act on. */
export async function postApproved(tx: Tx, actor: Actor, productId: string, messageId: string, apisIn: WriteApis | YoutubeWriteApi, now = new Date()) {
  const apis = asApis(apisIn);
  const g = await postGate(tx, productId, messageId, now);
  if (!g.allowed || !g.connection?.secret_id) {
    await tx.query(
      "insert into outbound_actions (workspace_id, product_id, connection_id, approval_item_id, action, target_author, result, reason, policy_checks) values ($1,$2,$3,$4,'reply',null,'skipped',$5,$6)",
      [actor.workspaceId, productId, g.connection?.id ?? null, g.approvalId, g.reason, JSON.stringify(g.checks)],
    );
    return { posted: false, reason: g.reason };
  }
  const channel = g.message.channel;
  const conv = await tx.one<{ external_ref: string | null; external_thread_id: string | null }>("select external_ref, external_thread_id from conversations where id = $1", [g.message.conversation_id]);
  const isReply = Boolean(conv.external_thread_id);
  const label = CHANNEL_LABEL[channel];
  try {
    let externalId: string;
    let permalink: string | null = null;
    if (channel === "youtube") {
      const api = apis.youtube;
      if (!api) throw new Error("YouTube posting is not available here.");
      const token = await api.accessToken(await refreshTokenFor(g.connection.secret_id));
      if (isReply) {
        externalId = (await api.postReply(token, conv.external_thread_id!, g.message.text)).commentId;
      } else {
        if (!conv.external_ref) throw new Error("This conversation has no video id.");
        const r = await api.postComment(token, conv.external_ref, g.message.text);
        externalId = r.commentId;
        await tx.query("update conversations set external_thread_id = $2 where id = $1", [g.message.conversation_id, r.threadId]);
      }
    } else {
      const api = apis.threads;
      if (!api) throw new Error("Threads posting is not available here.");
      if (!g.connection.external_account_id) throw new Error("The Threads account id is missing: reconnect Threads.");
      const token = await threadsToken(tx, g.connection, api);
      // Answer the latest thing the person said; the first message answers their post.
      const lastInbound = await tx.maybeOne<{ external_id: string }>(
        "select external_id from conversation_messages where conversation_id = $1 and direction = 'inbound' and external_id is not null order by occurred_at desc limit 1",
        [g.message.conversation_id],
      );
      const replyTo = lastInbound?.external_id ?? conv.external_ref;
      if (!replyTo) throw new Error("This conversation has no Threads post to reply to.");
      const r = await api.publish(token, g.connection.external_account_id, g.message.text, replyTo);
      externalId = r.id;
      permalink = r.permalink;
      if (!conv.external_thread_id) await tx.query("update conversations set external_thread_id = $2 where id = $1", [g.message.conversation_id, r.id]);
    }
    await tx.query(
      "insert into outbound_actions (workspace_id, product_id, connection_id, approval_item_id, action, dedupe_key, result, reason, policy_checks) values ($1,$2,$3,$4,$5,$6,'executed','posted after approval',$7)",
      [actor.workspaceId, productId, g.connection.id, g.approvalId, isReply ? "reply" : "publish", `${channel === "youtube" ? "yt" : channel}:${messageId}`, JSON.stringify(g.checks)],
    );
    await tx.query("update conversation_messages set status = 'posted', external_id = $2, occurred_at = now() where id = $1", [messageId, externalId]);
    await tx.query("update conversations set status = 'replied' where id = $1", [g.message.conversation_id]);
    await tx.query("update yt_videos set status = 'published' where conversation_id = $1", [g.message.conversation_id]);
    await tx.query("update social_posts set status = 'published' where conversation_id = $1", [g.message.conversation_id]);
    await tx.query("update channel_connections set last_health_at = now(), last_error = null where id = $1", [g.connection.id]);
    return { posted: true, reason: `${isReply ? "Reply" : "Comment"} posted on ${label}.`, permalink };
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
    return { posted: false, reason: `${label} refused: ${msg} Publishing is paused for ${hours} h.` };
  }
}

/**
 * The posting queue: approved, not yet posted comments and replies, oldest first. Each run posts at most one per
 * channel and product, and only when the gate allows it (limits, gap, active hours, account healthy). Waiting is not
 * an error and is not written to outbound_actions; only real attempts are.
 */
export async function drainQueue(tx: Tx, actor: Actor, productId: string, apisIn: WriteApis | YoutubeWriteApi, now = new Date()) {
  const apis = asApis(apisIn);
  await tx.query("update yt_settings set last_queue_check_at = now() where product_id = $1", [productId]);
  let total = 0;
  let posted = false;
  const reasons: string[] = [];
  for (const channel of ["youtube", "threads"] as const) {
    if (!apis[channel]) continue;
    const queued = await tx.query<{ id: string }>(
      `select m.id from conversation_messages m join conversations c on c.id = m.conversation_id
        where m.product_id = $1 and c.channel = $2 and m.direction = 'outbound' and m.status = 'approved'
          and (select a.state from approval_items a where a.conversation_message_id = m.id order by a.created_at desc limit 1) = 'approved'
        order by (c.risk = 'high') desc, m.created_at limit 20`,
      [productId, channel],
    );
    total += queued.length;
    if (!queued.length) continue;
    const gate = await postGate(tx, productId, queued[0].id, now);
    if (!gate.allowed) { reasons.push(gate.reason); continue; }
    const r = await postApproved(tx, actor, productId, queued[0].id, apis, now);
    if (r.posted) posted = true;
    reasons.push(r.reason);
  }
  return { queued: total, posted, reason: reasons.join(" ") || "Nothing approved is waiting." };
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

/** Reads likes and reply counts for everything we posted and stores them on the messages (cumulative counters). */
export async function refreshCommentStats(tx: Tx, productId: string, read: (commentIds: string[], threadIds: string[]) => Promise<Array<{ id: string; likeCount: number; replyCount: number | null }>>) {
  const rows = await tx.query<{ id: string; external_id: string; thread: string | null; top: boolean }>(
    `select m.id, m.external_id, c.external_thread_id thread, (m.variant is distinct from 'reply' and m.variant is distinct from 'safety') top
       from conversation_messages m join conversations c on c.id = m.conversation_id
      where m.product_id = $1 and c.channel = 'youtube' and m.direction = 'outbound' and m.status = 'posted' and m.external_id is not null
      order by m.stats_checked_at nulls first limit 200`,
    [productId],
  );
  if (!rows.length) return { checked: 0 };
  const threads = rows.filter((r) => r.top && r.thread).map((r) => r.thread!);
  const stats = await read(rows.filter((r) => !r.top || !r.thread).map((r) => r.external_id), threads);
  const byId = new Map(stats.map((s) => [s.id, s]));
  for (const r of rows) {
    const s = byId.get(r.top && r.thread ? r.thread : r.external_id) ?? byId.get(r.external_id);
    if (!s) continue; // deleted or held for review by YouTube: keep the last known numbers
    await tx.query("update conversation_messages set like_count = $2, reply_count = $3, stats_checked_at = now() where id = $1", [r.id, s.likeCount, s.replyCount]);
  }
  return { checked: rows.length };
}
