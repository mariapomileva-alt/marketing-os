import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools } from "@/server/db/client";
import { createBackApp, createMomentro } from "@/server/services/products";
import { asService, asUser, createOwner, pool } from "../helpers/db";

let owner: { userId: string; workspaceId: string };
let space = "";
let colleague = "";
const email = `colleague-${Date.now()}@example.test`;

beforeAll(async () => {
  owner = await createOwner();
  await asUser(owner.userId, (tx) => createBackApp(tx, owner.workspaceId));
}, 60_000);
afterAll(closePools);

describe("spaces and people", () => {
  it("an owner creates a separate space for Momentro and invites a colleague into it only", async () => {
    space = (await asUser(owner.userId, (tx) => tx.one<{ ws: string }>("select public.create_space('Momentro') as ws"))).ws;
    await asUser(owner.userId, (tx) => createMomentro(tx, space));
    await asUser(owner.userId, (tx) => tx.query("insert into workspace_invites (workspace_id, email, role, invited_by) values ($1,$2,'editor',$3)", [space, email, owner.userId]));
    const { rows } = await pool().query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
    colleague = rows[0].id;
    expect((await asService((tx) => tx.one<{ n: number }>("select public.accept_invites($1, $2) n", [colleague, email]))).n).toBe(1);
    const ws = await asService((tx) => tx.one<{ ws: string }>("select public.bootstrap_owner($1, $2) ws", [colleague, email]));
    expect(ws.ws).toBe(space); // no empty personal space: they land in the space they were invited to
    const products = await asUser(colleague, (tx) => tx.query<{ slug: string }>("select slug from products order by slug"));
    expect(products.map((p) => p.slug)).toEqual(["momentro"]); // Back is invisible to them
  });

  it("the colleague can make content but cannot touch keys or connect accounts", async () => {
    const m = await asUser(colleague, (tx) => tx.one<{ id: string }>("select id from products where slug = 'momentro'"));
    await asUser(colleague, (tx) => tx.query("update products set marketing_brief = marketing_brief || '{\"hashtags\": \"#familyvideo\"}' where id = $1", [m.id]));
    await expect(asUser(colleague, (tx) => tx.query(
      "insert into secrets (workspace_id, label, ciphertext, iv, auth_tag, key_version) values ($1,'x','\\x00','\\x00','\\x00',1)", [space]))).rejects.toThrow();
    await expect(asUser(colleague, (tx) => tx.query(
      "insert into channel_connections (workspace_id, product_id, channel, adapter_kind, account_label) values ($1,$2,'instagram','official_api','@x')", [space, m.id]))).rejects.toThrow();
    await expect(asUser(colleague, (tx) => tx.query("insert into workspace_invites (workspace_id, email) values ($1,'x@y.zz')", [space]))).rejects.toThrow();
    await expect(asUser(colleague, (tx) => tx.one("select public.create_space('Mine')"))).rejects.toThrow(/only an owner/);
  });
});
