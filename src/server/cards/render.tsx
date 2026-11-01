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
  return toJpeg(<Card slide={slide} kind={kind} index={index} total={total} b={b} />);
}

async function toJpeg(el: React.ReactElement): Promise<Uint8Array> {
  const res = new ImageResponse(el, { ...CARD, fonts: await loadFonts() });
  const png = Buffer.from(await res.arrayBuffer());
  return new Uint8Array(await sharp(png).jpeg({ quality: 90, mozjpeg: true }).toBuffer());
}

// ---------------------------------------------------------------------------------------------------------------
// Looks: the same words can be drawn in very different ways, so the feed never looks like one template.
// ---------------------------------------------------------------------------------------------------------------
export const LOOKS = ["brand", "color", "rainbow", "note", "chat", "photo", "sketch"] as const;
export type Look = (typeof LOOKS)[number];
export const ILLUSTRATIONS = ["wave", "alarm", "ground", "heart", "moon", "breath"] as const;
export type Illustration = (typeof ILLUSTRATIONS)[number];
export interface LookOptions { look: Look; seed?: number; photo?: string | null; illustration?: Illustration | null }

/** Soft, calm colours (one per card in "rainbow"); the last one is a night colour with light text. */
const SOFT = [
  { bg: "#DCE6D6", ink: "#1E3A2F", sub: "#4F6A5C" },
  { bg: "#F1D9C8", ink: "#4A2A1C", sub: "#80594A" },
  { bg: "#D5E2EC", ink: "#1D3247", sub: "#4D6479" },
  { bg: "#EFD6DC", ink: "#4A2333", sub: "#7F5363" },
  { bg: "#EDE3CC", ink: "#3E3420", sub: "#6F6448" },
  { bg: "#26304A", ink: "#F3EDE1", sub: "#B9C0D3" },
  { bg: "#E3DDF0", ink: "#2E2547", sub: "#5F5679" },
  { bg: "#D7EDE6", ink: "#1C3D35", sub: "#4C6E64" },
  { bg: "#F6E7B8", ink: "#45391A", sub: "#7A6A3E" },
  { bg: "#4A5D4F", ink: "#F6F1E7", sub: "#CBD8CC" },
  { bg: "#F3E1D3", ink: "#4A3022", sub: "#7E5F4C" },
  { bg: "#5B4B6E", ink: "#F6F1F8", sub: "#D3C8DE" },
];

function Mark({ b, color }: { b: CardBrand; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 30, color }}>
      <div style={{ width: 22, height: 22, borderRadius: 22, background: color, opacity: 0.85 }} />
      <div style={{ fontFamily: "Fraunces", fontWeight: 500 }}>{b.brand}</div>
    </div>
  );
}

function ColorCard({ slide, index, total, c, b, closing }: { slide: CardSlide; index: number; total: number; c: (typeof SOFT)[number]; b: CardBrand; closing: boolean }) {
  const first = index === 0;
  return (
    <div style={{ width: CARD.width, height: CARD.height, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "96px 100px", background: c.bg, fontFamily: "Outfit" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 30, color: c.sub }}>
        <div />
        <div>{total > 1 ? `${index + 1} / ${total}` : ""}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 44 }}>
        <div style={{ fontFamily: "Fraunces", fontWeight: 600, fontSize: first ? fit(slide.title, 104, 60) : fit(slide.title, 76, 50), lineHeight: 1.08, color: c.ink, letterSpacing: -1.5 }}>{slide.title}</div>
        {slide.text ? <div style={{ fontSize: fit(slide.text, 48, 38), lineHeight: 1.42, color: c.sub }}>{slide.text}</div> : null}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", fontSize: 26, color: c.sub }}>
        <Mark b={b} color={c.ink} />
        {closing && b.note ? <div style={{ maxWidth: 560, textAlign: "right" }}>{b.note}</div> : first && total > 1 ? <div>Swipe</div> : <div />}
      </div>
    </div>
  );
}

