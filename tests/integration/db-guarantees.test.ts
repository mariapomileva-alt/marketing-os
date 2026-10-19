import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools } from "@/server/db/client";
import { asService, asUser, createOwner, createProduct, pool } from "../helpers/db";

let owner: { userId: string; workspaceId: string };
let other: { userId: string; workspaceId: string };
let productA: string;
let productB: string;
let otherProduct: string;

beforeAll(async () => {
  owner = await createOwner();
  other = await createOwner();
  productA = (await createProduct(owner.userId, owner.workspaceId, "alpha")).id;
  productB = (await createProduct(owner.userId, owner.workspaceId, "beta")).id;
  otherProduct = (await createProduct(other.userId, other.workspaceId, "alpha")).id;
});
afterAll(closePools);

async function newSegment(userId: string, ws: string, product: string, code: string) {
  return asUser(userId, (tx) =>
    tx.one<{ id: string }>("insert into segments (workspace_id, product_id, code, name) values ($1,$2,$3,$4) returning id", [ws, product, code, code]),
  );
}

async function newContentItem(product: string) {
  return asUser(owner.userId, async (tx) => {
    const item = await tx.one<{ id: string }>(
      "insert into content_items (workspace_id, product_id, channel, format) values ($1,$2,'threads','short_post') returning id",
      [owner.workspaceId, product],
    );
    const v = await tx.one<{ id: string; content_hash: string }>(
      "insert into content_versions (workspace_id, product_id, content_item_id, version, body, author_type) values ($1,$2,$3,1,$4,'human') returning id, content_hash",
      [owner.workspaceId, product, item.id, JSON.stringify({ body: "Hello" })],
    );
    await tx.query("update content_items set current_version_id = $1 where id = $2", [v.id, item.id]);
    await tx.query("insert into experiments (workspace_id, product_id, content_item_id) values ($1,$2,$3)", [owner.workspaceId, product, item.id]);
    return { itemId: item.id, versionId: v.id, hash: v.content_hash };
  });
}

