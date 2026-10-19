import { describe, expect, it } from "vitest";
import { MockProvider } from "@/domain/ai/mock";
import { contentOutputSchema, hooksOutputSchema, reviewOutputSchema } from "@/domain/ai/schemas";
import { decryptSecret, encryptSecret } from "@/server/security/crypto";

describe("mock AI provider", () => {
  const ai = new MockProvider();
  it("returns schema-valid, clearly labelled hooks with rationale", async () => {
    const r = await ai.generate({ task: "hooks", system: "", input: "", schema: hooksOutputSchema, context: { jobStatement: "want to calm down", count: 3, sources: [{ id: "s1", title: "Interview 1" }] } });
    expect(r.isMock).toBe(true);
    expect(r.output.variants).toHaveLength(3);
    expect(r.output.variants.every((v) => v.hook.startsWith("[MOCK]") && v.evidence_ids.includes("s1"))).toBe(true);
  });
  it("produces format-specific content", async () => {
    const r = await ai.generate({ task: "content", system: "", input: "", schema: contentOutputSchema, context: { format: "reels_script", hook: "H" } });
    expect(r.output.variants[0].body.script?.length).toBeGreaterThan(2);
  });
  it("never pretends to have reviewed", async () => {
    const r = await ai.generate({ task: "compliance_review", system: "", input: "", schema: reviewOutputSchema });
    expect(r.output.outcome).toBe("warn");
    expect(r.output.findings[0].code).toBe("mock.review_not_performed");
  });
  it("embeds deterministically", async () => {
    const a = await ai.embed(["panic at night"]);
    const b = await ai.embed(["panic at night"]);
    expect(a.vectors[0]).toEqual(b.vectors[0]);
    expect(a.dims).toBe(256);
  });
});

describe("secret encryption", () => {
  const env = { ENCRYPTION_KEY_V1: Buffer.alloc(32, 7).toString("base64"), ENCRYPTION_KEY_V2: Buffer.alloc(32, 9).toString("base64"), ENCRYPTION_ACTIVE_KEY_VERSION: "1" };
  it("round-trips and supports rotation to a new key version", () => {
    const e1 = encryptSecret("sk-test-123", env);
    expect(e1.ciphertext.toString("utf8")).not.toContain("sk-test");
    expect(decryptSecret(e1, env)).toBe("sk-test-123");
    const e2 = encryptSecret(decryptSecret(e1, env), { ...env, ENCRYPTION_ACTIVE_KEY_VERSION: "2" });
    expect(e2.keyVersion).toBe(2);
    expect(decryptSecret(e2, env)).toBe("sk-test-123");
  });
  it("detects tampering", () => {
    const e = encryptSecret("value", env);
    e.ciphertext[0] ^= 1;
    expect(() => decryptSecret(e, env)).toThrow();
  });
});
