import "server-only";
import { ILLUSTRATIONS, LOOKS, renderPost, type Illustration, type Look } from "@/server/cards/render";
import { fileStore } from "@/server/storage";
import type { DeskMedia } from "@/server/services/content-desk";

/** A calm portrait photo for the "photo" look (Pixabay, or Pexels), as a data URL; null when none is found. */
async function findPhoto(query: string): Promise<string | null> {
  const q = query.trim().slice(0, 80);
  if (!q) return null;
  let url: string | null = null;
  try {
    if (process.env.PIXABAY_API_KEY) {
      const u = new URL("https://pixabay.com/api/");
      u.search = new URLSearchParams({ key: process.env.PIXABAY_API_KEY, q, image_type: "photo", orientation: "vertical", safesearch: "true", per_page: "20", order: "popular" }).toString();
      const body = (await (await fetch(u)).json()) as { hits?: Array<{ largeImageURL?: string }> };
      const hits = (body.hits ?? []).filter((h) => h.largeImageURL);
      url = hits.length ? hits[Math.floor(Math.random() * Math.min(8, hits.length))].largeImageURL! : null;
    } else if (process.env.PEXELS_API_KEY) {
      const u = new URL("https://api.pexels.com/v1/search");
      u.search = new URLSearchParams({ query: q, orientation: "portrait", per_page: "15" }).toString();
      const body = (await (await fetch(u, { headers: { authorization: process.env.PEXELS_API_KEY } })).json()) as { photos?: Array<{ src?: { portrait?: string } }> };
      const hits = (body.photos ?? []).filter((p) => p.src?.portrait);
      url = hits.length ? hits[Math.floor(Math.random() * Math.min(8, hits.length))].src!.portrait! : null;
    }
    if (!url) return null;
    const img = await fetch(url);
    if (!img.ok) return null;
    const type = img.headers.get("content-type") ?? "image/jpeg";
    return `data:${type};base64,${Buffer.from(await img.arrayBuffer()).toString("base64")}`;
  } catch {
    return null;
  }
}

/** Live card drawing and storage for the content desk. */
export function liveDeskMedia(): DeskMedia {
  return {
    render: async (format, slides, brand, look) => {
      const l = (LOOKS as readonly string[]).includes(look?.look ?? "") ? (look!.look as Look) : "brand";
      const ill = (ILLUSTRATIONS as readonly string[]).includes(look?.illustration ?? "") ? (look!.illustration as Illustration) : null;
      const photo = l === "photo" ? await findPhoto(look?.photo_query ?? "") : null;
      return renderPost(format, slides, brand, { look: l, seed: look?.seed ?? 0, illustration: ill, photo });
    },
    store: (key, bytes) => fileStore().put(key, bytes, "image/jpeg"),
  };
}
