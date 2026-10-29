import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { closePools, withContext, type Tx } from "@/server/db/client";
import { createBackApp } from "@/server/services/products";
import { appStoreSummary, connectAppStore, disconnectAppStore, syncAppStore, type AscDeps } from "@/server/services/app-store";
import { ascToken, parseTsv, validateCredentials } from "@/server/appstore/api";
import { asUser, createOwner } from "../helpers/db";

const key = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const creds = { issuerId: "57246542-96fe-1a63-e053-0824d011072a", keyId: "2X9R4HXF34", privateKey: key };

describe("App Store Connect downloads", () => {
  let owner: Awaited<ReturnType<typeof createOwner>>;
  let productId: string;
  const as = <T>(fn: (tx: Tx) => Promise<T>) => asUser(owner.userId, fn);
  const head = "Date\tApp Name\tApp Apple Identifier\tDownload Type\tApp Version\tDevice\tPlatform Version\tSource Type\tSource Info\tCampaign\tPage Type\tPage Title\tPre-Order\tTerritory\tCounts";
  let segmentsOf: Record<string, number> = { i1: 1, i2: 1 };
  const files: Record<string, string> = {
    "u-i1-0": `${head}\n2030-05-01\tBack\t6811918141\tFirst-time download\t1.0\tiPhone\tiOS 19\tWeb referrer\tbackapp.live\tweb\tProduct page\t\t\tGB\t3\n2030-05-01\tBack\t6811918141\tFirst-time download\t1.0\tiPhone\tiOS 19\tApp referrer\tInstagram\tinstagram\tProduct page\t\t\tGB\t2\n2030-05-01\tBack\t6811918141\tRedownload\t1.0\tiPhone\tiOS 19\tApp Store search\t\t\tProduct page\t\t\tGB\t9`,
    "u-i2-0": `${head}\n2030-05-02\tBack\t6811918141\tFirst-time download\t1.0\tiPhone\tiOS 19\tApp Store search\t\t\tProduct page\t\t\tUS\t4`,
    "u-i2-1": `${head}\n2030-05-02\tBack\t6811918141\tFirst-time download\t1.0\tiPhone\tiOS 19\tWeb referrer\tbackapp.live\tweb\tProduct page\t\t\tUS\t1`,
  };
  const deps: AscDeps = {
    app: async () => ({ name: "Back: Panic Attack Help", bundleId: "app.back.selfhelp" }),
    ensureRequest: async () => "req1",
    report: async () => ({ id: "rep1", name: "App Downloads Detailed" }),
    instances: async () => [{ id: "i1", processingDate: "2030-05-01" }, { id: "i2", processingDate: "2030-05-02" }],
    segments: async (_c, id) => Array.from({ length: segmentsOf[id] }, (_, n) => ({ id: `${id}-${n}`, url: `u-${id}-${n}` })),
    read: async (url) => parseTsv(files[url] ?? ""),
  };

  beforeAll(async () => {
    owner = await createOwner();
    productId = (await as((tx) => createBackApp(tx, owner.workspaceId))).id;
  }, 60_000);
  afterAll(async () => { await closePools(); });

  it("checks the key parts and signs an ES256 token", () => {
    expect(() => validateCredentials({ ...creds, issuerId: "nope" })).toThrow(/Issuer ID/);
    expect(() => validateCredentials({ ...creds, privateKey: "hello" })).toThrow(/\.p8/);
    const t = ascToken(validateCredentials(creds));
    const [h, p, sig] = t.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toMatchObject({ alg: "ES256", kid: "2X9R4HXF34" });
    expect(JSON.parse(Buffer.from(p, "base64url").toString())).toMatchObject({ aud: "appstoreconnect-v1", iss: creds.issuerId });
    expect(Buffer.from(sig, "base64url").length).toBe(64);
  });

  it("connects with the key stored encrypted, then reads first-time downloads by campaign and source", async () => {
    await as((tx) => connectAppStore(tx, owner.workspaceId, productId, creds, "6811918141", deps));
    const stored = await withContext({ userId: null, role: "service" }, (tx) => tx.one<{ c: Buffer }>("select s.ciphertext c from secrets s join channel_connections c on c.secret_id = s.id where c.product_id = $1 and c.channel = 'app_store'", [productId]));
    expect(stored.c.toString("utf8")).not.toContain("PRIVATE KEY");
    segmentsOf = { i1: 1, i2: 1 };
    const r = await withContext({ userId: null, role: "service" }, (tx) => syncAppStore(tx, productId, deps));
    expect(r).toMatchObject({ imported: 2 });
    // Apple adds a late batch to day 2: that instance is read again and replaced, not added twice.
    segmentsOf = { i1: 1, i2: 2 };
    await withContext({ userId: null, role: "service" }, (tx) => syncAppStore(tx, productId, deps));
    await withContext({ userId: null, role: "service" }, (tx) => tx.query("update app_store_downloads set day = current_date - 1 where product_id = $1", [productId]));
    const s = await as((tx) => appStoreSummary(tx, productId, 30));
    expect(s.total).toBe(10);
    expect(s.byCampaign.find((c) => c.campaign === "web")?.downloads).toBe(4);
    expect(s.byCampaign.find((c) => c.campaign === "instagram")?.downloads).toBe(2);
    expect(s.bySource.find((x) => x.source === "Web referrer · backapp.live")?.downloads).toBe(4);
  });

  it("disconnect deletes the key; reading then does nothing", async () => {
    await as((tx) => disconnectAppStore(tx, productId));
    expect(await withContext({ userId: null, role: "service" }, (tx) => syncAppStore(tx, productId, deps))).toMatchObject({ skipped: expect.any(String) });
  });
});
