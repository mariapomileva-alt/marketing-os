/**
 * YouTube community flow against the real database (RLS on, mock AI, demo videos): discovery records every video
 * with a reason, drafts only for suitable ones, drafts never repeat each other, high-risk replies get a product-free
 * safety note, and nothing can be published without approval (publishing is off by default).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, type Tx } from "@/server/db/client";
import { createBackApp } from "@/server/services/products";
import { decideApproval, type Actor } from "@/server/services/content";
import { getYtSettings, receiveReply, runDiscovery, updateYtSettings } from "@/server/services/youtube";
import { drainQueue, refreshCommentStats, postGate as publishGate, postApproved, saveYoutubeConnection, syncReplies, type YoutubeWriteApi } from "@/server/services/youtube-publish";
import { demoSource } from "@/server/youtube/source";
import { similarity } from "@/domain/youtube";
import { youtubeCommentTotals } from "@/server/services/traffic";
import { asUser, createOwner } from "../helpers/db";

let owner: { userId: string; workspaceId: string };
let actor: Actor;
let productId: string;
const as = <T>(fn: (tx: Tx) => Promise<T>) => asUser(owner.userId, fn);

beforeAll(async () => {
  owner = await createOwner();
  actor = { workspaceId: owner.workspaceId, userId: owner.userId };
  productId = (await as((tx) => createBackApp(tx, owner.workspaceId))).id;
  await as(async (tx) => {
    const s = await getYtSettings(tx, owner.workspaceId, productId);
    await updateYtSettings(tx, owner.workspaceId, productId, { ...s, enabled: true, brand_name: "Back", queries: ["panic attack"] });
  });
}, 60_000);
afterAll(closePools);

describe("discovery", () => {
  it("records every video with a reason and drafts only for suitable ones", async () => {
    const stats = await as((tx) => runDiscovery(tx, actor, productId, demoSource(), new Date()));
    expect(stats.found).toBe(7);
    expect(stats.newVideos).toBe(7);
    expect(stats.eligible).toBe(4);
    expect(stats.drafted).toBe(3); // drafts_per_run
    const videos = await as((tx) => tx.query<{ title: string; status: string; reason: string }>("select title, status, reason from yt_videos where product_id = $1", [productId]));
    const byTitle = (t: string) => videos.find((v) => v.title.includes(t))!;
    expect(byTitle("#shorts").status).toBe("skipped");
    expect(byTitle("Cure panic attacks forever").status).toBe("skipped");
    expect(byTitle("morning routine").status).toBe("skipped");
    expect(videos.every((v) => v.reason.length > 0)).toBe(true);
  });

  it("does not record the same video twice", async () => {
    const stats = await as((tx) => runDiscovery(tx, actor, productId, demoSource(), new Date()));
    expect(stats.newVideos).toBe(0);
  });

  it("queues drafts that differ from each other and disclose the team when they mention Back", async () => {
    const drafts = await as((tx) =>
      tx.query<{ text: string; variant: string; mentions_product: boolean; conversation_id: string }>(
        "select m.text, m.variant, m.mentions_product, m.conversation_id from conversation_messages m join approval_items a on a.conversation_message_id = m.id where m.product_id = $1 and a.state = 'pending'",
        [productId],
      ),
    );
    expect(drafts.length).toBeGreaterThanOrEqual(3);
    for (const d of drafts.filter((x) => x.mentions_product)) expect(d.text).toMatch(/We're building Back|I'm on the team/);
    const helpful = drafts.filter((d) => d.variant === "helpful");
    for (let i = 0; i < helpful.length; i++) for (let j = i + 1; j < helpful.length; j++) expect(similarity(helpful[i].text, helpful[j].text)).toBeLessThan(0.35);
  });
});

describe("replies", () => {
  it("answers a high-risk message only with a product-free safety note, flagged for a person", async () => {
    const conv = await as((tx) => tx.one<{ id: string }>("select id from conversations where product_id = $1 and channel = 'youtube' order by created_at limit 1", [productId]));
    const r = await as((tx) => receiveReply(tx, actor, productId, conv.id, "@someone", "Honestly I don't want to live like this anymore"));
    expect(r.risk).toBe("high");
    const state = await as((tx) => tx.one<{ risk: string; sensitive: boolean }>("select risk, sensitive from conversations where id = $1", [conv.id]));
    expect(state).toEqual({ risk: "high", sensitive: true });
    const note = await as((tx) => tx.one<{ text: string; variant: string; agent_run_id: string | null; reason_in_queue: string }>(
      "select m.text, m.variant, m.agent_run_id, a.reason_in_queue from conversation_messages m join approval_items a on a.conversation_message_id = m.id where m.conversation_id = $1 and m.variant = 'safety'", [conv.id]));
    expect(note.text).not.toMatch(/\bBack\b/);
    expect(note.agent_run_id).toBeNull(); // not AI-written
    expect(note.reason_in_queue).toMatch(/HIGH RISK/);
  });

  it("drafts an ordinary reply for approval with the drafter's reading of the message", async () => {
    const conv = await as((tx) => tx.one<{ id: string }>("select id from conversations where product_id = $1 and channel = 'youtube' order by created_at desc limit 1", [productId]));
    const r = await as((tx) => receiveReply(tx, actor, productId, conv.id, "@friend", "What is this app called?"));
    expect(r.kind).toBe("question_about_back");
    const item = await as((tx) => tx.one<{ reason_in_queue: string; state: string }>(
      "select a.reason_in_queue, a.state from approval_items a join conversation_messages m on m.id = a.conversation_message_id where m.conversation_id = $1 and m.variant = 'reply'", [conv.id]));
    expect(item.state).toBe("pending");
    expect(item.reason_in_queue).toMatch(/What they mean/);
  });
});

describe("publishing", () => {
  it("is impossible without approval, and off by default even after approval", async () => {
    const m = await as((tx) => tx.one<{ id: string; approval_id: string }>(
      "select m.id, a.id approval_id from conversation_messages m join approval_items a on a.conversation_message_id = m.id where m.product_id = $1 and a.state = 'pending' and m.variant = 'helpful' limit 1", [productId]));
    const before = await as((tx) => publishGate(tx, productId, m.id));
    expect(before.allowed).toBe(false);

    process.env.YOUTUBE_PUBLISHING_ENABLED = "true";
    try {
      const enabledNoApproval = await as((tx) => publishGate(tx, productId, m.id));
      expect(enabledNoApproval.allowed).toBe(false);
      expect(enabledNoApproval.checks.find((c) => c.name === "human_approval")?.ok).toBe(false);
    } finally {
      delete process.env.YOUTUBE_PUBLISHING_ENABLED;
    }

    await as((tx) => decideApproval(tx, actor, productId, m.approval_id, "approved", "ok"));
    const afterApproval = await as((tx) => publishGate(tx, productId, m.id));
    expect(afterApproval.allowed).toBe(false);
    expect(afterApproval.reason).toMatch(/switched off/);
  });
});

describe("approving from the thread view", () => {
  it("re-checks edited text, approves exactly that text and closes the other variant", async () => {
    const { approveDraft } = await import("@/server/services/youtube");
    const conv = await as((tx) => tx.one<{ id: string }>(
      `select c.id from conversations c where c.product_id = $1 and c.channel = 'youtube'
         and exists (select 1 from conversation_messages m where m.conversation_id = c.id and m.status = 'draft' and m.variant = 'helpful')
       order by (select count(*) from conversation_messages m where m.conversation_id = c.id and m.status = 'draft') desc limit 1`, [productId]));
    const drafts = await as((tx) => tx.query<{ id: string; variant: string }>("select id, variant from conversation_messages where conversation_id = $1 and status = 'draft' order by variant", [conv.id]));
    const helpful = drafts.find((d) => d.variant === "helpful")!;

    const bad = await as((tx) => approveDraft(tx, actor, productId, helpful.id, "Great video! Download Back, the best app."));
    expect(bad.ok).toBe(false);

    const text = "That bit about the first thirty seconds being the hardest is so true. Does anyone else notice it gets a little easier once you name what's happening?";
    const good = await as((tx) => approveDraft(tx, actor, productId, helpful.id, text));
    expect(good.ok).toBe(true);
    const after = await as((tx) => tx.query<{ variant: string; status: string; text: string }>("select variant, status, text from conversation_messages where conversation_id = $1 and variant in ('helpful','with_mention')", [conv.id]));
    expect(after.find((m) => m.variant === "helpful")).toMatchObject({ status: "approved", text });
    const sibling = after.find((m) => m.variant === "with_mention");
    if (sibling) expect(sibling.status).toBe("rejected"); // either chosen-away or held back by the checks
    const approved = await as((tx) => tx.one<{ text: string }>(
      "select a.payload_snapshot->>'text' text from approval_items a join conversation_messages m on m.id = a.conversation_message_id where m.id = $1 and a.state = 'approved'", [helpful.id]));
    expect(approved.text).toBe(text);
  });
});


describe("posting after approval and reading replies", () => {
  const posted: string[] = [];
  let replies: Array<{ id: string; authorChannelId: string | null; authorName: string; text: string; publishedAt: string }> = [];
  const api: YoutubeWriteApi = {
    accessToken: async () => "access",
    postComment: async (_t, videoId, text) => { posted.push(`comment:${videoId}:${text}`); return { threadId: "Ugthread1", commentId: "Ugthread1" }; },
    postReply: async (_t, threadId, text) => { posted.push(`reply:${threadId}:${text}`); return { commentId: `r${posted.length}` }; },
    listReplies: async () => replies,
  };

  it("posts the approved comment, records it, then reads replies and drafts an answer", async () => {
    await as((tx) => saveYoutubeConnection(tx, owner.workspaceId, productId, { id: "UCback", title: "Back" }, "refresh-token-xyz"));
    // Tests run at any hour: open the window and drop the gap so only the rules under test decide.
    await as((tx) => tx.query(`update channel_connections set limits = limits || '{"min_gap_minutes":0,"active_hours":{"start":0,"end":24,"tz":"UTC"}}'::jsonb where product_id = $1 and channel = 'youtube' and status <> 'revoked'`, [productId]));
    process.env.YOUTUBE_PUBLISHING_ENABLED = "true";
    try {
      const m = await as((tx) => tx.one<{ id: string }>(
        "select m.id from conversation_messages m join approval_items a on a.conversation_message_id = m.id where m.product_id = $1 and a.state = 'approved' and m.status = 'approved' limit 1", [productId]));
      // 12:00 Riga is inside active hours
      const r = await as((tx) => postApproved(tx, actor, productId, m.id, api, new Date()));
      expect(r.reason).toBe("Comment posted on YouTube.");
      expect(posted[0]).toMatch(/^comment:/);
      const conv = await as((tx) => tx.one<{ id: string; external_thread_id: string; status: string }>(
        "select c.id, c.external_thread_id, m.status from conversations c join conversation_messages m on m.conversation_id = c.id where m.id = $1", [m.id]));
      expect(conv).toMatchObject({ external_thread_id: "Ugthread1", status: "posted" });

      // posting twice is refused (dedupe)
      const again = await as((tx) => postApproved(tx, actor, productId, m.id, api, new Date()));
      expect(again.posted).toBe(false);

      replies = [
        { id: "rep1", authorChannelId: "UCviewer", authorName: "@maya", text: "Yes!! the second-guessing is the worst part for me", publishedAt: "2026-10-23T10:00:00Z" },
        { id: "rep2", authorChannelId: "UCback", authorName: "Back", text: "our own reply", publishedAt: "2026-10-23T10:05:00Z" },
      ];
      const sync = await as((tx) => syncReplies(tx, actor, productId, api));
      expect(sync.fresh).toBe(1);
      const sync2 = await as((tx) => syncReplies(tx, actor, productId, api));
      expect(sync2.fresh).toBe(0);
      const thread = await as((tx) => tx.query<{ direction: string; author_handle: string | null; status: string; variant: string | null }>(
        "select direction, author_handle, status, variant from conversation_messages where conversation_id = $1 order by occurred_at, created_at", [conv.id]));
      expect(thread.some((x) => x.direction === "inbound" && x.author_handle === "@maya")).toBe(true);
      expect(thread.some((x) => x.direction === "outbound" && x.variant === "reply" && x.status === "draft")).toBe(true);
    } finally {
      delete process.env.YOUTUBE_PUBLISHING_ENABLED;
    }
  });

  it("pauses the channel when YouTube refuses, instead of retrying", async () => {
    process.env.YOUTUBE_PUBLISHING_ENABLED = "true";
    try {
      const reply = await as((tx) => tx.one<{ id: string; approval: string }>(
        `select m.id, a.id approval from conversation_messages m join approval_items a on a.conversation_message_id = m.id
          where m.product_id = $1 and m.variant = 'reply' and m.status = 'draft' and a.state = 'pending' order by m.created_at desc limit 1`, [productId]));
      await as((tx) => decideApproval(tx, actor, productId, reply.approval, "approved", "ok"));
      const failing: YoutubeWriteApi = { ...api, postReply: async () => { throw new Error("YouTube 403 forbidden: commentsDisabled"); } };
      const r = await as((tx) => postApproved(tx, actor, productId, reply.id, failing, new Date()));
      expect(r.reason).toMatch(/YouTube refused/);
      const c = await as((tx) => tx.one<{ status: string }>("select status from channel_connections where product_id = $1 and channel = 'youtube' and status <> 'revoked'", [productId]));
      expect(c.status).toBe("paused");
    } finally {
      delete process.env.YOUTUBE_PUBLISHING_ENABLED;
    }
  });

  it("posts approved texts from the queue one at a time, within the gap", async () => {
    process.env.YOUTUBE_PUBLISHING_ENABLED = "true";
    try {
      await as((tx) => tx.query("update channel_connections set status = 'connected', paused_until = null, paused_reason = null where product_id = $1 and channel = 'youtube' and status <> 'revoked'", [productId]));
      const conv = await as((tx) => tx.one<{ id: string }>("select id from conversations where product_id = $1 and external_thread_id is not null limit 1", [productId]));
      const approveNewReply = async (text: string) => {
        await as((tx) => receiveReply(tx, actor, productId, conv.id, "@lee", text));
        const d = await as((tx) => tx.one<{ approval: string }>(
          `select a.id approval from conversation_messages m join approval_items a on a.conversation_message_id = m.id
            where m.conversation_id = $1 and m.status = 'draft' and a.state = 'pending' order by m.created_at desc limit 1`, [conv.id]));
        await as((tx) => decideApproval(tx, actor, productId, d.approval, "approved", "ok"));
      };
      // the reply approved in the previous test is still queued; drain it first
      await as((tx) => tx.query("update outbound_actions set created_at = now() - interval '1 hour' where product_id = $1", [productId]));
      const before = posted.length;
      const first = await as((tx) => drainQueue(tx, actor, productId, api));
      expect(first.posted).toBe(true);
      expect(posted.length).toBe(before + 1);

      await approveNewReply("How do you remember to do it when it starts?");
      await as((tx) => tx.query(`update channel_connections set limits = limits || '{"min_gap_minutes":10}'::jsonb where product_id = $1 and channel = 'youtube' and status <> 'revoked'`, [productId]));
      const waiting = await as((tx) => drainQueue(tx, actor, productId, api));
      expect(waiting.posted).toBe(false);
      expect(waiting.queued).toBeGreaterThan(0);
      expect(waiting.reason).toMatch(/min_gap/);
      expect(posted.length).toBe(before + 1); // nothing extra went out
    } finally {
      delete process.env.YOUTUBE_PUBLISHING_ENABLED;
    }
  });

  it("stores likes and reply counts for what we posted", async () => {
    const reader = async (commentIds: string[], threadIds: string[]) => [
      ...threadIds.map((id) => ({ id, likeCount: 7, replyCount: 2 })),
      ...commentIds.map((id) => ({ id, likeCount: 1, replyCount: null })),
    ];
    const r = await as((tx) => refreshCommentStats(tx, productId, reader));
    expect(r.checked).toBeGreaterThan(0);
    const totals = await as((tx) => youtubeCommentTotals(tx, productId, new Date(Date.now() - 86_400_000)));
    expect(totals.posted).toBeGreaterThan(0);
    expect(totals.likes).toBeGreaterThanOrEqual(7);
    expect(totals.replies_received).toBeGreaterThanOrEqual(2);
  });
});
