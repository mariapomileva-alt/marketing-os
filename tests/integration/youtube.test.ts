/**
 * YouTube community flow against the real database (RLS on, mock AI, demo videos): discovery records every video
 * with a reason, drafts only for suitable ones, drafts never repeat each other, high-risk replies get a product-free
 * safety note, and nothing can be published without approval (publishing is off by default).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, type Tx } from "@/server/db/client";
import { createBackApp } from "@/server/services/products";
import { decideApproval, type Actor } from "@/server/services/content";
import { getYtSettings, publishGate, receiveReply, runDiscovery, updateYtSettings } from "@/server/services/youtube";
import { demoSource } from "@/server/youtube/source";
import { similarity } from "@/domain/youtube";
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
    expect(afterApproval.reason).toMatch(/turned off/);
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
