/**
 * Content desk against the real database (RLS on, mock AI, fake card drawing): the morning desk prepares carousels,
 * posts and article ideas with their research and hooks, all waiting for approval; approve (with edits redrawn and
 * re-checked) places each on the calendar; approved Instagram posts are published at their time only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withContext, type Tx } from "@/server/db/client";
import { createBackApp } from "@/server/services/products";
import type { Actor } from "@/server/services/content";
import { approveDeskItem, deskItems, generateDesk, nextDeskSlot, publishDueInstagramPosts, rejectDeskItem, type DeskMedia, type IgImagesApi } from "@/server/services/content-desk";
import { asUser, createOwner, pool } from "../helpers/db";

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

  it("approve with a different hook and caption: redrawn, re-checked and put on the calendar at the post time", async () => {
    const post = (await as((tx) => deskItems(tx, productId))).find((i) => i.kind === "post")!;
    const before = drawn.length;
    const a = await as((tx) => approveDeskItem(tx, actor, productId, post.id, media, { hookIndex: 1, caption: "A calmer caption.\n\n#panicattack" }));
    expect(riga(a.scheduledFor)).toMatch(/18:30/);
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
    expect(riga(a.scheduledFor)).toMatch(/^(Mon|Wed|Fri) 15:00$/);
    expect(art.body.body).toMatch(/Search: /);
  });

  it("one carousel a day: the next one goes to the following day", async () => {
    const now = new Date("2030-05-06T06:00:00Z");
    const first = await as((tx) => nextDeskSlot(tx, productId, "carousel", { post_time: "18:30", carousel_time: "12:30" }, now));
    expect(riga(first)).toBe("Mon 12:30");
  });

  it("publishes an approved post at its time only, with the approved caption and cards", async () => {
    const post = (await as((tx) => deskItems(tx, productId))).find((i) => i.kind === "post" && i.status === "scheduled")!;
    const calls: string[] = [];
    const api: IgImagesApi = {
      token: async () => ({ token: "t", igUserId: "ig1" }),
      fileUrl: async (p) => `https://storage/${p}`,
      image: async (_t, _u, url, caption, item) => { calls.push(`image ${item ? "item" : caption}`); return "c1"; },
      carousel: async () => "car1",
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
});
