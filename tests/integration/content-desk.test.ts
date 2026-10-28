/**
 * Content desk against the real database (RLS on, mock AI, fake card drawing): the morning desk prepares carousels,
 * posts and article ideas with their research and hooks, all waiting for approval; approve (with edits redrawn and
 * re-checked) places each on the calendar; approved Instagram posts are published at their time only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withContext, type Tx } from "@/server/db/client";
import { createBackApp } from "@/server/services/products";
import type { Actor } from "@/server/services/content";
import { addOwnReel, approveDeskItem, claimReelJob, deskItems, finishReelRender, generateDesk, hookLines, nextDeskSlot, parseSlots, publishDueInstagramPosts, rejectDeskItem, rerenderReel, type DeskMedia, type IgImagesApi } from "@/server/services/content-desk";
import { asUser, createOwner, pool } from "../helpers/db";
import { reelSpecSchema } from "@/domain/ai/schemas";

let owner: { userId: string; workspaceId: string };
let actor: Actor;
let productId: string;
const as = <T>(fn: (tx: Tx) => Promise<T>) => asUser(owner.userId, fn);
const drawn: Array<{ format: string; titles: string[] }> = [];
const stored: string[] = [];
const media: DeskMedia = {
  render: async (format, slides) => { drawn.push({ format, titles: slides.map((s) => s.title) }); return slides.map(() => new Uint8Array([0xff, 0xd8])); },
  store: async (key) => void stored.push(key),
};
const riga = (d: Date) => new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Riga" }).format(d);

beforeAll(async () => {
  owner = await createOwner();
  actor = { workspaceId: owner.workspaceId, userId: owner.userId };
  productId = (await as((tx) => createBackApp(tx, owner.workspaceId))).id;
}, 60_000);
afterAll(closePools);

describe("content desk", () => {
  it("prepares a desk with research, three hooks and drawn cards, all waiting for approval", async () => {
    const r = await as((tx) => generateDesk(tx, actor, productId, media, { posts: 1, carousels: 1, articles: 1 }));
    expect(r.isMock).toBe(true);
    expect(r.created.map((c) => c.kind).sort()).toEqual(["article", "carousel", "post"]);
    const items = await as((tx) => deskItems(tx, productId));
    expect(items.every((i) => i.status === "needs_human_review")).toBe(true);
    const carousel = items.find((i) => i.kind === "carousel")!;
    expect(carousel.hooks).toHaveLength(3);
    expect(carousel.insight).toMatch(/3am/);
    expect(carousel.image_asset_ids).toHaveLength(4);
    expect(carousel.body.slides?.[0].title).toBe(carousel.hooks[carousel.chosen_hook].text);
    expect(items.find((i) => i.kind === "post")!.image_asset_ids).toHaveLength(1);
    expect(items.find((i) => i.kind === "article")!.image_asset_ids).toHaveLength(0);
    expect(drawn.map((d) => d.format).sort()).toEqual(["carousel", "static_concept"]);
  });

  it("approve with a different hook and caption: redrawn, re-checked and put on the calendar at a publishing time", async () => {
    const post = (await as((tx) => deskItems(tx, productId))).find((i) => i.kind === "post")!;
    const before = drawn.length;
    const a = await as((tx) => approveDeskItem(tx, actor, productId, post.id, media, { hookIndex: 1, caption: "A calmer caption.\n\n#panicattack" }));
    expect(riga(a.scheduledFor!)).toMatch(/ (09:30|14:00|20:00)$/);
    expect(drawn.length).toBe(before + 1);
    expect(drawn.at(-1)!.titles[0]).toBe(post.hooks[1].text);
    const after = (await as((tx) => deskItems(tx, productId))).find((i) => i.id === post.id)!;
    expect(after).toMatchObject({ status: "scheduled", chosen_hook: 1 });
    expect(after.body.caption).toBe("A calmer caption.\n\n#panicattack");
    await expect(as((tx) => approveDeskItem(tx, actor, productId, post.id, media))).rejects.toThrow(/already approved/);
  });

  it("does not approve a caption the safety rules stop", async () => {
    const carousel = (await as((tx) => deskItems(tx, productId))).find((i) => i.kind === "carousel")!;
    await expect(as((tx) => approveDeskItem(tx, actor, productId, carousel.id, media, { caption: "Back will cure your panic attacks, guaranteed." }))).rejects.toThrow(/safety rules/);
  });

  it("an article idea is planned for a Monday, Wednesday or Friday at 15:00", async () => {
    const art = (await as((tx) => deskItems(tx, productId))).find((i) => i.kind === "article")!;
    const a = await as((tx) => approveDeskItem(tx, actor, productId, art.id, media));
    expect(riga(a.scheduledFor!)).toMatch(/^(Mon|Wed|Fri) 15:00$/);
    expect(art.body.body).toMatch(/Search: /);
  });

  it("Instagram pieces share the daily publishing times, one piece per time", async () => {
    const now = new Date("2030-05-06T06:00:00Z"); // Mon 09:00 Riga
    const slots = { slots: ["20:00", "9:30", "14:00"] };
    expect(riga(await as((tx) => nextDeskSlot(tx, productId, "carousel", slots, now)))).toBe("Mon 09:30");
    expect(riga(await as((tx) => nextDeskSlot(tx, productId, "reel", slots, new Date("2030-05-06T07:10:00Z"))))).toBe("Mon 14:00");
    expect(() => parseSlots(["25:00"])).toThrow(/18:30/);
    expect(parseSlots(["9:30", "09:30", "20:00"])).toEqual(["09:30", "20:00"]);
  });

  it("a Reel can be a read-slowly or breathe-along Reel; each format checks its own lines", async () => {
    expect(reelSpecSchema.safeParse({ format: "read_slowly", intro_style: "dark", intro_lines: ["Read this slowly."], text_lines: ["One."] }).success).toBe(false);
    const ok = reelSpecSchema.parse({ format: "breathe_along", music: "airy", intro_style: "light", intro_lines: ["Three slow breaths."], text_lines: ["Shoulders down."] });
    expect(ok.scenes).toEqual([]);
    expect(reelSpecSchema.parse({ intro_style: "dark", intro_lines: ["Hi"], scenes: [{ shot: "home" }, { shot: "breathe" }] })).toMatchObject({ format: "scenes", music: "warm" });
  });

  it("publishes an approved post at its time only, with the approved caption and cards", async () => {
    const post = (await as((tx) => deskItems(tx, productId))).find((i) => i.kind === "post" && i.status === "scheduled")!;
    const calls: string[] = [];
    const api: IgImagesApi = {
      token: async () => ({ token: "t", igUserId: "ig1" }),
      fileUrl: async (p) => `https://storage/${p}`,
      image: async (_t, _u, url, caption, item) => { calls.push(`image ${item ? "item" : caption}`); return "c1"; },
      carousel: async () => "car1",
      reel: async () => "reel1",
      status: async () => "FINISHED",
      publish: async () => { calls.push("publish"); return "m1"; },
      permalink: async () => "https://www.instagram.com/p/abc/",
      enabled: true,
    };
    await withContext({ userId: null, role: "service", actorType: "system" }, (tx) =>
      tx.query("insert into channel_connections (workspace_id, product_id, channel, adapter_kind, account_label, external_account_id, mode, status) values ($1,$2,'instagram','official_api','@backapp.live','ig1','requires_approval','connected')", [owner.workspaceId, productId]), pool());
    expect(await as((tx) => publishDueInstagramPosts(tx, actor, productId, api))).toEqual([]); // not yet its time
    expect((await as((tx) => publishDueInstagramPosts(tx, actor, productId, { ...api, enabled: false }, new Date(Date.now() + 40 * 86_400_000))))[0].result).toMatch(/switched off/);
    const r = await as((tx) => publishDueInstagramPosts(tx, actor, productId, api, new Date(Date.now() + 40 * 86_400_000)));
    expect(r[0].result).toBe("published");
    expect(calls).toEqual(["image A calmer caption.\n\n#panicattack", "publish"]);
    const done = (await as((tx) => deskItems(tx, productId))).find((i) => i.id === post.id)!;
    expect(done).toMatchObject({ status: "published", external_url: "https://www.instagram.com/p/abc/" });
  });

  it("remove takes a piece off the desk", async () => {
    const carousel = (await as((tx) => deskItems(tx, productId))).find((i) => i.kind === "carousel")!;
    await as((tx) => rejectDeskItem(tx, actor, productId, carousel.id));
    expect((await as((tx) => deskItems(tx, productId))).some((i) => i.id === carousel.id)).toBe(false);
  });

  it("a Reel waits for the renderer, can be approved only once made, and is published in two steps", async () => {
    const r = await as((tx) => generateDesk(tx, actor, productId, media, { posts: 0, carousels: 0, articles: 0, reels: 1 }));
    const id = r.created[0].id;
    let reel = (await as((tx) => deskItems(tx, productId))).find((i) => i.id === id)!;
    expect(reel).toMatchObject({ kind: "reel", render_status: "waiting", status: "needs_human_review" });
    expect(reel.reel?.scenes.map((s) => s.shot)).toEqual(["breathe", "listen"]);
    await expect(as((tx) => approveDeskItem(tx, actor, productId, id, media))).rejects.toThrow(/still being made/);

    const job = await as((tx) => claimReelJob(tx, productId));
    expect(job?.id).toBe(id);
    expect(await as((tx) => claimReelJob(tx, productId))).toBeNull(); // taken
    await as((tx) => finishReelRender(tx, productId, id, { storageKey: "elsewhere/x.mp4" }));
    expect((await as((tx) => deskItems(tx, productId))).find((i) => i.id === id)!.render_status).toBe("failed");
    await as((tx) => rerenderReel(tx, productId, id, { intro_style: "light", intro_lines: ["Calm for the", "first minute"], scenes: [{ shot: "home", caption: "" }, { shot: "ground", caption: "Feet on the floor" }] }));
    const job2 = (await as((tx) => claimReelJob(tx, productId)))!;
    expect(job2.spec.intro_lines).toEqual(["Calm for the", "first minute"]);
    await as((tx) => finishReelRender(tx, productId, id, { storageKey: job2.storageKey }));
    reel = (await as((tx) => deskItems(tx, productId))).find((i) => i.id === id)!;
    expect(reel.render_status).toBe("ready");
    expect(reel.video_asset_id).toBeTruthy();

    // A different hook makes the Reel again instead of approving it.
    const again = await as((tx) => approveDeskItem(tx, actor, productId, id, media, { hookIndex: 1 }));
    expect(again.scheduledFor).toBeNull();
    const job3 = (await as((tx) => claimReelJob(tx, productId)))!;
    await as((tx) => finishReelRender(tx, productId, id, { storageKey: job3.storageKey }));
    const a = await as((tx) => approveDeskItem(tx, actor, productId, id, media));
    expect(riga(a.scheduledFor!)).toMatch(/ (09:30|14:00|20:00)$/);

    let status = "IN_PROGRESS";
    const calls: string[] = [];
    const api: IgImagesApi = {
      token: async () => ({ token: "t", igUserId: "ig1" }), fileUrl: async (p) => `https://storage/${p}`,
      image: async () => "c", carousel: async () => "car", reel: async (_t, _u, url, caption) => { calls.push(`reel ${url.endsWith(".mp4")} ${caption.length > 0}`); return "rc1"; },
      status: async () => status, publish: async () => { calls.push("publish"); return "m9"; }, permalink: async () => "https://www.instagram.com/reel/xyz/", enabled: true,
    };
    const later = new Date(Date.now() + 90 * 86_400_000);
    expect((await as((tx) => publishDueInstagramPosts(tx, actor, productId, api, later)))[0].result).toBe("processing");
    expect((await as((tx) => publishDueInstagramPosts(tx, actor, productId, api, later)))[0].result).toBe("processing");
    status = "FINISHED";
    expect((await as((tx) => publishDueInstagramPosts(tx, actor, productId, api, later)))[0].result).toBe("published");
    expect(calls).toEqual(["reel true true", "publish"]);
  });

  it("adds the owner's own Reel to the desk: checked, made with the chosen melody, then approved into a slot", async () => {
    const r = await as((tx) => addOwnReel(tx, actor, productId, {
      topic: "Breathe along", caption: "Save this for the next time your heart starts racing.", melody: 11,
      reel: { format: "breathe_along", music: "warm", intro_style: "dark", intro_lines: ["Save this", "for the next time"], text_lines: ["Follow the circle."] },
    }));
    expect(r.status).toBe("waiting");
    const own = (await as((tx) => deskItems(tx, productId))).find((i) => i.id === r.id)!;
    expect(own).toMatchObject({ kind: "reel", render_status: "waiting", status: "needs_human_review", topic: "Breathe along" });
    const job = (await as((tx) => claimReelJob(tx, productId)))!;
    expect(job.id).toBe(r.id);
    expect(job.spec).toMatchObject({ format: "breathe_along", seed: 11, intro_lines: ["Save this", "for the next time"] });
    await as((tx) => finishReelRender(tx, productId, r.id, { storageKey: job.storageKey }));
    const a = await as((tx) => approveDeskItem(tx, actor, productId, r.id, media));
    expect(riga(a.scheduledFor!)).toMatch(/ (09:30|14:00|20:00)$/);
    await expect(as((tx) => addOwnReel(tx, actor, productId, { topic: "Too short", caption: "", reel: { intro_style: "dark", intro_lines: ["Hi"], scenes: [{ shot: "home", caption: "" }] } })))
      .rejects.toThrow(/2 or 3 scenes/);
  });

  it("removes a piece the safety rules stopped (still a draft): it leaves the desk and is not rendered", async () => {
    const r = await as((tx) => addOwnReel(tx, actor, productId, {
      topic: "Stopped one", caption: "",
      reel: { format: "read_slowly", music: "piano", intro_style: "dark", intro_lines: ["Calm lines"], text_lines: ["One", "Two", "Three"] },
    }));
    // What a stop by the safety rules leaves (the mock reviewer never blocks): a draft with no pending approval.
    await pool().query("update approval_items a set state = 'invalidated' from content_items i where i.id = $1 and a.content_version_id = i.current_version_id", [r.id]);
    await pool().query("update content_items set status = 'draft' where id = $1", [r.id]);
    await as((tx) => rejectDeskItem(tx, actor, productId, r.id));
    const it = (await as((tx) => deskItems(tx, productId))).find((i) => i.id === r.id);
    expect(it?.status ?? "archived").toBe("archived");
    const job = await as((tx) => claimReelJob(tx, productId));
    expect(job?.id).not.toBe(r.id);
  });

  it("splits a hook into short opening lines", () => {
    expect(hookLines("3:07 am. Heart racing. Nobody awake.")).toEqual(["3:07 am.", "Heart racing.", "Nobody awake."]);
    expect(hookLines("An anxiety app that won't make you breathe right").every((l) => l.length <= 28)).toBe(true);
  });
});
