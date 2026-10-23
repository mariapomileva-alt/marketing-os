import type { Tx } from "@/server/db/client";
import type { Actor } from "./content";
import { receiveReply } from "./youtube";
import { classifyMessage } from "@/domain/youtube";
import { channelConnection, threadsToken, type InstagramWriteApi } from "./youtube-publish";
import type { IgComment, IgMedia } from "@/server/instagram/api";

export interface InstagramReadApi {
  media(token: string): Promise<IgMedia[]>;
  comments(token: string, mediaId: string): Promise<IgComment[]>;
}

/**
 * Comments under our own reels and posts: each person's top-level comment is a conversation (one level deep, as on
 * Instagram). New comments and new replies from people get an answer drafted for approval; our own are skipped.
 */
export async function syncInstagramComments(tx: Tx, actor: Actor, productId: string, api: InstagramReadApi & Pick<InstagramWriteApi, "refresh">) {
  const conn = await channelConnection(tx, productId, "instagram");
  if (!conn) return { media: 0, fresh: 0, highRisk: 0, errors: [] as string[] };
  const token = await threadsToken(tx, conn, api);
  const own = conn.account_label.replace(/^@/, "").toLowerCase();
  const ours = (u: string | null) => Boolean(own && u?.toLowerCase() === own);
  let fresh = 0;
  let highRisk = 0;
  const errors: string[] = [];
  const media = (await api.media(token)).filter((m) => m.comments_count > 0);
  for (const m of media) {
    try {
      for (const c of await api.comments(token, m.id)) {
        let conv = await tx.maybeOne<{ id: string }>("select id from conversations where product_id = $1 and channel = 'instagram' and external_thread_id = $2", [productId, c.id]);
        const known = conv
          ? new Set((await tx.query<{ external_id: string }>("select external_id from conversation_messages where conversation_id = $1 and external_id is not null", [conv.id])).map((r) => r.external_id))
          : new Set<string>();
        const incoming = [{ id: c.id, text: c.text, username: c.username, timestamp: c.timestamp }, ...c.replies]
          .filter((x) => !known.has(x.id) && !ours(x.username) && x.text.trim())
          .sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""));
        if (!incoming.length) continue;
        if (!conv) {
          if (ours(c.username)) continue; // a thread we started ourselves under our own post
          const caption = m.caption.replace(/\s+/g, " ").slice(0, 70) || "our reel";
          conv = await tx.one<{ id: string }>(
            `insert into conversations (workspace_id, product_id, channel, thread_url, status, external_ref, external_thread_id, subject, risk)
             values ($1,$2,'instagram',$3,'needs_reply',$4,$5,$6,'low') returning id`,
            [actor.workspaceId, productId, m.permalink, m.id, c.id, `Comment on our reel “${caption}”`],
          );
        }
        // One answer per sync: the latest message gets the draft, earlier ones are logged as context
        // (unless one of them sounds like a crisis: that always gets the safety handling).
        for (const [i, x] of incoming.entries()) {
          if (i < incoming.length - 1 && classifyMessage(x.text).risk !== "high") {
            await tx.query(
              "insert into conversation_messages (workspace_id, product_id, conversation_id, direction, author_handle, text, external_id, occurred_at) values ($1,$2,$3,'inbound',$4,$5,$6,coalesce($7::timestamptz, now()))",
              [actor.workspaceId, productId, conv.id, x.username ? `@${x.username}` : null, x.text, x.id, x.timestamp],
            );
            continue;
          }
          const r = await receiveReply(tx, actor, productId, conv.id, x.username ? `@${x.username}` : null, x.text, { externalId: x.id, occurredAt: x.timestamp ?? undefined });
          fresh++;
          if (r.risk === "high") highRisk++;
        }
      }
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { media: media.length, fresh, highRisk, errors };
}
