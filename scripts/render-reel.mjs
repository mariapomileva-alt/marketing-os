#!/usr/bin/env node
/**
 * Reel renderer for God of Marketing (runs on GitHub Actions next to the calm video renderer).
 *   1. Asks God of Marketing for the next Reel (POST {MOS_URL}/api/cron/reel-next, Bearer MOS_RENDER_TOKEN).
 *   2. Composes it in a headless browser: opening card with the hook, 2–3 scenes recorded from the real Back app
 *      (scripts/reels/shots) with captions and gentle zooms, the end card. Original synthesized music.
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

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function page(spec) {
  const lines = spec.intro_lines.map((l) => `<span class="l">${esc(l)}</span>`).join("");
  const vids = spec.scenes.map((s, i) => `<video id="v${i}" src="/shots/${s.shot}.webm" muted playsinline preload="auto"></video>`).join("");
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
</style></head><body>
  <div id="cap" class="out"></div>
  <div id="stage"><div id="phone">${vids}</div></div>
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
    await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: 1080, maxHeight: 1920 });
    const t0 = Date.now();
    const at = async (s) => { const w = t0 + s * 1000 - Date.now(); if (w > 0) await p.waitForTimeout(w); };
    const introSecs = Math.max(2.4, 0.7 + spec.intro_lines.length * 0.48);
    await p.evaluate(() => window.lines());
    let t = introSecs;
    for (const [i, sc] of spec.scenes.entries()) {
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
    const total = endAt + 2.8;
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
    execFileSync("python3", [path.join(ASSETS, "music.py"), music, String(total), String(endAt), String(seed)]);
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", music, "-af", "loudnorm=I=-16:TP=-1.5:LRA=7", "-ar", "48000", path.join(dir, "music-n.wav")]);
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", path.join(dir, "list.txt"), "-i", path.join(dir, "music-n.wav"),
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
  for (let n = 0; n < 6; n++) {
    const job = await api("/api/cron/reel-next");
    if (!job) { console.log("No Reels waiting."); return; }
    const out = path.join(WORK, `${job.id}.mp4`);
    try {
      const r = await renderReel(job.spec, out, (Date.now() % 97) + 1);
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
