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
const C = { ivory: "#f3ede1", forest: "#0c3b2e", ink: "#153c32", muted: "#65736c", sage: "#6d9773", pale: "#d7e0d5", clay: "#bb8a52" };

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

function Brand({ dark }: { dark: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ width: 34, height: 34, borderRadius: 34, background: dark ? C.pale : C.forest }} />
      <div style={{ fontFamily: "Fraunces", fontWeight: 500, fontSize: 38, color: dark ? C.ivory : C.forest }}>Back</div>
    </div>
  );
}

function Card({ slide, kind, index, total }: { slide: CardSlide; kind: CardKind; index: number; total: number }) {
  const dark = kind === "cover" || kind === "single";
  const fg = dark ? C.ivory : C.ink;
  const sub = dark ? C.pale : C.muted;
  return (
    <div style={{ width: CARD.width, height: CARD.height, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "88px 96px", background: dark ? C.forest : C.ivory, fontFamily: "Outfit" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Brand dark={dark} />
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
        {kind === "cover" && total > 1 ? <div>Swipe</div> : kind === "closing" || kind === "single" ? <div>Back panic app · free on iPhone</div> : <div />}
        {kind === "closing" ? <div style={{ maxWidth: 520, textAlign: "right" }}>In danger right now? Call your local emergency number.</div> : <div />}
      </div>
    </div>
  );
}

export async function renderCard(slide: CardSlide, kind: CardKind, index: number, total: number): Promise<Uint8Array> {
  const res = new ImageResponse(<Card slide={slide} kind={kind} index={index} total={total} />, { ...CARD, fonts: await loadFonts() });
  const png = Buffer.from(await res.arrayBuffer());
  return new Uint8Array(await sharp(png).jpeg({ quality: 90, mozjpeg: true }).toBuffer());
}

/** All images for one post: a single card, or cover + inner slides + a closing slide for a carousel. */
export async function renderPost(format: "static_concept" | "carousel", slides: CardSlide[]) {
  if (format === "static_concept") return [await renderCard(slides[0], "single", 0, 1)];
  const all = slides.slice(0, 10);
  return Promise.all(all.map((s, i) => renderCard(s, i === 0 ? "cover" : i === all.length - 1 ? "closing" : "inner", i, all.length)));
}