function NoteCard({ slide, index, total, b, closing }: { slide: CardSlide; index: number; total: number; b: CardBrand; closing: boolean }) {
  return (
    <div style={{ width: CARD.width, height: CARD.height, display: "flex", flexDirection: "column", background: "#FFFDF7", fontFamily: "Outfit" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "56px 64px 28px", color: "#D9A21B", fontSize: 42 }}>
        <div style={{ display: "flex" }}>‹ Notes</div>
        <div style={{ display: "flex", fontSize: 30 }}>{total > 1 ? `${index + 1}/${total}` : "Done"}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", padding: "24px 72px", gap: 30, flexGrow: 1 }}>
        <div style={{ fontSize: 30, color: "#9A958A" }}>{index === 0 ? "pinned · for the hard moments" : "continued"}</div>
        <div style={{ fontWeight: 500, fontSize: fit(slide.title, 84, 56), lineHeight: 1.18, color: "#1F1F1F" }}>{slide.title}</div>
        {slide.text ? <div style={{ fontSize: Math.max(40, fit(slide.text, 56, 40)), lineHeight: 1.5, color: "#3A3A3A", whiteSpace: "pre-wrap" }}>{slide.text}</div> : null}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "0 72px 64px", fontSize: 26, color: "#9A958A" }}>
        <div>{b.brand}</div>
        {closing && b.note ? <div style={{ maxWidth: 600, textAlign: "right" }}>{b.note}</div> : <div />}
      </div>
    </div>
  );
}

/** "Name: words" lines become chat bubbles; the first speaker on the left, "me"/"you" on the right. */
function ChatCard({ slide, index, total, b, closing }: { slide: CardSlide; index: number; total: number; b: CardBrand; closing: boolean }) {
  const lines = slide.text.split(/\n|\s\/\s/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = /^([^:]{1,18}):\s*(.+)$/.exec(l);
    return m ? { who: m[1].trim(), text: m[2] } : { who: "", text: l };
  });
  const other = lines.find((l) => l.who && !/^(me|you|i)$/i.test(l.who))?.who ?? "my brain";
  return (
    <div style={{ width: CARD.width, height: CARD.height, display: "flex", flexDirection: "column", background: "#F2F2F7", fontFamily: "Outfit" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "52px 0 30px", background: "#F9F9FB", borderBottom: "2px solid #E3E3EA" }}>
        <div style={{ width: 92, height: 92, borderRadius: 92, background: "#8FA3B8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 44, color: "#FFFFFF", fontFamily: "Fraunces" }}>{other.slice(0, 1).toUpperCase()}</div>
        <div style={{ fontSize: 32, color: "#1F1F1F", fontWeight: 500 }}>{other}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "40px 56px", gap: 28, flexGrow: 1 }}>
        <div style={{ alignSelf: "center", fontSize: 30, color: "#8E8E93" }}>{slide.title}</div>
        {lines.slice(0, 6).map((l, i) => {
          const mine = /^(me|you|i)$/i.test(l.who);
          return (
            <div key={i} style={{ display: "flex", alignSelf: mine ? "flex-end" : "flex-start", maxWidth: 820, padding: "28px 38px", borderRadius: 48, fontSize: Math.max(42, fit(l.text, 52, 42)), lineHeight: 1.28, background: mine ? "#2F7D5B" : "#E5E5EA", color: mine ? "#FFFFFF" : "#1F1F1F" }}>{l.text}</div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "0 56px 52px", fontSize: 26, color: "#8E8E93" }}>
        <div>{`${b.brand}${total > 1 ? ` · ${index + 1}/${total}` : ""}`}</div>
        {closing && b.note ? <div style={{ maxWidth: 620, textAlign: "right" }}>{b.note}</div> : <div />}
      </div>
    </div>
  );
}

function PhotoCard({ slide, photo, b, total }: { slide: CardSlide; photo: string; b: CardBrand; total: number }) {
  return (
    <div style={{ width: CARD.width, height: CARD.height, display: "flex", position: "relative", fontFamily: "Outfit" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo} width={CARD.width} height={CARD.height} style={{ position: "absolute", top: 0, left: 0, width: CARD.width, height: CARD.height, objectFit: "cover" }} alt="" />
      <div style={{ position: "absolute", top: 0, left: 0, width: CARD.width, height: CARD.height, backgroundImage: "linear-gradient(180deg, rgba(0,0,0,0.05) 30%, rgba(0,0,0,0.62) 100%)" }} />
      <div style={{ position: "absolute", left: 96, right: 96, bottom: 110, display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ fontFamily: "Fraunces", fontWeight: 600, fontSize: fit(slide.title, 92, 56), lineHeight: 1.1, color: "#FFFFFF", letterSpacing: -1 }}>{slide.title}</div>
        {slide.text ? <div style={{ fontSize: fit(slide.text, 40, 30), lineHeight: 1.4, color: "#F1F1F1" }}>{slide.text}</div> : null}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26, color: "#E8E8E8" }}>
          <div>{b.brand}</div>
          <div>{total > 1 ? "Swipe" : ""}</div>
        </div>
      </div>
    </div>
  );
}

