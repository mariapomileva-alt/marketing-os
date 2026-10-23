/** Reading our own site: the sitemap, and the readable text of an article page. */
export function parseSitemap(xml: string): Array<{ url: string; lastmod: string | null }> {
  const out: Array<{ url: string; lastmod: string | null }> = [];
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/.exec(m[1])?.[1];
    if (!loc) continue;
    out.push({ url: loc.trim(), lastmod: /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/.exec(m[1])?.[1] ?? null });
  }
  return out;
}

/** Article pages: under /guides/, /blog/, /articles/ or /posts/, one level deeper than the section index. */
export function isArticleUrl(url: string): boolean {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts.length >= 2 && ["guides", "blog", "articles", "posts", "journal"].includes(parts[0]) && parts[1] !== "assets";
  } catch {
    return false;
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10)) : (ENTITIES[e.toLowerCase()] ?? `&${e};`));

/** The article as plain Markdown-ish text: title, headings, paragraphs and list items from <article> or <main>. */
export function extractArticle(html: string): { title: string; description: string; text: string } {
  const title = decode((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/<[^>]+>/g, "").trim());
  const description = decode(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i.exec(html)?.[1] ?? "").trim();
  const body = /<article[\s\S]*?<\/article>/i.exec(html)?.[0] ?? /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? html;
  const cleaned = body
    .replace(/<(script|style|nav|footer|header|svg|form|noscript)[\s\S]*?<\/\1>/gi, "")
    .replace(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, l: string, t: string) => `\n\n${"#".repeat(Number(l))} ${t}\n\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1")
    .replace(/<(p|div|section|blockquote)[^>]*>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  const text = decode(cleaned).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { title, description, text };
}
