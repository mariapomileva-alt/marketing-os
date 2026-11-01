#!/usr/bin/env node
/**
 * Reel renderer for God of Marketing (runs on GitHub Actions next to the calm video renderer).
 *   1. Asks God of Marketing for the next Reel (POST {MOS_URL}/api/cron/reel-next, Bearer MOS_RENDER_TOKEN).
 *   2. Composes it in a headless browser: opening card with the hook, then by format: 2–3 scenes recorded from the
 *      real Back app (scripts/reels/shots) with captions and gentle zooms ("scenes"), calm lines shown one at a time
 *      ("read_slowly"), or a breathing circle to follow ("breathe_along"); the end card. Original synthesized music
 *      in the Reel's mood (scripts/reels/music.py).
 *   3. Uploads the MP4 to the one-time link and reports back (POST /api/cron/reel-done). Nothing is published here:
 *      the owner watches and approves each Reel in Ideas & hooks.
 * Local test: node scripts/render-reel.mjs --spec spec.json --out reel.mp4
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, "reels");
const WORK = path.resolve("out/reels");

// How each recorded scene is shown: how long, and where to zoom (app pixels on a 390×760 screen).
const SCENES = {
  home: { secs: 3.0, zooms: [] },
  breathe: { secs: 4.6, zooms: [[1.0, 1.25, 120]] },
  try_another: { secs: 3.8, from: 0.6, zooms: [[0, 1.3, 470], [1.2, 1.15, 30]] },
  ground: { secs: 4.0, zooms: [[0.8, 1.2, 260]] },
  listen: { secs: 4.0, zooms: [[0.8, 1.2, 150]] },
  move: { secs: 4.0, zooms: [[0.8, 1.2, 250]] },
  read: { secs: 3.6, zooms: [[0.6, 1.25, 160]] },
  distract: { secs: 3.6, zooms: [[0.8, 1.1, 40]] },
  call_person: { secs: 3.4, zooms: [[0.6, 1.25, 60]] },
};


// "explain" Reels: hand-drawn pictures that draw themselves (one line weight, round ends) and move a little.
const INK = "#2b2b2b";
const EX_BG = ["#dce6d6", "#f1d9c8", "#d5e2ec", "#efd6dc", "#ede3cc"];
const figure = (x, y) => `<circle class="d" pathLength="1" cx="${x}" cy="${y}" r="16"/><path class="d" pathLength="1" d="M${x} ${y + 16} L${x} ${y + 70} M${x} ${y + 34} L${x - 26} ${y + 58} M${x} ${y + 34} L${x + 26} ${y + 58} M${x} ${y + 70} L${x - 20} ${y + 108} M${x} ${y + 70} L${x + 20} ${y + 108}"/>`;
const DRAW = {
  wave: (a) => `<path class="d" pathLength="1" d="M20 250 C 110 250, 140 90, 200 90 S 290 250, 380 250" stroke="${a}" stroke-width="9"/>
    <path class="d" pathLength="1" d="M20 270 L380 270" stroke-width="4"/>
    <g class="mover"><animateMotion begin="indefinite" class="go" dur="4.5s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".45 .05 .55 .95" path="M20 250 C 110 250, 140 90, 200 90 S 290 250, 380 250"/>${figure(0, -112)}</g>`,
  alarm: (a) => `<circle class="d" pathLength="1" cx="200" cy="150" r="80"/><circle cx="200" cy="150" r="16" fill="${a}"/>
    <g stroke="${a}"><path class="d" pathLength="1" d="M90 70 L55 40 M310 70 L345 40 M80 150 L35 150 M320 150 L365 150 M90 230 L55 260 M310 230 L345 260"/>
    <animate attributeName="opacity" values="1;0.15;1" dur="0.7s" repeatCount="4" begin="indefinite" class="go" fill="freeze"/></g>`,
  ground: (a) => `${figure(200, 40)}<path class="d" pathLength="1" d="M60 170 L340 170"/>
    <g stroke="${a}"><path class="d" pathLength="1" d="M170 190 L170 250 M155 235 L170 250 L185 235 M230 190 L230 250 M215 235 L230 250 L245 235"/>
    <animateTransform attributeName="transform" type="translate" values="0 0;0 10;0 0" dur="1.6s" repeatCount="3" begin="indefinite" class="go"/></g>`,
  heart: (a) => `<g transform="translate(200 150)"><g><path class="d" pathLength="1" d="M0 95 C -150 10, -110 -90, -40 -76 C -12 -70, -3 -50, 0 -40 C 3 -50, 12 -70, 40 -76 C 110 -90, 150 10, 0 95 Z"/>
    <animateTransform attributeName="transform" type="scale" values="1;1.12;1;1.12;1;1.06;1" keyTimes="0;.12;.24;.36;.6;.8;1" dur="3.6s" begin="indefinite" class="go" fill="freeze"/></g></g>
    <path class="d" pathLength="1" d="M10 260 L90 260 L110 230 L130 290 L150 260 L250 260 L265 245 L280 275 L295 260 L390 260" stroke="${a}"/>`,
  moon: (a) => `<path class="d" pathLength="1" d="M300 40 C 240 55, 220 150, 290 195 C 220 215, 140 160, 155 90 C 165 45, 240 10, 300 40 Z" stroke="${a}"/>
    <rect class="d" pathLength="1" x="70" y="110" width="110" height="170" rx="18"/><text x="125" y="205" text-anchor="middle" font-family="Outfit" font-size="30" stroke="none" fill="${INK}" class="fade">3:04</text>
    <text x="330" y="250" font-family="Fraunces" font-size="34" stroke="none" fill="${a}" class="fade">z z</text>`,
  breath: (a) => `<g transform="translate(200 150)"><circle class="d" pathLength="1" r="110" stroke-width="4"/><circle r="55" fill="${a}" opacity=".85">
    <animate attributeName="r" values="55;105;105;55" keyTimes="0;.4;.5;1" dur="8s" begin="indefinite" class="go" fill="freeze"/></circle></g>`,
  five_things: (a) => `<path class="d" pathLength="1" d="M60 150 C 120 60, 280 60, 340 150 C 280 240, 120 240, 60 150 Z"/><circle cx="200" cy="150" r="34" fill="${a}"/>
    ${[1, 2, 3, 4, 5].map((n, i) => `<text x="${50 + i * 75}" y="290" font-family="Fraunces" font-size="40" fill="${INK}" stroke="none" class="pop" style="animation-delay:${0.6 + i * 0.45}s">${n}</text>`).join("")}`,
  bus: (a) => `<g><rect class="d" pathLength="1" x="40" y="60" width="300" height="150" rx="26"/><path class="d" pathLength="1" d="M60 100 L320 100 M40 170 L340 170"/>
    <circle class="d" pathLength="1" cx="110" cy="220" r="24"/><circle class="d" pathLength="1" cx="270" cy="220" r="24"/>
    <animateTransform attributeName="transform" type="translate" values="0 0;0 3;0 0" dur=".5s" repeatCount="6" begin="indefinite" class="go"/></g>
    <path class="d" pathLength="1" d="M20 260 L380 260" stroke="${a}"/>`,
};
const explainHtml = (steps, accent) => steps.map((st, i) => `<div class="ex" id="ex${i}" style="background:${EX_BG[i % EX_BG.length]}">
    <div class="exn">${i + 1} / ${steps.length}</div>
    <svg viewBox="0 -50 400 350" class="exs" overflow="visible">${(DRAW[st.visual] ?? DRAW.wave)(accent)}</svg>
    <h2>${esc(st.title)}</h2><p>${esc(st.text ?? "")}</p></div>`).join("");

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function page(spec) {
  const lines = spec.intro_lines.map((l) => `<span class="l">${esc(l)}</span>`).join("");
  const tone = spec.intro_style === "light" ? "light" : "dark";
  const calm = (spec.text_lines ?? []).map((l, i) => `<p class="rl" id="rl${i}">${esc(l)}</p>`).join("");
  const vids = (spec.scenes ?? []).map((s, i) => `<video id="v${i}" src="/shots/${s.shot}.webm" muted playsinline preload="auto"></video>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: Fraunces; src: url(/fraunces.woff) format("woff"); font-weight: 600; }
  @font-face { font-family: Outfit; src: url(/outfit.woff) format("woff"); font-weight: 400; }
  html, body { margin: 0; width: 540px; height: 960px; overflow: hidden; background: #f3ede1; font-family: Outfit, sans-serif; }
  #cap { position: absolute; left: 36px; right: 36px; top: 140px; min-height: 100px; display: flex; align-items: center; justify-content: center; text-align: center; z-index: 3;
         font-family: Fraunces, serif; font-weight: 600; font-size: 38px; line-height: 1.1; color: #0c3b2e; letter-spacing: -0.5px; transition: opacity .35s, transform .35s; }
  #cap.out { opacity: 0; transform: translateY(10px); }
  #stage { position: absolute; left: 0; right: 0; top: 250px; height: 640px; overflow: hidden; }
  #phone { position: absolute; left: 50%; top: 0; width: 390px; height: 760px; margin-left: -195px; transform-origin: 50% 0; transform: scale(.8);
           border-radius: 46px; overflow: hidden; box-shadow: 0 30px 60px -24px rgba(12,59,46,.4), 0 0 0 9px #0c3b2e; background: #f3ede1; transition: transform 1.1s cubic-bezier(.22,.8,.2,1); }
  #phone video { position: absolute; inset: 0; width: 390px; height: 760px; object-fit: cover; opacity: 0; }
  #phone video.on { opacity: 1; }
  .card { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; padding: 0 50px; box-sizing: border-box; transition: opacity .45s, transform .6s cubic-bezier(.22,.8,.2,1); z-index: 5; }
  .card.hidden { opacity: 0; } .card.up { transform: translateY(-100%); }
  .dark { background: #0c3b2e; color: #f3ede1; } .light { background: #f3ede1; color: #0c3b2e; }
  .card h1 { font-family: Fraunces, serif; font-weight: 600; font-size: 52px; line-height: 1.06; margin: 0; letter-spacing: -0.9px; }
  .card .l { display: block; opacity: 0; transform: translateY(12px); transition: opacity .4s, transform .4s; } .card .l.in { opacity: 1; transform: none; }
  .card p { font-size: 24px; line-height: 1.4; margin: 20px 0 0; }
  .brand { display: flex; align-items: center; gap: 12px; font-family: Fraunces, serif; font-size: 28px; margin-bottom: 30px; }
  .dot { width: 22px; height: 22px; border-radius: 50%; background: #d7e0d5; } .light .dot { background: #0c3b2e; }
  .badge { margin-top: 34px; align-self: flex-start; border: 2px solid #d7e0d5; border-radius: 14px; padding: 12px 22px; font-size: 22px; color: #f3ede1; }
  .fine { font-size: 15px !important; color: #9eb6b0; margin-top: 30px !important; }
  .panel { position: absolute; inset: 0; z-index: 4; display: none; overflow: hidden; }
  .panel.dark { background: #0c3b2e; } .panel.light { background: #f3ede1; }
  .glow { position: absolute; left: 50%; top: 50%; width: 520px; height: 520px; margin: -260px 0 0 -260px; border-radius: 50%; filter: blur(60px); opacity: .55;
          background: radial-gradient(circle, #6d9773 0%, rgba(109,151,115,0) 70%); animation: glow 10s ease-in-out infinite; }
  .light .glow { background: radial-gradient(circle, #d7e0d5 0%, rgba(215,224,213,0) 70%); opacity: .9; }
  @keyframes glow { 0%, 100% { transform: scale(.75); } 40% { transform: scale(1.1); } }
  .rl { position: absolute; left: 50px; right: 50px; top: 50%; transform: translateY(-40%); margin: 0; text-align: center; font-family: Fraunces, serif; font-weight: 600;
        font-size: 46px; line-height: 1.15; letter-spacing: -0.6px; opacity: 0; transition: opacity .9s, transform 1.4s cubic-bezier(.22,.8,.2,1); }
  .rl.in { opacity: 1; transform: translateY(-50%); }
  .dark .rl, .dark .bl, .dark .bn { color: #f3ede1; } .light .rl, .light .bl, .light .bn { color: #0c3b2e; }
  #circle { position: absolute; left: 50%; top: 42%; width: 380px; height: 380px; margin: -190px 0 0 -190px; border-radius: 50%; transform: scale(.45);
            background: radial-gradient(circle at 50% 40%, #a9c3ad, #6d9773); box-shadow: 0 0 0 14px rgba(215,224,213,.18), 0 0 80px rgba(169,195,173,.5); }
  .bl { position: absolute; left: 0; right: 0; top: 70%; text-align: center; font-family: Fraunces, serif; font-weight: 600; font-size: 44px; transition: opacity .5s; }
  .bn { position: absolute; left: 50px; right: 50px; top: 78%; text-align: center; font-size: 26px; line-height: 1.35; opacity: .8; transition: opacity .6s; }
  .bc { position: absolute; left: 0; right: 0; top: 12%; text-align: center; font-size: 20px; letter-spacing: 2px; opacity: .6; }
  .dark .bc { color: #d7e0d5; } .light .bc { color: #65736c; }
  #explain { background: #f6f1e7; }
  .ex { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; padding: 120px 44px 0; box-sizing: border-box; opacity: 0; transition: opacity .35s; }
  .ex.in { opacity: 1; }
  .exn { font-size: 20px; letter-spacing: 1px; color: #6f6a60; margin-bottom: 20px; }
  .exs { width: 452px; height: 340px; fill: none; stroke: ${INK}; stroke-width: 6; stroke-linecap: round; stroke-linejoin: round; }
  .exs .d { stroke-dasharray: 1; stroke-dashoffset: 1; }
  .ex.in .d { transition: stroke-dashoffset .9s cubic-bezier(.45,.05,.4,1); stroke-dashoffset: 0; }
  .exs .mover { opacity: 0; } .ex.in .mover { opacity: 1; }
  .exs .fade, .exs .pop { opacity: 0; } .ex.in .fade { transition: opacity .7s .6s; opacity: 1; }
  .ex.in .pop { animation: pop .5s forwards; } @keyframes pop { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  .ex h2 { font-family: Fraunces, serif; font-weight: 600; font-size: 42px; line-height: 1.1; color: ${INK}; text-align: center; margin: 34px 0 0; letter-spacing: -.5px;
           opacity: 0; transform: translateY(10px); transition: opacity .4s .3s, transform .4s .3s; }
  .ex p { font-size: 25px; line-height: 1.42; color: #4f4a42; text-align: center; margin: 18px 6px 0; opacity: 0; transition: opacity .5s .65s; }
  .ex.in h2 { opacity: 1; transform: none; } .ex.in p { opacity: 1; }
  .ex.in .exs { animation: floaty 4.2s ease-in-out 1s infinite; } @keyframes floaty { 0%, 100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-9px) rotate(-1deg); } }
  #hook { position: absolute; left: 34px; right: 34px; top: 46px; z-index: 6; padding: 18px 22px; border-radius: 22px; background: rgba(43,43,43,.88); color: #fffdf7;
          font-family: Fraunces, serif; font-weight: 600; font-size: 30px; line-height: 1.15; text-align: center; opacity: 0; transform: translateY(-10px); transition: opacity .4s, transform .4s; }
  #hook.in { opacity: 1; transform: none; }
</style></head><body>
  <div id="cap" class="out"></div>
  <div id="stage"><div id="phone">${vids}</div></div>
  <div id="read" class="panel ${tone}"><div class="glow"></div>${calm}</div>
  <div id="explain" class="panel">${explainHtml(spec.steps ?? [], "#bb8a52")}<div id="hook">${esc((spec.intro_lines ?? []).join(" "))}</div></div>
  <div id="breath" class="panel ${tone}"><div class="bc" id="bcount"></div><div id="circle"></div><div class="bl" id="blabel"></div><div class="bn" id="bnote"></div></div>
  <div id="intro" class="card ${spec.intro_style === "light" ? "light" : "dark"}"><div class="brand"><div class="dot"></div>Back</div><h1>${lines}</h1></div>
  <div id="end" class="card dark hidden"><div class="brand"><div class="dot"></div>Back</div><h1>Back: Panic Attack Help</h1><p style="color:#d7e0d5">Free on iPhone. Opens in one tap.</p><div class="badge">Get it free on the App Store</div><p class="fine">A self-help tool, not therapy or an emergency service.</p></div>
<script>
  const cap = document.getElementById('cap'), ph = document.getElementById('phone');
  window.setCaption = (t) => { cap.classList.add('out'); setTimeout(() => { cap.textContent = t; if (t) cap.classList.remove('out'); }, 360); };
  window.lines = () => [...document.querySelectorAll('#intro .l')].forEach((e, i) => setTimeout(() => e.classList.add('in'), 120 + i * 480));
  window.lift = () => document.getElementById('intro').classList.add('up');
  window.zoom = (s, y = 0, instant = false) => { ph.style.transition = instant ? 'none' : ''; ph.style.transform = 'translate(0px, ' + (-y * s) + 'px) scale(' + s + ')'; if (instant) void ph.offsetWidth; };
  window.scene = async (i, from) => { document.querySelectorAll('#phone video').forEach((v) => v.classList.remove('on')); const v = document.getElementById('v' + i); v.currentTime = from || 0; await v.play(); v.classList.add('on'); };
  window.endCard = () => document.getElementById('end').classList.remove('hidden');
  window.panel = (id) => { document.getElementById(id).style.display = 'block'; };
  window.readLine = (i) => { document.querySelectorAll('.rl').forEach((e) => e.classList.remove('in')); const e = document.getElementById('rl' + i); if (e) e.classList.add('in'); };
  window.breath = (inhale, secs, n, total, note) => {
    const c = document.getElementById('circle');
    c.style.transition = 'transform ' + secs + 's cubic-bezier(.45,.05,.55,.95)';
    c.style.transform = inhale ? 'scale(1)' : 'scale(.45)';
    document.getElementById('blabel').textContent = inhale ? 'Breathe in' : 'Breathe out';
    document.getElementById('bcount').textContent = n + ' / ' + total;
    if (inhale) { const b = document.getElementById('bnote'); b.style.opacity = 0; setTimeout(() => { b.textContent = note || ''; b.style.opacity = .8; }, 500); }
  };
  window.hook = (on) => document.getElementById('hook').classList.toggle('in', on);
  window.noIntro = () => { const e = document.getElementById('intro'); e.style.transition = 'none'; e.style.display = 'none'; };
  window.endOff = () => document.getElementById('end').classList.add('hidden');
  window.step = (i) => {
    document.querySelectorAll('.ex').forEach((e) => e.classList.remove('in'));
    const e = document.getElementById('ex' + i); if (!e) return;
    e.classList.add('in');
    e.querySelectorAll('.go').forEach((a) => { try { a.beginElement(); } catch (_) {} });
  };
  window.ready = () => Promise.all([...document.querySelectorAll('video')].map((v) => v.readyState >= 3 ? 1 : new Promise((r) => v.addEventListener('canplaythrough', r, { once: true }))));
</script></body></html>`;
}

function serve(spec) {
  const files = { "/fraunces.woff": path.join(ASSETS, "fraunces-latin-600-normal.woff"), "/outfit.woff": path.join(ASSETS, "outfit-latin-400-normal.woff") };
  const html = page(spec);
  const server = createServer((req, res) => {
    const u = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (u === "/") { res.writeHead(200, { "content-type": "text/html" }); return res.end(html); }
    const f = files[u] ?? (u.startsWith("/shots/") ? path.join(ASSETS, "shots", path.basename(u)) : null);
    if (!f || !existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": f.endsWith(".webm") ? "video/webm" : "font/woff", "content-length": statSync(f).size });
    createReadStream(f).pipe(res);
  });
  return new Promise((r) => server.listen(0, () => r(server)));
}

export async function renderReel(spec, outFile, seed = 1) {
  spec = { format: "scenes", music: "warm", scenes: [], text_lines: [], steps: [], ...spec };
  // Voice clips (explainers): local files with their lengths, so each step lasts as long as it is spoken.
  spec._voice = (spec.voice_files ?? []).map((file) => ({
    file, secs: Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim()) || 2,
  }));
  const { chromium } = await import("playwright");
  const server = await serve(spec);
  const port = server.address().port;
  const dir = path.join(WORK, `frames-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
    await p.evaluate(() => document.fonts.ready);
    await p.evaluate(() => window.ready());
    await p.waitForTimeout(500);
    const cdp = await ctx.newCDPSession(p);
    const frames = [];
    cdp.on("Page.screencastFrame", async (f) => { frames.push({ t: f.metadata.timestamp, data: f.data }); await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); });
    // Explainers open straight on the first drawing (also the cover frame): set it up before recording starts.
    if ((spec.format ?? "scenes") === "explain") await p.evaluate(() => { window.noIntro(); window.panel("explain"); window.hook(true); });
    await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: 1080, maxHeight: 1920 });
    const t0 = Date.now();
    const at = async (s) => { const w = t0 + s * 1000 - Date.now(); if (w > 0) await p.waitForTimeout(w); };
    const introSecs = Math.max(2.4, 0.7 + spec.intro_lines.length * 0.48);
    const cues = []; // voice clips: { at, file }
    const whoosh = []; // soft transition sounds (seconds)
    const format = spec.format ?? "scenes";
    if (format !== "explain") await p.evaluate(() => window.lines());
    let t = introSecs;
    if (format === "read_slowly") {
      await p.evaluate(() => window.panel("read"));
      await at(t - 0.5); await p.evaluate(() => window.lift());
      for (const [i, line] of spec.text_lines.entries()) {
        await at(t); await p.evaluate((i) => window.readLine(i), i);
        t += Math.min(4.4, Math.max(2.6, 1.6 + line.length * 0.055));
      }
      t += 0.6;
    } else if (format === "explain") {
      // No intro card: the first drawing starts at once with the hook on top; the voice reads the steps.
      const steps = spec.steps ?? [];
      const all = spec._voice ?? [];
      const vd = all.length === steps.length + 1 ? all.slice(1) : all; // older jobs also voiced the hook
      t = 0;
      await p.evaluate(() => { window.noIntro(); window.panel("explain"); window.step(0); window.hook(true); });
      for (const [i, st] of steps.entries()) {
        const voice = vd[i];
        if (i > 0) { await at(t); await p.evaluate((i) => window.step(i), i); whoosh.push(t); }
        cues.push({ at: t + (i === 0 ? 0.5 : 0.35), file: voice?.file });
        const secs = voice ? voice.secs + (i === 0 ? 0.9 : 0.6) : Math.min(5.5, Math.max(3.8, 2.6 + ((st.title?.length ?? 0) + (st.text?.length ?? 0)) * 0.026));
        if (i === 0) { await at(Math.min(2.4, secs - 0.4)); await p.evaluate(() => window.hook(false)); }
        t += secs;
      }
      t += 0.2;
    } else if (format === "breathe_along") {
      await p.evaluate(() => window.panel("breath"));
      await at(t - 0.5); await p.evaluate(() => window.lift());
      t += 0.4;
      for (let n = 0; n < 3; n++) {
        await at(t); await p.evaluate(([n, note]) => window.breath(true, 4, n + 1, 3, note), [n, spec.text_lines?.[n] ?? ""]);
        t += 4;
        await at(t); await p.evaluate((n) => window.breath(false, 6, n + 1, 3), n);
        t += 6;
      }
    }
    for (const [i, sc] of (format === "scenes" ? spec.scenes : []).entries()) {
      const def = SCENES[sc.shot];
      await at(t - 0.6);
      await p.evaluate(([i, from]) => { window.zoom(0.8, 0, true); return window.scene(i, from); }, [i, def.from ?? 0]);
      if (i === 0) await p.evaluate(() => window.lift());
      await p.evaluate((c) => window.setCaption(c), sc.caption);
      for (const [dt, s, y] of def.zooms) { await at(t + dt); await p.evaluate(([s, y]) => window.zoom(s, y), [s, y]); }
      t += def.secs;
    }
    const endAt = t;
    await at(endAt); await p.evaluate(() => window.endCard());
    let total = endAt + 2.8;
    if (format === "explain") {
      // Back to the first drawing, so the end flows into the start when the Reel loops.
      total = endAt + 2.3;
      await at(endAt + 1.7); await p.evaluate(() => { window.step(0); window.endOff(); });
      whoosh.push(endAt + 1.7);
    }
    await at(total);
    await cdp.send("Page.stopScreencast");
    await p.waitForTimeout(300);
    const t0s = t0 / 1000;
    const list = [`file '00000.png'\nduration ${Math.max(0, frames[0].t - t0s).toFixed(4)}`];
    frames.forEach((f, i) => {
      writeFileSync(path.join(dir, `${String(i).padStart(5, "0")}.png`), Buffer.from(f.data, "base64"));
      const d = i + 1 < frames.length ? frames[i + 1].t - f.t : Math.max(0.3, total - (f.t - t0s));
      list.push(`file '${String(i).padStart(5, "0")}.png'\nduration ${d.toFixed(4)}`);
    });
    list.push(`file '${String(frames.length - 1).padStart(5, "0")}.png'`);
    writeFileSync(path.join(dir, "list.txt"), list.join("\n"));
    const music = path.join(dir, "music.wav");
    // Soft ambient bed in the Reel's mood (no bells or melody): warm/piano → drift, night → tide, airy → glow.
    const bed = format === "explain" ? "tender" : ({ warm: "drift", piano: "drift", night: "tide", airy: "glow" }[spec.music] ?? "drift");
    execFileSync("python3", [path.join(ASSETS, "ambient_voice.py"), music, String(total), String(seed), bed]);
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", music, "-af", "loudnorm=I=-16:TP=-1.5:LRA=7", "-ar", "48000", path.join(dir, "music-n.wav")]);
    const voiced = cues.filter((c) => c.file);
    const audioIn = ["-i", path.join(dir, "music-n.wav")];
    const filt = [];
    let audioOut = "1:a";
    if (voiced.length || whoosh.length) {
      // Voice on top; a soft breath-like whoosh at each new step; the music ducks under the voice.
      voiced.forEach((c) => audioIn.push("-i", c.file));
      const sw = path.join(dir, "whoosh.wav");
      execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "anoisesrc=color=pink:duration=0.7:amplitude=0.5:sample_rate=48000",
        "-af", "highpass=f=250,lowpass=f=1600,afade=t=in:d=0.35,afade=t=out:st=0.35:d=0.35,volume=0.07,aformat=channel_layouts=stereo", sw]);
      whoosh.forEach(() => audioIn.push("-i", sw));
      const parts = [];
      voiced.forEach((c, i) => { filt.push(`[${i + 2}:a]aformat=sample_rates=48000:channel_layouts=stereo,loudnorm=I=-16:TP=-1.5,adelay=${Math.round(c.at * 1000)}:all=1[v${i}]`); parts.push(`[v${i}]`); });
      const wBase = voiced.length + 2;
      const wParts = whoosh.map((w, j) => { filt.push(`[${wBase + j}:a]adelay=${Math.round(Math.max(0, w - 0.3) * 1000)}:all=1[w${j}]`); return `[w${j}]`; });
      // Music well under the voice (about 16 dB), and it dips further while the voice speaks.
      filt.push(`[1:a]volume=${voiced.length ? 0.19 : 0.9}[bed]`);
      if (voiced.length) {
        filt.push(`${parts.join("")}amix=inputs=${parts.length}:normalize=0,apad,asplit=2[voice][side]`);
        filt.push(`[bed][side]sidechaincompress=threshold=0.02:ratio=8:attack=30:release=600[duck]`);
        filt.push(`[duck][voice]${wParts.join("")}amix=inputs=${2 + wParts.length}:normalize=0,alimiter=limit=0.95,loudnorm=I=-15:TP=-1.5:LRA=9[aout]`);
      } else {
        filt.push(`[bed]${wParts.join("")}amix=inputs=${1 + wParts.length}:normalize=0[aout]`);
      }
      audioOut = "[aout]";
    }
    if (process.env.REEL_DEBUG) console.log(JSON.stringify({ cues: voiced, whoosh, filt }, null, 1));
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", path.join(dir, "list.txt"), ...audioIn,
      ...(filt.length ? ["-filter_complex", filt.join(";")] : []), "-map", "0:v", "-map", audioOut,
      "-vf", "fps=30,scale=1080:1920:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-profile:v", "high", "-crf", "18", "-preset", "medium",
      "-c:a", "aac", "-b:a", "192k", "-t", String(total), "-movflags", "+faststart", outFile]);
    return { seconds: total };
  } finally {
    await browser.close();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function api(pathname, body) {
  const res = await fetch(`${process.env.MOS_URL.replace(/\/$/, "")}${pathname}`, {
    method: "POST", headers: { authorization: `Bearer ${process.env.MOS_RENDER_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(body ?? {}),
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`${pathname} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function main() {
  const args = process.argv.slice(2);
  mkdirSync(WORK, { recursive: true });
  if (args[0] === "--spec") {
    const spec = JSON.parse(readFileSync(args[1], "utf8"));
    const r = await renderReel(spec, args[3] ?? "reel.mp4");
    console.log(`Rendered ${r.seconds.toFixed(1)}s → ${args[3] ?? "reel.mp4"}`);
    return;
  }
  if (!process.env.MOS_URL || !process.env.MOS_RENDER_TOKEN) throw new Error("MOS_URL and MOS_RENDER_TOKEN are required.");
  for (let n = 0; n < 15; n++) {
    const job = await api("/api/cron/reel-next");
    if (!job) { console.log("No Reels waiting."); return; }
    const out = path.join(WORK, `${job.id}.mp4`);
    try {
      if (job.voice_urls?.length) {
        job.spec.voice_files = [];
        for (const [i, u] of job.voice_urls.entries()) {
          const f = path.join(WORK, `${job.id}-voice-${i}.mp3`);
          const res = await fetch(u);
          if (!res.ok) throw new Error(`Voice download failed ${res.status}`);
          writeFileSync(f, Buffer.from(await res.arrayBuffer()));
          job.spec.voice_files.push(f);
        }
      }
      const r = await renderReel(job.spec, out, Number(job.spec.seed) || (Date.now() % 97) + 1);
      const size = statSync(out).size;
      const up = await fetch(job.upload_url, { method: "PUT", headers: { "content-type": "video/mp4", "content-length": String(size) }, body: createReadStream(out), duplex: "half" });
      if (!up.ok) throw new Error(`Upload failed ${up.status}`);
      await api("/api/cron/reel-done", { id: job.id, storageKey: job.storageKey });
      console.log(`Reel ${job.id}: ${r.seconds.toFixed(1)}s uploaded.`);
    } catch (e) {
      console.error(e);
      await api("/api/cron/reel-done", { id: job.id, error: String(e.message ?? e).slice(0, 800) }).catch(() => undefined);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