describe("product isolation", () => {
  it("rejects linking an entity to a segment of another product", async () => {
    const seg = await newSegment(owner.userId, owner.workspaceId, productA, "AL-S1");
    await expect(
      asUser(owner.userId, (tx) =>
        tx.query("insert into ideas (workspace_id, product_id, title, segment_id) values ($1,$2,'x',$3)", [owner.workspaceId, productB, seg.id]),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("hides other workspaces' rows and blocks writes into them", async () => {
    const visible = await asUser(owner.userId, (tx) => tx.query("select id from products where id = $1", [otherProduct]));
    expect(visible).toHaveLength(0);
    await expect(
      asUser(owner.userId, (tx) => tx.query("insert into audiences (workspace_id, product_id, name) values ($1,$2,'x')", [other.workspaceId, otherProduct])),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("audit log", () => {
  it("records row changes with the acting user and cannot be modified", async () => {
    const rows = await asUser(owner.userId, (tx) =>
      tx.query<{ actor_id: string; action: string }>("select actor_id, action from audit_logs where entity_type = 'products' and entity_id = $1", [productA]),
    );
    expect(rows[0]).toMatchObject({ actor_id: owner.userId, action: "insert" });
    // Two layers: no DELETE grant for application roles, and a trigger that stops even the table owner.
    await expect(asService((tx) => tx.query("delete from audit_logs"))).rejects.toThrow(/permission denied/);
    await expect(pool().query("delete from audit_logs")).rejects.toThrow(/append-only/);
  });

  it("redacts secret ciphertext in the audit log", async () => {
    await asUser(owner.userId, (tx) =>
      tx.query("insert into secrets (workspace_id, label, ciphertext, iv, auth_tag, key_version) values ($1,'k','\\x01','\\x02','\\x03',1)", [owner.workspaceId]),
    );
    const row = await asService((tx) => tx.one<{ after: Record<string, string> }>("select after from audit_logs where entity_type='secrets' order by id desc limit 1"));
    expect(row.after.ciphertext).toBe("[redacted]");
  });
});

describe("AJTBD rules", () => {
  it("keeps segment codes immutable", async () => {
    const seg = await newSegment(owner.userId, owner.workspaceId, productA, "AL-S2");
    await expect(asUser(owner.userId, (tx) => tx.query("update segments set code = 'AL-S9' where id = $1", [seg.id]))).rejects.toThrow(/cannot change/);
  });

  it("freezes definitions of an active codebook", async () => {
    const seg = await newSegment(owner.userId, owner.workspaceId, productA, "AL-S3");
    await asUser(owner.userId, async (tx) => {
      const cb = await tx.one<{ id: string }>("insert into codebook_versions (workspace_id, product_id, version) values ($1,$2,1) returning id", [owner.workspaceId, productA]);
      await tx.query("insert into segment_definitions (workspace_id, product_id, segment_id, codebook_version_id, core_job) values ($1,$2,$3,$4,'want to calm down')", [owner.workspaceId, productA, seg.id, cb.id]);
      await tx.query("update codebook_versions set status = 'active' where id = $1", [cb.id]);
    });
    await expect(asUser(owner.userId, (tx) => tx.query("update segment_definitions set core_job = 'changed' where segment_id = $1", [seg.id]))).rejects.toThrow(/frozen/);
  });

  it("accepts only verbatim quotes from the same product's sources, and never edits them", async () => {
    const chunk = await asUser(owner.userId, async (tx) => {
      const src = await tx.one<{ id: string }>(
        "insert into knowledge_sources (workspace_id, product_id, scope, source_type, title, sha256) values ($1,$2,'product','interview','i1','h1') returning id",
        [owner.workspaceId, productA],
      );
      return tx.one<{ id: string }>("insert into knowledge_chunks (workspace_id, source_id, ordinal, content) values ($1,$2,0,'I felt my heart racing at night') returning id", [owner.workspaceId, src.id]);
    });
    const q = await asUser(owner.userId, (tx) =>
      tx.one<{ id: string }>("insert into client_quotes (workspace_id, product_id, text_verbatim, chunk_id) values ($1,$2,'my heart racing',$3) returning id", [owner.workspaceId, productA, chunk.id]),
    );
    await expect(
      asUser(owner.userId, (tx) => tx.query("insert into client_quotes (workspace_id, product_id, text_verbatim, chunk_id) values ($1,$2,'my heart was racing',$3)", [owner.workspaceId, productA, chunk.id])),
    ).rejects.toThrow(/verbatim/);
    await expect(
      asUser(owner.userId, (tx) => tx.query("insert into client_quotes (workspace_id, product_id, text_verbatim, chunk_id) values ($1,$2,'my heart racing',$3)", [owner.workspaceId, productB, chunk.id])),
    ).rejects.toThrow(/same product/);
    await expect(asUser(owner.userId, (tx) => tx.query("update client_quotes set text_verbatim = 'x' where id = $1", [q.id]))).rejects.toThrow(/permission denied/);
    await expect(pool().query("update client_quotes set text_verbatim = 'x' where id = $1", [q.id])).rejects.toThrow(/append-only/);
  });
});

describe("approval and publication", () => {
  it("refuses automatic mode for any connection", async () => {
    await expect(
      asUser(owner.userId, (tx) =>
        tx.query("insert into channel_connections (workspace_id, product_id, channel, adapter_kind, mode) values ($1,$2,'threads','export','automatic')", [owner.workspaceId, productA]),
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("enforces status transitions and requires approval of the exact version", async () => {
    const c = await newContentItem(productA);
    await expect(asUser(owner.userId, (tx) => tx.query("update content_items set status = 'published' where id = $1", [c.itemId]))).rejects.toThrow(/invalid content status/);
    await asUser(owner.userId, async (tx) => {
      await tx.query("update content_items set status = 'ai_review' where id = $1", [c.itemId]);
      await tx.query("update content_items set status = 'needs_human_review' where id = $1", [c.itemId]);
    });
    await expect(asUser(owner.userId, (tx) => tx.query("update content_items set status = 'approved' where id = $1", [c.itemId]))).rejects.toThrow(/without a human approval/);

    const item = await asUser(owner.userId, (tx) =>
      tx.one<{ id: string }>(
        "insert into approval_items (workspace_id, product_id, item_type, content_version_id, payload_snapshot, payload_hash) values ($1,$2,'content_version',$3,'{}','hash-1') returning id",
        [owner.workspaceId, productA, c.versionId],
      ),
    );
    await expect(
      asUser(owner.userId, (tx) =>
        tx.query("insert into approval_decisions (workspace_id, product_id, approval_item_id, decision, payload_hash) values ($1,$2,$3,'approved','stale')", [owner.workspaceId, productA, item.id]),
      ),
    ).rejects.toThrow(/payload changed/);
    await asUser(owner.userId, async (tx) => {
      await tx.query("insert into approval_decisions (workspace_id, product_id, approval_item_id, decision, payload_hash) values ($1,$2,$3,'approved','hash-1')", [owner.workspaceId, productA, item.id]);
      await tx.query("update content_items set status = 'approved' where id = $1", [c.itemId]);
    });

    // Editing after approval: new version invalidates the approval and returns the item to draft.
    const status = await asUser(owner.userId, async (tx) => {
      const v2 = await tx.one<{ id: string }>(
        "insert into content_versions (workspace_id, product_id, content_item_id, version, body, author_type) values ($1,$2,$3,2,$4,'human') returning id",
        [owner.workspaceId, productA, c.itemId, JSON.stringify({ body: "Hello, edited" })],
      );
      await tx.query("update content_items set current_version_id = $1 where id = $2", [v2.id, c.itemId]);
      const s = await tx.one<{ status: string }>("select status from content_items where id = $1", [c.itemId]);
      const a = await tx.one<{ state: string }>("select state from approval_items where id = $1", [item.id]);
      return { item: s.status, approval: a.state };
    });
    expect(status).toEqual({ item: "draft", approval: "invalidated" });

    await expect(
      asUser(owner.userId, (tx) =>
        tx.query("insert into publications (workspace_id, product_id, content_item_id, content_version_id, channel, method, approval_item_id) values ($1,$2,$3,$4,'threads','export',$5)", [
          owner.workspaceId, productA, c.itemId, c.versionId, item.id,
        ]),
      ),
    ).rejects.toThrow(/approved queue item/);
  });

  it("locks the experiment pre-registration at first publication", async () => {
    const c = await newContentItem(productA);
    await asUser(owner.userId, async (tx) => {
      const a = await tx.one<{ id: string }>(
        "insert into approval_items (workspace_id, product_id, item_type, content_version_id, payload_snapshot, payload_hash) values ($1,$2,'content_version',$3,'{}','h') returning id",
        [owner.workspaceId, productA, c.versionId],
      );
      await tx.query("insert into approval_decisions (workspace_id, product_id, approval_item_id, decision, payload_hash) values ($1,$2,$3,'approved','h')", [owner.workspaceId, productA, a.id]);
      await tx.query("insert into publications (workspace_id, product_id, content_item_id, content_version_id, channel, method, approval_item_id) values ($1,$2,$3,$4,'threads','export',$5)", [
        owner.workspaceId, productA, c.itemId, c.versionId, a.id,
      ]);
    });
    await expect(asUser(owner.userId, (tx) => tx.query("update experiments set primary_metric = 'saves' where content_item_id = $1", [c.itemId]))).rejects.toThrow(/locked/);
  });
});

describe("epistemic rules", () => {
  it("never lets AI assert a fact", async () => {
    await expect(
      asUser(owner.userId, (tx) =>
        tx.query("insert into assertions (workspace_id, product_id, kind, origin, statement) values ($1,$2,'fact','ai','Users love it')", [owner.workspaceId, productA]),
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("requires evidence for a fact and refuses methodology as fact evidence", async () => {
    await expect(
      asUser(owner.userId, (tx) =>
        tx.query("insert into assertions (workspace_id, product_id, kind, origin, statement) values ($1,$2,'fact','human','No source')", [owner.workspaceId, productA]),
      ),
    ).rejects.toThrow(/must cite/);

    const chunk = await asUser(owner.userId, async (tx) => {
      const src = await tx.one<{ id: string }>(
        "insert into knowledge_sources (workspace_id, scope, source_type, title, sha256) values ($1,'workspace','methodology','course','h-m1') returning id",
        [owner.workspaceId],
      );
      return tx.one<{ id: string }>("insert into knowledge_chunks (workspace_id, source_id, ordinal, content) values ($1,$2,0,'Flywheel rule') returning id", [owner.workspaceId, src.id]);
    });
    await expect(
      asUser(owner.userId, async (tx) => {
        const a = await tx.one<{ id: string }>("insert into assertions (workspace_id, product_id, kind, origin, statement) values ($1,$2,'fact','human','X') returning id", [owner.workspaceId, productA]);
        await tx.query("insert into assertion_evidence (workspace_id, product_id, assertion_id, chunk_id) values ($1,$2,$3,$4)", [owner.workspaceId, productA, a.id, chunk.id]);
      }),
    ).rejects.toThrow(/methodology sources cannot support/);

    // ...but methodology can support a hypothesis.
    await asUser(owner.userId, async (tx) => {
      const a = await tx.one<{ id: string }>("insert into assertions (workspace_id, product_id, kind, origin, statement) values ($1,$2,'hypothesis','ai','Try X') returning id", [owner.workspaceId, productA]);
      await tx.query("insert into assertion_evidence (workspace_id, product_id, assertion_id, chunk_id) values ($1,$2,$3,$4)", [owner.workspaceId, productA, a.id, chunk.id]);
    });
  });
});
