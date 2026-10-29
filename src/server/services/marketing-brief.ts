import type { Tx } from "@/server/db/client";
import { BACK_BRIEF, defaultBrief, mergeBrief, type MarketingBrief } from "@/domain/brief";

/** The product's marketing brief: Back's built-in brief or one built from the product's facts, plus what the owner saved. */
export async function productBrief(tx: Tx, productId: string): Promise<MarketingBrief> {
  const p = await tx.maybeOne<{ slug: string; name: string; short_description: string; category: string; marketing_brief: Partial<MarketingBrief> }>(
    "select slug, name, short_description, category, marketing_brief from products where id = $1", [productId]);
  if (!p) return BACK_BRIEF;
  const base = p.slug === "back-app" ? BACK_BRIEF : defaultBrief(p);
  return mergeBrief(base, p.marketing_brief);
}

export async function saveBrief(tx: Tx, productId: string, brief: Partial<MarketingBrief>) {
  await tx.query("update products set marketing_brief = $2 where id = $1", [productId, JSON.stringify(brief)]);
}
