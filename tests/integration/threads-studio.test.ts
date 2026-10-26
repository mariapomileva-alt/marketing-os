/**
 * Threads Studio against the real database (RLS on, mock AI): a batch of our own posts is written and waits for
 * approval; one click approves the exact text and places it on the next free posting time; an edited text is checked
 * again and a blocked one is never approved; reactions are read back onto each post.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withContext, type Tx } from "@/server/db/client";
import { createBackApp } from "@/server/services/products";
import { decideApproval, type Actor } from "@/server/services/content";
import { approveThreadsPost, generateThreadsPosts, getStudioSettings, nextThreadsSlot, performanceSummary, refreshStudioStats, rejectThreadsPost, scheduleApprovedStudioPosts, studioPosts, updateStudioSettings } from "@/server/services/threads-studio";
import { asUser, createOwner, pool } from "../helpers/db";

let owner: { userId: string; workspaceId: string };
let actor: Actor;
let productId: string;
const as = <T>(fn: (tx: Tx) => Promise<T>) => asUser(owner.userId, fn);
const rigaHHMM = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Riga" }).format(d);

beforeAll(async () => {
  owner = await createOwner();
  actor = { workspaceId: owner.workspaceId, userId: owner.userId };
  productId = (await as((tx) => createBackApp(tx, owner.workspaceId))).id;
}, 60_000);
afterAll(closePools);

describe("Threads Studio", () => {
  let ids: string[] = [];

  it("starts with two posts a day at 09:30 and 19:30", async () => {
    const s = await as((tx) => getStudioSettings(tx, owner.workspaceId, productId));
    expect(s).toMatchObject({ enabled: true, posts_per_day: 2, slots: ["09:30", "19:30"] });
    await expect(as((tx) => updateStudioSettings(tx, owner.workspaceId, productId, { ...s, slots: ["9.30"] }))).rejects.toThrow();
  });

  it("writes a batch that waits for approval and never posts by itself", async () => {
    const r = await as((tx) => generateThreadsPosts(tx, actor, productId));
    expect(r.isMock).toBe(true);
    expect(r.created).toHaveLength(2);
    const posts = await as((tx) => studioPosts(tx, productId));
    ids = posts.map((p) => p.id);
    expect(posts.every((p) => p.status === "needs_human_review")).toBe(true);
    const pending = await as((tx) => tx.one<{ n: number }>(
      "select count(*)::int n from approval_items a join content_items i on i.current_version_id = a.content_version_id where i.id = any($1) and a.state = 'pending'", [ids]));
    expect(pending.n).toBe(2);
  });

  it("approves the exact text and places it on the next free posting time", async () => {
    const edited = "When panic rises at night, try naming three sounds you can hear. Small, concrete, and it gives your mind somewhere to land.";
    const a = await as((tx) => approveThreadsPost(tx, actor, productId, ids[0], edited));
    const b = await as((tx) => approveThreadsPost(tx, actor, productId, ids[1]));
    expect(["09:30", "19:30"]).toContain(rigaHHMM(a.scheduledFor));
    expect(["09:30", "19:30"]).toContain(rigaHHMM(b.scheduledFor));
    expect(Math.abs(a.scheduledFor.getTime() - b.scheduledFor.getTime())).toBeGreaterThanOrEqual(45 * 60_000);
    const p = (await as((tx) => studioPosts(tx, productId))).find((x) => x.id === ids[0])!;
    expect(p.status).toBe("scheduled");
    expect(p.text).toBe(edited);
    await expect(as((tx) => approveThreadsPost(tx, actor, productId, ids[0]))).rejects.toThrow(/already approved/);
  });

  it("does not approve a text the safety rules stop", async () => {
    const r = await as((tx) => generateThreadsPosts(tx, actor, productId, 1));
    const id = r.created[0].id;
    await expect(as((tx) => approveThreadsPost(tx, actor, productId, id, "Back will cure your panic attacks forever, guaranteed."))).rejects.toThrow(/safety rules/);
    const st = await as((tx) => tx.one<{ status: string }>("select status from content_items where id = $1", [id]));
    expect(st.status).not.toBe("scheduled");
    await as((tx) => rejectThreadsPost(tx, actor, productId, id));
    expect((await as((tx) => tx.one<{ status: string }>("select status from content_items where id = $1", [id]))).status).toBe("rejected");
  });

  it("finds the next free slot after the taken ones", async () => {
    const now = new Date("2030-03-10T05:00:00Z"); // 07:00 in Riga
    const first = await as((tx) => nextThreadsSlot(tx, productId, ["09:30", "19:30"], now));
    expect(rigaHHMM(first)).toBe("09:30");
    expect(first.toISOString().slice(0, 10)).toBe("2030-03-10");
    const late = await as((tx) => nextThreadsSlot(tx, productId, ["09:30", "19:30"], new Date("2030-03-10T17:25:00Z"))); // 19:25 Riga, too close
    expect(late.toISOString().slice(0, 10)).toBe("2030-03-11");
    expect(rigaHHMM(late)).toBe("09:30");
  });

  it("gives posts approved in the Approval Queue a posting time", async () => {
    const r = await as((tx) => generateThreadsPosts(tx, actor, productId, 1));
    const id = r.created[0].id;
    // Approved in the Approval Queue, not in the studio: no posting time yet.
    await as(async (tx) => {
      const a = await tx.one<{ id: string }>("select a.id from approval_items a join content_items i on i.current_version_id = a.content_version_id where i.id = $1 and a.state = 'pending'", [id]);
      await decideApproval(tx, actor, productId, a.id, "approved", "test");
    });
    expect((await as((tx) => tx.one<{ status: string }>("select status from content_items where id = $1", [id]))).status).toBe("approved");
    expect(await as((tx) => scheduleApprovedStudioPosts(tx, productId))).toBe(1);
    const st = await as((tx) => tx.one<{ status: string; scheduled_for: string | null }>("select status, scheduled_for from content_items where id = $1", [id]));
    expect(st.status).toBe("scheduled");
    expect(st.scheduled_for).not.toBeNull();
  });

  it("reads reactions back onto each published post", async () => {
    await withContext({ userId: null, role: "service", actorType: "system" }, async (tx) => {
      await tx.query(
        `insert into publications (workspace_id, product_id, content_item_id, content_version_id, channel, method, external_id, approval_item_id)
         select i.workspace_id, i.product_id, i.id, i.current_version_id, 'threads', 'api', 'ext-1', a.id
           from content_items i join approval_items a on a.content_version_id = i.current_version_id and a.state = 'approved' where i.id = $1`,
        [ids[0]],
      );
      await tx.query("update content_items set status = 'published' where id = $1", [ids[0]]);
    }, pool());
    const r = await as((tx) => refreshStudioStats(tx, productId, async () => ({ views: 400, likes: 12, replies: 3, reposts: 2, quotes: 1 })));
    expect(r.checked).toBe(1);
    const p = (await as((tx) => studioPosts(tx, productId))).find((x) => x.id === ids[0])!;
    expect(p).toMatchObject({ views: 400, likes: 12, replies: 3, reposts: 2, quotes: 1 });
    const perf = await as((tx) => performanceSummary(tx, productId));
    expect(perf.by_format[0].avg_views).toBe(400);
    expect(perf.note).toMatch(/early signal/);
  });
});
