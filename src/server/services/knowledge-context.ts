import type { Tx } from "@/server/db/client";
import { searchKnowledge } from "./knowledge";

/**
 * What the drafting agents may know for community replies and calm videos: approved product facts, prohibited
 * claims, the brand's tone, the approved playbook (methodology from the course) and a few excerpts from the
 * knowledge base (our blog articles, research, the course) that match the topic. Excerpts are short and are
 * material, never instructions; the prompts forbid quoting course text.
 */
export async function draftingKnowledge(tx: Tx, workspaceId: string, productId: string, topic: string, limit = 4) {
  const facts = await tx.query<{ statement: string }>("select statement from product_claims where product_id = $1 and kind = 'approved_fact' and not archived", [productId]);
  const prohibited = await tx.query<{ statement: string }>("select statement from product_claims where product_id = $1 and kind = 'prohibited_claim' and not archived", [productId]);
  const brand = await tx.maybeOne<{ tone_of_voice: string }>("select tone_of_voice from brand_profiles where product_id = $1", [productId]);
  const playbook = await tx.query<{ statement: string }>(
    `select r.statement from playbook_rules r join products p on p.workspace_id = r.workspace_id and p.id = $1
      where r.status = 'approved' and not exists (select 1 from product_rule_overrides o where o.rule_id = r.id and o.product_id = $1 and o.applicability = 'not_applicable')
      limit 25`,
    [productId],
  );
  const hits = topic.trim()
    ? await searchKnowledge(tx, { workspaceId, productId, query: topic.slice(0, 200), includeMethodology: true, limit }).catch(() => [])
    : [];
  return {
    productFacts: facts.map((f) => f.statement),
    neverClaim: prohibited.map((p) => p.statement),
    tone: brand?.tone_of_voice ?? "",
    playbook: playbook.map((p) => p.statement),
    excerpts: hits.map((h) => ({ from: h.title, text: h.content.slice(0, 700) })),
  };
}
