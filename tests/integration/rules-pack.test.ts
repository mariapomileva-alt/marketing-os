import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, type Tx } from "@/server/db/client";
import { applyBackRulesPack, createBackApp, getProfile, listClaims, listGuardrails, listLinks, rulesPackApplied } from "@/server/services/products";
import { checkText, type GuardrailRule } from "@/domain/guardrails";
import { draftingKnowledge } from "@/server/services/knowledge-context";
import { asUser, createOwner } from "../helpers/db";

let owner: { userId: string; workspaceId: string };
let productId: string;
const as = <T>(fn: (tx: Tx) => Promise<T>) => asUser(owner.userId, fn);

beforeAll(async () => {
  owner = await createOwner();
  productId = (await as((tx) => createBackApp(tx, owner.workspaceId))).id;
}, 60_000);
afterAll(closePools);

describe("Back rules pack (26 Oct 2026)", () => {
  it("applies tone, facts, rules, links and the document, and adds nothing twice", async () => {
    expect(await as((tx) => rulesPackApplied(tx, productId))).toBe(false);
    const actor = { workspaceId: owner.workspaceId, userId: owner.userId };
    const first = await as((tx) => applyBackRulesPack(tx, actor, productId));
    expect(first.claims).toBeGreaterThan(10);
    expect(first.rules).toBe(6);
    expect(first.links).toBe(2);
    const again = await as((tx) => applyBackRulesPack(tx, actor, productId));
    expect(again).toMatchObject({ claims: 0, rules: 0, links: 0, knowledgeChunks: 0 });
    expect(await as((tx) => rulesPackApplied(tx, productId))).toBe(true);

    const profile = await as((tx) => getProfile(tx, productId));
    expect(profile.tone_of_voice).toMatch(/Does anyone else/);
    expect(profile.website_url).toBe("https://backapp.live");
    expect((await as((tx) => listLinks(tx, productId))).map((l) => l.kind).sort()).toEqual(["app_store", "website"]);
    const claims = await as((tx) => listClaims(tx, productId));
    expect(claims.filter((c) => c.statement === "Back works offline.")).toHaveLength(1);
    const k = await as((tx) => draftingKnowledge(tx, owner.workspaceId, productId, "how comments should sound", 4));
    expect(k.productFacts).toContain("Back works offline.");
    expect(k.neverClaim.join(" ")).toMatch(/medication/);
  });

  it("the new safety rules catch what the document forbids", async () => {
    const rules = (await as((tx) => listGuardrails(tx, productId))).map((g) => ({ code: g.code, ruleType: g.rule_type as GuardrailRule["ruleType"], severity: g.severity, patterns: g.patterns, instruction: g.instruction, rationale: g.rationale, active: g.active }));
    const codes = (text: string) => checkText({ text, channel: "threads", format: "short_post" }, rules).map((f) => f.code);
    expect(codes("You could stop taking your meds once you feel better.")).toContain("backapp.no_medication_advice");
    expect(codes("Clinically proven calm in one tap.")).toContain("backapp.no_invented_proof");
    expect(codes("It isn't about willpower, it's about giving your body a minute.")).toContain("backapp.no_ai_reveal");
    expect(codes("Great post, it really resonates.")).toContain("backapp.no_bot_phrases");
    expect(codes("Naming three sounds in the room gives your mind somewhere to land.")).toEqual([]);
  });
});
