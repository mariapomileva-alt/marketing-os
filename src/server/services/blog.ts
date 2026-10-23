import type { Tx } from "@/server/db/client";
import { extractArticle, isArticleUrl, parseSitemap } from "@/domain/blog";
import { createIdea, generateContent, generateHooks, type Actor } from "./content";
import { ingestSource } from "./knowledge";

/**
 * Our blog as the product's knowledge base and idea source. Daily: read the site's sitemap, take new article pages,
 * store each as a knowledge source (so drafts can draw on it), then seed an idea from it with drafted Threads posts
 * (drafts only, reviewed and approved as usual) and add its title to the calm video topics.
 */
export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export async function syncBlog(tx: Tx, actor: Actor, productId: string, fetcher: Fetcher, opts: { draft: boolean; max?: number } = { draft: true }) {
  const site = await tx.maybeOne<{ domain: string | null }>("select domain from site_settings where product_id = $1", [productId]);
  if (!site?.domain) return { found: 0, added: 0, drafted: 0, errors: ["Set the website domain in Analytics → Set up the website counter."] };
  const errors: string[] = [];
  const res = await fetcher(`https://${site.domain}/sitemap.xml`);
  if (!res.ok) return { found: 0, added: 0, drafted: 0, errors: [`The sitemap could not be read (${res.status}).`] };
  const articles = parseSitemap(await res.text()).filter((u) => isArticleUrl(u.url));
  for (const a of articles) {
    await tx.query(
      "insert into blog_articles (workspace_id, product_id, url, lastmod) values ($1,$2,$3,$4) on conflict (product_id, url) do nothing",
      [actor.workspaceId, productId, a.url, a.lastmod],
    );
  }
  const todo = await tx.query<{ id: string; url: string }>(
    "select id, url from blog_articles where product_id = $1 and status = 'new' order by lastmod desc nulls last, found_at limit $2",
    [productId, opts.max ?? 3],
  );
  let added = 0;
  let drafted = 0;
  for (const t of todo) {
    try {
      const page = await fetcher(t.url);
      if (!page.ok) throw new Error(`page ${page.status}`);
      const art = extractArticle(await page.text());
      if (art.text.length < 300) {
        await tx.query("update blog_articles set status = 'skipped', title = $2, error = 'Too little text on the page', processed_at = now() where id = $1", [t.id, art.title]);
        continue;
      }
      const md = `# ${art.title}\n\n${art.description ? `${art.description}\n\n` : ""}Source: ${t.url}\n\n${art.text}`;
      const src = await ingestSource(tx, {
        workspaceId: actor.workspaceId, productId, scope: "product", sourceType: "url", title: `Our article: ${art.title}`.slice(0, 200),
        confidence: "high", containsPersonalData: false, consentRecorded: false, filename: "article.md", mimeType: "text/markdown",
        bytes: new TextEncoder().encode(md), provenance: { url: t.url, from: "blog sync" }, chunkAs: "markdown",
      });
      added++;
      await tx.query("update blog_articles set status = 'ingested', title = $2, source_id = $3, processed_at = now(), error = null where id = $1", [t.id, art.title, src.id]);
      // The article title becomes a calm video topic (front of the list, no duplicates).
      await tx.query(
        `update calm_settings set topics = (array[$2::text] || array_remove(topics, $2::text))[1:60] where product_id = $1`,
        [productId, art.title.toLowerCase().slice(0, 120)],
      );
      if (!opts.draft) continue;
      const idea = await createIdea(tx, actor, productId, {
        title: art.title.slice(0, 200), insight: (art.description || art.text.slice(0, 400)).slice(0, 1000), audienceId: null, segmentId: null, jobId: null,
        fearId: null, quoteId: null, signalId: null, topic: "from our blog", funnelStage: "awareness", sourceIds: [src.id],
      });
      await generateHooks(tx, actor, productId, idea.id, 2);
      const hook = await tx.maybeOne<{ id: string }>("select id from hooks where idea_id = $1 order by created_at limit 1", [idea.id]);
      if (hook) {
        await generateContent(tx, actor, productId, { ideaId: idea.id, hookId: hook.id, channel: "threads", format: "short_post", goal: "awareness", language: "en", ctaTermId: null, campaignId: null });
        drafted++;
      }
      await tx.query("update blog_articles set status = 'drafted', idea_id = $2 where id = $1", [t.id, idea.id]);
    } catch (e) {
      errors.push(`${t.url}: ${(e as Error).message}`);
      await tx.query("update blog_articles set status = 'failed', error = $2, processed_at = now() where id = $1", [t.id, (e as Error).message.slice(0, 300)]);
    }
  }
  return { found: articles.length, added, drafted, errors };
}
