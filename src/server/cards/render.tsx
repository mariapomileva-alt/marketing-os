import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";

/**
 * Instagram cards in Back's own look (the website's palette and type: Fraunces headlines, Outfit text), 1080×1350.
 * The cover is forest green with an ivory headline; inner slides are ivory. Rendered on our server to JPEG, the
 * format Instagram accepts for feed images.
 */
export const CARD = { width: 1080, height: 1350 };
/** What a card shows of the product: its brand word, footer, closing note and colours (from the marketing brief). */
export interface CardBrand {
  brand: string;
  footer: string;
  note: string;
  colors: { dark: string; light: string; ink: string; muted: string; pale: string; accent: string; accent2: string };
}
export const BACK_CARD: CardBrand = {
  brand: "Back", footer: "Back panic app · free on iPhone", note: "In danger right now? Call your local emergency number.",
  colors: { dark: "#0c3b2e", light: "#f3ede1", ink: "#153c32", muted: "#65736c", pale: "#d7e0d5", accent: "#6d9773", accent2: "#bb8a52" },
};

let fonts: Promise<Array<{ name: string; data: Buffer; weight: 400 | 500 | 600; style: "normal" }>> | null = null;
function loadFonts() {
  const dir = path.join(process.cwd(), "src/server/cards/fonts");
  fonts ??= Promise.all([
    readFile(path.join(dir, "fraunces-latin-500-normal.woff")).then((data) => ({ name: "Fraunces", data, weight: 500 as const, style: "normal" as const })),
    readFile(path.join(dir, "fraunces-latin-600-normal.woff")).then((data) => ({ name: "Fraunces", data, weight: 600 as const, style: "normal" as const })),
    readFile(path.join(dir, "outfit-latin-400-normal.woff")).then((data) => ({ name: "Outfit", data, weight: 400 as const, style: "normal" as const })),
    readFile(path.join(dir, "outfit-latin-500-normal.woff")).then((data) => ({ name: "Outfit", data, weight: 500 as const, style: "normal" as const })),
  ]);
  return fonts;
}

export type CardSlide = { title: string; text: string };
export type CardKind = "cover" | "inner" | "closing" | "single";

/** Headline size that keeps long hooks inside the card. */
function fit(text: string, base: number, min: number) {
  const n = text.length;
  return Math.max(min, Math.round(n <= 40 ? base : base * Math.sqrt(40 / n)));
}

function Brand({ dark, b }: { dark: boolean; b: CardBrand }) {
  const C = b.colors;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ width: 34, height: 34, borderRadius: 34, background: dark ? C.pale : C.dark }} />
      <div style={{ fontFamily: "Fraunces", fontWeight: 500, fontSize: 38, color: dark ? C.light : C.dark }}>{b.brand}</div>
    </div>
  );
}

function Card({ slide, kind, index, total, b }: { slide: CardSlide; kind: CardKind; index: number; total: number; b: CardBrand }) {
  const C = { ivory: b.colors.light, forest: b.colors.dark, ink: b.colors.ink, muted: b.colors.muted, sage: b.colors.accent, pale: b.colors.pale, clay: b.colors.accent2 };
  const dark = kind === "cover" || kind === "single";
  const fg = dark ? C.ivory : C.ink;
  const sub = dark ? C.pale : C.muted;
  return (
    <div style={{ width: CARD.width, height: CARD.height, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "88px 96px", background: dark ? C.forest : C.ivory, fontFamily: "Outfit" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Brand dark={dark} b={b} />
        {total > 1 ? <div style={{ fontSize: 30, color: sub }}>{`${index + 1} / ${total}`}</div> : <div />}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
        {kind !== "cover" && kind !== "single" ? <div style={{ width: 72, height: 6, background: kind === "closing" ? C.clay : C.sage, borderRadius: 6 }} /> : null}
        <div style={{ fontFamily: "Fraunces", fontWeight: 600, fontSize: kind === "cover" || kind === "single" ? fit(slide.title, 96, 58) : fit(slide.title, 72, 50), lineHeight: 1.12, color: fg, letterSpacing: -1 }}>
          {slide.title}
        </div>
        {slide.text ? <div style={{ fontSize: fit(slide.text, 42, 32), lineHeight: 1.4, color: sub }}>{slide.text}</div> : null}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", fontSize: 28, color: sub }}>
        {kind === "cover" && total > 1 ? <div>Swipe</div> : kind === "closing" || kind === "single" ? <div>{b.footer}</div> : <div />}
        {kind === "closing" && b.note ? <div style={{ maxWidth: 520, textAlign: "right" }}>{b.note}</div> : <div />}
      </div>
    </div>
  );
}

export async function renderCard(slide: CardSlide, kind: CardKind, index: number, total: number, b: CardBrand = BACK_CARD): Promise<Uint8Array> {
  const res = new ImageResponse(<Card slide={slide} kind={kind} index={index} total={total} b={b} />, { ...CARD, fonts: await loadFonts() });
  const png = Buffer.from(await res.arrayBuffer());
  return new Uint8Array(await sharp(png).jpeg({ quality: 90, mozjpeg: true }).toBuffer());
}

/** All images for one post: a single card, or cover + inner slides + a closing slide for a carousel. */
export async function renderPost(format: "static_concept" | "carousel", slides: CardSlide[], b: CardBrand = BACK_CARD) {
  if (format === "static_concept") return [await renderCard(slides[0], "single", 0, 1, b)];
  const all = slides.slice(0, 10);
  return Promise.all(all.map((s, i) => renderCard(s, i === 0 ? "cover" : i === all.length - 1 ? "closing" : "inner", i, all.length, b)));
}
