import { describe, expect, it } from "vitest";
import { extractArticle, isArticleUrl, parseSitemap } from "@/domain/blog";

describe("blog reading", () => {
  it("reads the sitemap and keeps article pages only", () => {
    const urls = parseSitemap(`<urlset><url><loc>https://backapp.live/</loc></url><url><loc>https://backapp.live/guides/</loc><lastmod>2026-10-20</lastmod></url><url><loc>https://backapp.live/guides/panic-at-night-next-minute-plan/</loc><lastmod>2026-10-22</lastmod></url></urlset>`);
    expect(urls).toHaveLength(3);
    expect(urls.filter((u) => isArticleUrl(u.url)).map((u) => u.url)).toEqual(["https://backapp.live/guides/panic-at-night-next-minute-plan/"]);
  });
  it("extracts readable text from an article", () => {
    const a = extractArticle(`<html><head><title>X</title><meta name="description" content="A plan for the next minute."></head><body><nav>menu</nav><main><h1>Panic at night: the next minute</h1><p>When you wake up with your heart racing&hellip;</p><h2>Try this</h2><ul><li>Feet on the floor</li><li>Name three sounds</li></ul><script>x()</script></main><footer>©</footer></body></html>`);
    expect(a.title).toBe("Panic at night: the next minute");
    expect(a.description).toBe("A plan for the next minute.");
    expect(a.text).toContain("## Try this");
    expect(a.text).toContain("- Feet on the floor");
    expect(a.text).not.toContain("menu");
    expect(a.text).not.toContain("x()");
  });
});