const STROKE = { stroke: "#2B2B2B", strokeWidth: 7, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
/** Small hand-drawn style pictures (one line weight, round ends). */
function Drawing({ kind, accent }: { kind: Illustration; accent: string }) {
  const figure = (x: number, y: number) => (
    <g>
      <circle cx={x} cy={y} r={26} {...STROKE} />
      <path d={`M${x} ${y + 26} L${x} ${y + 110} M${x} ${y + 55} L${x - 40} ${y + 90} M${x} ${y + 55} L${x + 40} ${y + 90} M${x} ${y + 110} L${x - 32} ${y + 170} M${x} ${y + 110} L${x + 32} ${y + 170}`} {...STROKE} />
    </g>
  );
  const pics: Record<Illustration, React.ReactElement> = {
    wave: (<g><path d="M40 300 C 160 300, 200 120, 330 120 S 500 300, 620 300" {...STROKE} stroke={accent} strokeWidth={10} /><path d="M40 330 L 620 330" {...STROKE} strokeWidth={4} />{figure(330, -60)}</g>),
    alarm: (<g><circle cx={330} cy={170} r={110} {...STROKE} /><circle cx={330} cy={170} r={22} fill={accent} stroke="none" /><path d="M170 70 L120 30 M490 70 L540 30 M150 170 L90 170 M510 170 L570 170 M175 270 L125 310 M485 270 L535 310" {...STROKE} stroke={accent} /></g>),
    ground: (<g>{figure(330, 20)}<path d="M120 200 L540 200" {...STROKE} /><path d="M270 225 L270 300 M250 280 L270 300 L290 280 M390 225 L390 300 M370 280 L390 300 L410 280" {...STROKE} stroke={accent} /></g>),
    heart: (<g><path d="M330 300 C 120 180, 170 40, 270 60 C 310 68, 325 95, 330 110 C 335 95, 350 68, 390 60 C 490 40, 540 180, 330 300 Z" {...STROKE} /><path d="M80 150 L150 150 L175 110 L205 200 L230 150 L270 150" {...STROKE} stroke={accent} /><path d="M390 150 L430 150 L450 125 L470 175 L490 150 L580 150" {...STROKE} stroke={accent} /></g>),
    moon: (<g><path d="M420 40 C 330 60, 300 200, 400 270 C 300 300, 190 220, 210 120 C 225 50, 330 0, 420 40 Z" {...STROKE} stroke={accent} /><rect x={150} y={150} width={150} height={220} rx={24} {...STROKE} /><path d="M195 250 L255 250" {...STROKE} /></g>),
    breath: (<g><circle cx={330} cy={180} r={70} {...STROKE} stroke={accent} /><circle cx={330} cy={180} r={140} {...STROKE} strokeWidth={4} /><path d="M330 20 L330 0 M330 360 L330 340 M170 180 L150 180 M510 180 L490 180" {...STROKE} /></g>),
  };
  return <svg width={820} height={520} viewBox="0 -100 660 480">{pics[kind]}</svg>;
}

function SketchCard({ slide, index, total, b, closing, ill, accent }: { slide: CardSlide; index: number; total: number; b: CardBrand; closing: boolean; ill: Illustration; accent: string }) {
  return (
    <div style={{ width: CARD.width, height: CARD.height, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", padding: "90px 96px", background: "#F6F1E7", fontFamily: "Outfit" }}>
      <div style={{ display: "flex", alignSelf: "stretch", justifyContent: "space-between", fontSize: 28, color: "#7A7468" }}>
        <div>{b.brand}</div>
        <div>{total > 1 ? `${index + 1} / ${total}` : ""}</div>
      </div>
      {index === 0 ? <Drawing kind={ill} accent={accent} /> : null}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 30, textAlign: "center" }}>
        <div style={{ fontFamily: "Fraunces", fontWeight: 600, fontSize: index === 0 ? fit(slide.title, 84, 54) : fit(slide.title, 74, 50), lineHeight: 1.12, color: "#2B2B2B", letterSpacing: -1 }}>{slide.title}</div>
        {slide.text ? <div style={{ fontSize: fit(slide.text, 42, 32), lineHeight: 1.45, color: "#5E584D" }}>{slide.text}</div> : null}
      </div>
      <div style={{ display: "flex", fontSize: 26, color: "#7A7468", textAlign: "center" }}>{closing && b.note ? b.note : index === 0 && total > 1 ? "Swipe" : ""}</div>
    </div>
  );
}

/** One card in the chosen look. Photo falls back to colour when there is no photo; inner photo slides use colour. */
export async function renderLookCard(slide: CardSlide, index: number, total: number, b: CardBrand, o: LookOptions): Promise<Uint8Array> {
  const closing = total > 1 && index === total - 1;
  const seed = o.seed ?? 0;
  const kind: CardKind = total === 1 ? "single" : index === 0 ? "cover" : closing ? "closing" : "inner";
  switch (o.look) {
    case "color": return toJpeg(<ColorCard slide={slide} index={index} total={total} c={SOFT[seed % SOFT.length]} b={b} closing={closing} />);
    case "rainbow": return toJpeg(<ColorCard slide={slide} index={index} total={total} c={SOFT[(seed + index) % SOFT.length]} b={b} closing={closing} />);
    case "note": return toJpeg(<NoteCard slide={slide} index={index} total={total} b={b} closing={closing} />);
    case "chat": return toJpeg(<ChatCard slide={slide} index={index} total={total} b={b} closing={closing} />);
    case "sketch": return toJpeg(<SketchCard slide={slide} index={index} total={total} b={b} closing={closing} ill={o.illustration ?? ILLUSTRATIONS[seed % ILLUSTRATIONS.length]} accent={b.colors.accent2} />);
    case "photo":
      if (o.photo && index === 0) return toJpeg(<PhotoCard slide={slide} photo={o.photo} b={b} total={total} />);
      return toJpeg(<ColorCard slide={slide} index={index} total={total} c={SOFT[(seed + index) % SOFT.length]} b={b} closing={closing} />);
    default: return toJpeg(<Card slide={slide} kind={kind} index={index} total={total} b={b} />);
  }
}

/** All images for one post: a single card, or cover + inner slides + a closing slide for a carousel. */
export async function renderPost(format: "static_concept" | "carousel", slides: CardSlide[], b: CardBrand = BACK_CARD, o: LookOptions = { look: "brand" }) {
  const all = format === "static_concept" ? slides.slice(0, 1) : slides.slice(0, 10);
  return Promise.all(all.map((s, i) => renderLookCard(s, i, all.length, b, o)));
}
