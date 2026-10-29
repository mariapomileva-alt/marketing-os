import type { Tx } from "@/server/db/client";
import { ingestSource } from "./knowledge";

/**
 * Reads the product's own public website into Knowledge: the sitemap (or llms.txt, or the home page links), then each
 * page as clean text with its headings. Only pages on the same site; at most `max` pages. Already-read pages with the
 * same text are skipped (Knowledge deduplicates by content).
 */
export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text: string; type: string }>;

export const liveFetcher: Fetcher = async (url) => {
  const r = await fetch(url, { headers: { "user-agent": "GodOfMarketing/1.0 (reads the team's own site)" }, redirect: "follow", cache: "no-store" });
  return { ok: r.ok, status: r.status, text: r.ok ? await r.text() : "", type: r.headers.get("content-type") ?? "" };
};

const decode = (s: string) =>
  s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"').replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/&hellip;/g, "…").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

/** Page HTML → markdown-ish text: title, headings, paragraphs and list items; no scripts, styles, nav or footer. */
export function htmlToText(html: string) {
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "");
  let body = /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? /<body[\s\S]*?<\/body>/i.exec(html)?.[0] ?? html;
  body = body.replace(/<(script|style|noscript|svg|nav|footer|form|template)[\s\S]*?<\/\1>/gi, " ");
  body = body
    .replace(/<h1[^>]*>/gi, "\n\n# ").replace(/<h2[^>]*>/gi, "\n\n## ").replace(/<h3[^>]*>/gi, "\n\n### ").replace(/<h[4-6][^>]*>/gi, "\n\n#### ")
    .replace(/<li[^>]*>/gi, "\n- ").replace(/<(p|div|section|article|tr|br|blockquote|summary|details)[^>]*>/gi, "\n").replace(/<\/(h[1-6]|p|li|div|section)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decode(body).split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).filter((l, i, a) => l || (a[i - 1] ?? "") !== "").join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { title, text };
}

export async function discoverPages(base: string, fetcher: Fetcher, max: number) {
  const root = new URL(base);
  const same = (u: string) => { try { const x = new URL(u, root); return x.host === root.host ? x.toString().split("#")[0] : null; } catch { return null; } };
  const found = new Set<string>([root.toString()]);
  const sm = await fetcher(new URL("/sitemap.xml", root).toString()).catch(() => null);
  if (sm?.ok) for (const m of sm.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) { const u = same(m[1]); if (u) found.add(u); }
  if (found.size < 3) {
    const llms = await fetcher(new URL("/llms.txt", root).toString()).catch(() => null);
    if (llms?.ok) for (const m of llms.text.matchAll(/https?:\/\/[^\s)]+/g)) { const u = same(m[0]); if (u) found.add(u); }
  }
  if (found.size < 3) {
    const home = await fetcher(root.toString()).catch(() => null);
    if (home?.ok) for (const m of home.text.matchAll(/href="([^"#?]+)"/g)) { const u = same(m[1]); if (u && !/\.(png|jpe?g|svg|mp4|ico|css|js|xml|pdf|zip)$/i.test(u)) found.add(u); }
  }
  return [...found].filter((u) => !/\/(privacy|terms|refund|thanks|404)\/?$/i.test(new URL(u).pathname)).slice(0, max);
}

export async function importWebsite(tx: Tx, actor: { workspaceId: string }, productId: string, siteUrl: string, fetcher: Fetcher = liveFetcher, max = 40) {
  const pages = await discoverPages(siteUrl, fetcher, max);
  let added = 0;
  let same = 0;
  const failed: string[] = [];
  for (const url of pages) {
    try {
      const r = await fetcher(url);
      if (!r.ok || !/html/i.test(r.type || "text/html")) { failed.push(`${url} (${r.status})`); continue; }
      const { title, text } = htmlToText(r.text);
      if (text.length < 200) continue;
      const md = `# ${title || url}\n\nSource: ${url}\n\n${text}`.slice(0, 400_000);
      const slug = new URL(url).pathname.replace(/^\/|\/$/g, "").replace(/[^a-z0-9]+/gi, "-") || "home";
      const res = await ingestSource(tx, {
        workspaceId: actor.workspaceId, productId, scope: "product", sourceType: "url", title: (title || url).slice(0, 200), confidence: "high",
        containsPersonalData: false, consentRecorded: false, filename: `site-${slug}.md`, mimeType: "text/markdown",
        bytes: new TextEncoder().encode(md), provenance: { url, read_at: new Date().toISOString(), from: "website import" }, chunkAs: "markdown",
      });
      if (res.duplicate) same++; else added++;
    } catch (e) {
      failed.push(`${url} (${(e as Error).message.slice(0, 80)})`);
    }
  }
  return { pages: pages.length, added, same, failed };
}
