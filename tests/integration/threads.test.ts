/**
 * Threads and Instagram community flow against the real database (RLS on, mock AI): search records every post with
 * a reason, ads and crises are skipped, drafts go to approval, approved replies are posted to the right post through
 * the gate, replies people write back are read and answered as drafts. Instagram is drafted and posted by hand.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, type Tx } from "@/server/db/client";
import { createBackApp } from "@/server/services/products";
import type { Actor } from "@/server/services/content";
import { approveDraft } from "@/server/services/youtube";
import { addInstagramReel, getThreadsSettings, judgePost, runThreadsDiscovery, syncThreadsReplies, updateThreadsSettings, type FoundPost, type PostSource } from "@/server/services/threads";
import { postApproved, postGate, saveTokenConnection, type ThreadsWriteApi } from "@/server/services/youtube-publish";
import { syncInstagramComments } from "@/server/services/instagram";
import { asUser, createOwner } from "../helpers/db";

let owner: { userId: string; workspaceId: string };
let actor: Actor;
let productId: string;
const as = <T>(fn: (tx: Tx) => Promise<T>) => asUser(owner.userId, fn);

const POSTS: FoundPost[] = [
  { id: "p1", username: "nora", permalink: "https://www.threads.com/@nora/post/1", timestamp: "2026-10-22T08:00:00Z", text: "does anyone else get panic attacks right before falling asleep? my heart decides to sprint every night" },
  { id: "p2", username: "promo", permalink: null, timestamp: null, text: "Use code CALM20 for our panic attack course, link in bio!" },
  { id: "p3", username: "sam", permalink: null, timestamp: null, text: "panic attack again and honestly I don't want to live like this anymore" },
  { id: "p4", username: "back.app", permalink: null, timestamp: null, text: "Our own post about panic attacks and the first minute" },
];
const source: PostSource = { kind: "demo", search: async () => POSTS };

beforeAll(async () => {
  owner = await createOwner();
  actor = { workspaceId: owner.workspaceId, userId: owner.userId };
  productId = (await as((tx) => createBackApp(tx, owner.workspaceId))).id;
  await as(async (tx) => {
    const s = await getThreadsSettings(tx, owner.workspaceId, productId);
    await updateThreadsSettings(tx, owner.workspaceId, productId, { ...s, enabled: true, queries: ["panic attack"] });
  });
}, 60_000);
afterAll(closePools);

describe("judging posts", () => {
  it("skips ads, crises, our own posts and short posts", () => {
    expect(judgePost(POSTS[0], ["panic attack"], "back.app", null, 30).eligible).toBe(true);
    expect(judgePost(POSTS[1], ["panic attack"], "back.app", null, 30).flags.join(" ")).toMatch(/ad/);
    expect(judgePost(POSTS[2], ["panic attack"], "back.app", null, 30).flags.join(" ")).toMatch(/crisis/);
    expect(judgePost(POSTS[3], ["panic attack"], "back.app", null, 30).flags.join(" ")).toMatch(/own/);
    expect(judgePost(POSTS[0], ["panic attack"], null, new Date(), 30).flags.join(" ")).toMatch(/last 30 days/);
  });
});

describe("Threads", () => {
  const published: Array<{ text: string; replyTo: string | null }> = [];
  const api: ThreadsWriteApi & { replies: (t: string, id: string) => Promise<FoundPost[]>; insights: () => Promise<{ views: number; likes: number; replies: number; reposts: number; quotes: number }> } = {
    publish: async (_t, _u, text, replyTo) => { published.push({ text, replyTo }); return { id: `m${published.length}`, permalink: null }; },
    refresh: async () => ({ accessToken: "new-token", expiresAt: new Date(Date.now() + 60 * 86_400_000) }),
    replies: async (_t, id) => (id === "m1" ? [{ id: "r1", username: "nora", permalink: null, timestamp: "2026-10-23T09:00:00Z", text: "omg yes, and then I can't stop checking my pulse. what helps you?" }, { id: "r2", username: "back.app", permalink: null, timestamp: null, text: "our own" }] : []),
    insights: async () => ({ views: 10, likes: 2, replies: 1, reposts: 0, quotes: 0 }),
  };

  it("records every post with a reason and drafts only for suitable ones", async () => {
    const stats = await as((tx) => runThreadsDiscovery(tx, actor, productId, source, "back.app"));
    expect(stats.found).toBe(4);
    expect(stats.eligible).toBe(1);
    expect(stats.draftsQueued).toBeGreaterThan(0);
    const again = await as((tx) => runThreadsDiscovery(tx, actor, productId, source, "back.app"));
    expect(again.newPosts).toBe(0);
  });

  it("posts the approved reply under the person's post, then reads their answer", async () => {
    await as((tx) => saveTokenConnection(tx, owner.workspaceId, productId, "threads", { id: "u1", label: "@back.app" }, "long-token-123456", new Date(Date.now() + 30 * 86_400_000), ["threads_basic"]));
    await as((tx) => tx.query(`update channel_connections set limits = limits || '{"min_gap_minutes":0,"active_hours":{"start":0,"end":24,"tz":"UTC"}}'::jsonb where product_id = $1 and channel = 'threads'`, [productId]));
    const draft = await as((tx) => tx.one<{ id: string; conversation_id: string }>(
      "select m.id, m.conversation_id from conversation_messages m join conversations c on c.id = m.conversation_id where c.product_id = $1 and c.channel = 'threads' and m.status = 'draft' order by m.variant limit 1", [productId]));
    expect((await as((tx) => approveDraft(tx, actor, productId, draft.id, null))).ok).toBe(true);

    const off = await as((tx) => postGate(tx, productId, draft.id));
    expect(off.allowed).toBe(false);
    expect(off.reason).toMatch(/switched off/);

    process.env.THREADS_PUBLISHING_ENABLED = "true";
    try {
      const r = await as((tx) => postApproved(tx, actor, productId, draft.id, { threads: api }));
      expect(r.posted).toBe(true);
      expect(published[0].replyTo).toBe("p1"); // answers the person's post
      const sync = await as((tx) => syncThreadsReplies(tx, actor, productId, api));
      expect(sync.fresh).toBe(1); // our own reply is ignored
      const thread = await as((tx) => tx.query<{ direction: string; author_handle: string | null; status: string }>(
        "select direction, author_handle, status from conversation_messages where conversation_id = $1 order by occurred_at, created_at", [draft.conversation_id]));
      expect(thread.some((m) => m.direction === "inbound" && m.author_handle === "@nora")).toBe(true);
      expect(thread.some((m) => m.direction === "outbound" && m.status === "draft")).toBe(true);
    } finally {
      delete process.env.THREADS_PUBLISHING_ENABLED;
    }
  });
});

describe("Instagram", () => {
  it("drafts a comment for a reel added by hand, to be posted by a person", async () => {
    const r = await as((tx) => addInstagramReel(tx, actor, productId, { url: "https://www.instagram.com/reel/abc/", author: "@calmcoach", text: "Three things to do in the first minute of a panic attack: feet on the floor, name five colours, slow exhale." }));
    expect(r.queued).toBeGreaterThan(0);
    const m = await as((tx) => tx.one<{ id: string }>(
      "select m.id from conversation_messages m join conversations c on c.id = m.conversation_id where c.product_id = $1 and c.channel = 'instagram' and m.status = 'draft' limit 1", [productId]));
    await as((tx) => approveDraft(tx, actor, productId, m.id, null));
    process.env.THREADS_PUBLISHING_ENABLED = "true";
    try {
      const g = await as((tx) => postGate(tx, productId, m.id));
      expect(g.allowed).toBe(false);
      expect(g.reason).toMatch(/Instagram does not allow/);
    } finally {
      delete process.env.THREADS_PUBLISHING_ENABLED;
    }
  });

  it("does not draft for a reel about a crisis", async () => {
    const r = await as((tx) => addInstagramReel(tx, actor, productId, { url: "https://www.instagram.com/reel/def/", author: null, text: "I don't want to live anymore, every day is a panic attack" }));
    expect(r.skipped).toBe(true);
  });
});

describe("Instagram, comments under our own reels", () => {
  const sent: Array<{ commentId: string; text: string }> = [];
  let comments = [
    { id: "c1", text: "this is exactly what happens to me on the bus, my hands go numb", username: "mila", timestamp: "2026-10-23T08:00:00Z", like_count: 3, replies: [] as Array<{ id: string; text: string; username: string | null; timestamp: string | null }> },
    { id: "c2", text: "thanks from the team!", username: "backapp.live", timestamp: "2026-10-23T08:05:00Z", like_count: 0, replies: [] },
  ];
  const api = {
    media: async () => [{ id: "media1", caption: "The first minute of panic", permalink: "https://www.instagram.com/reel/x/", timestamp: null, comments_count: 2, like_count: 10, media_product_type: "REELS" }],
    comments: async () => comments,
    reply: async (_t: string, commentId: string, text: string) => { sent.push({ commentId, text }); return { id: `rep${sent.length}` }; },
    refresh: async () => ({ accessToken: "t2", expiresAt: new Date(Date.now() + 60 * 86_400_000) }),
  };

  it("drafts answers to people's comments, posts the approved one under their comment, and reads their next reply", async () => {
    await as((tx) => saveTokenConnection(tx, owner.workspaceId, productId, "instagram", { id: "ig1", label: "@backapp.live" }, "ig-token-123456", new Date(Date.now() + 30 * 86_400_000), ["instagram_business_basic"]));
    await as((tx) => tx.query(`update channel_connections set limits = limits || '{"min_gap_minutes":0,"active_hours":{"start":0,"end":24,"tz":"UTC"}}'::jsonb where product_id = $1 and channel = 'instagram'`, [productId]));
    const first = await as((tx) => syncInstagramComments(tx, actor, productId, api));
    expect(first.fresh).toBe(1); // our own comment is skipped
    expect((await as((tx) => syncInstagramComments(tx, actor, productId, api))).fresh).toBe(0);

    const draft = await as((tx) => tx.one<{ id: string; conversation_id: string }>(
      `select m.id, m.conversation_id from conversation_messages m join conversations c on c.id = m.conversation_id
        where c.product_id = $1 and c.channel = 'instagram' and c.external_thread_id = 'c1' and m.status = 'draft' limit 1`, [productId]));
    await as((tx) => approveDraft(tx, actor, productId, draft.id, null));
    process.env.INSTAGRAM_PUBLISHING_ENABLED = "true";
    try {
      const r = await as((tx) => postApproved(tx, actor, productId, draft.id, { instagram: api }));
      expect(r.posted).toBe(true);
      expect(sent[0].commentId).toBe("c1");
    } finally {
      delete process.env.INSTAGRAM_PUBLISHING_ENABLED;
    }
    comments = [{ ...comments[0], replies: [{ id: "rep1", text: "ours", username: "backapp.live", timestamp: null }, { id: "c1r", text: "oh that helps, I'll try it tomorrow", username: "mila", timestamp: "2026-10-23T10:00:00Z" }] }];
    expect((await as((tx) => syncInstagramComments(tx, actor, productId, api))).fresh).toBe(1);
  });
});
