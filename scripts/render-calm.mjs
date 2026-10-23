#!/usr/bin/env node
/**
 * Calm video renderer (runs on GitHub Actions, see .github/workflows/calm-render.yml). Plain Node + ffmpeg.
 *
 *   1. Asks Marketing OS for the next job (POST {MOS_URL}/api/cron/calm-next, Bearer MOS_RENDER_TOKEN).
 *   2. Downloads the voice lines and nature clips, renders a 1080p video: clips with slow cross-fades, each line
 *      fading in and out on screen, the voice over a soft generated ambient pad that ducks under the voice.
 *   3. Uploads it to the YouTube upload session Marketing OS opened (the video is PRIVATE), reports back.
 *
 * Nothing here can publish: the owner approves the private video in Marketing OS, which schedules it.
 * Local test without Marketing OS: node scripts/render-calm.mjs --local job.json out.mp4
 */
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const W = 1920;
const H = 1080;
const FPS = 24;
const XFADE = 2.5;

async function ffmpeg(args, label) {
  try {
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    throw new Error(`ffmpeg failed (${label}): ${String(e.stderr || e.message).slice(-1500)}`);
  }
}

async function duration(file) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  return Number.parseFloat(stdout.trim());
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status} for ${new URL(url).host}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/** Wraps a line for the screen: about 28 characters per row, never more than 3 rows. */
export function wrap(text, width = 28) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const rows = [];
  let row = "";
  for (const w of words) {
    if ((row + " " + w).trim().length > width && row) {
      rows.push(row);
      row = w;
    } else row = (row + " " + w).trim();
  }
  if (row) rows.push(row);
  return rows.slice(0, 3).join("\n");
}

/**
 * Timeline: a quiet intro, then each line (spoken duration + pause), then an outro. Pauses are stretched (up to 2.5x)
 * when the script is shorter than the target length, so the video still breathes rather than rushes.
 */
export function timeline(lines, durations, minutes) {
  const intro = 6;
  const outro = 14;
  const spoken = durations.reduce((a, b) => a + b, 0);
  const pauses = lines.reduce((a, l) => a + l.pause, 0);
  const target = minutes * 60 - intro - outro;
  const stretch = Math.min(2.5, Math.max(1, (target - spoken) / Math.max(1, pauses)));
  let t = intro;
  const items = lines.map((l, i) => {
    const start = t;
    const end = start + durations[i];
    const pause = l.pause * stretch;
    t = end + pause;
    // On screen a little before the voice and through most of the pause.
    return { text: l.text, start, end, showFrom: Math.max(0, start - 0.4), showTo: end + Math.max(1.5, pause * 0.75) };
  });
  return { intro, items, total: t + outro, outroFrom: t };
}

function alphaExpr(a, b) {
  const fi = 1.0;
  const fo = 1.2;
  return `if(lt(t,${a.toFixed(2)}),0,if(lt(t,${(a + fi).toFixed(2)}),(t-${a.toFixed(2)})/${fi},if(lt(t,${(b - fo).toFixed(2)}),1,if(lt(t,${b.toFixed(2)}),(${b.toFixed(2)}-t)/${fo},0))))`;
}

export async function render(job, out, work) {
  await mkdir(work, { recursive: true });
  // 1. Voice lines
  const voice = [];
  for (const [i, l] of job.lines.entries()) voice.push(l.audio_file ?? (await download(l.audio_url, path.join(work, `v${i}.mp3`))));
  const durations = [];
  for (const f of voice) durations.push(await duration(f));
  const tl = timeline(job.lines, durations, job.minutes ?? 10);
  const T = Math.ceil(tl.total);

  // 2. Background: normalized clip segments with cross-fades, or a slow generated gradient when there are no clips.
  const bg = path.join(work, "bg.mp4");
  const clips = (job.clips ?? []).slice(0, 10);
  if (clips.length) {
    const seg = (T + XFADE * (clips.length - 1)) / clips.length;
    const segs = [];
    for (const [i, c] of clips.entries()) {
      const src = c.file ?? (await download(c.url, path.join(work, `c${i}.mp4`)));
      const dst = path.join(work, `s${i}.mp4`);
      // Loop short clips, fill 1920x1080, slow them a little (calmer motion), no audio.
      await ffmpeg(["-stream_loop", "-1", "-i", src, "-t", seg.toFixed(2), "-an",
        "-vf", `setpts=1.25*PTS,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},format=yuv420p`,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", dst], `clip ${i}`);
      segs.push(dst);
    }
    if (segs.length === 1) {
      await ffmpeg(["-i", segs[0], "-c", "copy", bg], "background");
    } else {
      const inputs = segs.flatMap((s) => ["-i", s]);
      let chain = "";
      let prev = "[0:v]";
      for (let i = 1; i < segs.length; i++) {
        const offset = (seg - XFADE) * i;
        const label = i === segs.length - 1 ? "[bg]" : `[x${i}]`;
        chain += `${prev}[${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${offset.toFixed(2)}${label};`;
        prev = label;
      }
      await ffmpeg([...inputs, "-filter_complex", chain.replace(/;$/, ""), "-map", "[bg]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-t", String(T), bg], "background");
    }
  } else {
    await ffmpeg(["-f", "lavfi", "-i", `gradients=s=${W}x${H}:c0=0x1f3b33:c1=0x5f7f6f:c2=0x2c4a5a:c3=0x8aa39a:nb_colors=4:speed=0.004:r=${FPS}:d=${T}`,
      "-vf", "gblur=sigma=30,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", bg], "gradient background");
  }

  // 3. Text overlay and audio mix in one pass.
  const font = job.font_file;
  const filters = [`[0:v]drawbox=x=0:y=0:w=iw:h=ih:color=black@0.22:t=fill[v0]`];
  let v = "v0";
  // Each row is drawn on its own so that every row is centred (drawtext aligns multi-line text to the left).
  let n = 0;
  const draw = async (text, a, b, size, centerY = H / 2) => {
    const rows = text.split("\n");
    for (const [r, row] of rows.entries()) {
      const file = path.join(work, `t${n}.txt`);
      await writeFile(file, row);
      const y = Math.round(centerY + (r - (rows.length - 1) / 2) * size * 1.42 - size * 0.62);
      filters.push(`[${v}]drawtext=fontfile='${font}':textfile='${file}':fontsize=${size}:fontcolor=white:x=(w-text_w)/2:y=${y}:shadowcolor=black@0.35:shadowx=0:shadowy=2:alpha='${alphaExpr(a, b)}':enable='between(t,${a.toFixed(2)},${b.toFixed(2)})'[v${n + 1}]`);
      v = `v${n + 1}`;
      n++;
    }
  };
  await draw(wrap(job.intro_text ?? "Take a moment. You are here.", 30), 0.5, tl.intro + 0.5, 58);
  for (const it of tl.items) await draw(wrap(it.text), it.showFrom, Math.min(it.showTo, T - 0.1), 66);
  await draw(job.outro_title ?? "Made by the team behind Back", tl.outroFrom + 1, T - 0.5, 54, H / 2 - 40);
  await draw(job.outro_line ?? "a small app for the first minutes of panic", tl.outroFrom + 2, T - 0.5, 36, H / 2 + 50);

  // Voice: each line placed at its start time.
  const voiceInputs = voice.flatMap((f) => ["-i", f]);
  const vi = voice.map((_, i) => `[${i + 1}:a]adelay=${Math.round(tl.items[i].start * 1000)}:all=1,volume=1.0[a${i}]`);
  filters.push(...vi);
  filters.push(`${voice.map((_, i) => `[a${i}]`).join("")}amix=inputs=${voice.length}:normalize=0:dropout_transition=0,apad,atrim=0:${T},asplit=2[voice][side]`);
  // Ambient pad: a soft chord with slow movement plus a little brown noise, generated here (no licensing questions).
  const pad = `aevalsrc='0.05*sin(2*PI*110*t)*(0.6+0.4*sin(2*PI*0.05*t))+0.04*sin(2*PI*164.81*t)*(0.6+0.4*sin(2*PI*0.031*t))+0.035*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*0.043*t))+0.025*sin(2*PI*277.18*t)*(0.5+0.5*sin(2*PI*0.027*t))':s=44100:d=${T}`;
  const padIdx = voice.length + 1;
  const noiseIdx = voice.length + 2;
  filters.push(`[${padIdx}:a]lowpass=f=900,aecho=0.8:0.7:120|240:0.35|0.25,volume=0.9[padv]`);
  filters.push(`[${noiseIdx}:a]lowpass=f=500,volume=0.25[noise]`);
  filters.push(`[padv][noise]amix=inputs=2:normalize=0,afade=t=in:d=4,afade=t=out:st=${T - 6}:d=6[music]`);
  filters.push(`[music][side]sidechaincompress=threshold=0.03:ratio=5:attack=30:release=600[ducked]`);
  filters.push(`[ducked][voice]amix=inputs=2:normalize=0,alimiter=limit=0.9[aout]`);

  const script = path.join(work, "filters.txt");
  await writeFile(script, filters.join(";\n"));
  await ffmpeg([
    "-i", bg, ...voiceInputs,
    "-f", "lavfi", "-i", pad,
    "-f", "lavfi", "-i", `anoisesrc=color=brown:amplitude=0.05:d=${T}:r=44100`,
    "-filter_complex_script", script, "-map", `[${v}]`, "-map", "[aout]",
    "-c:v", "libx264", "-preset", job.preset ?? "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "160k", "-t", String(T), "-movflags", "+faststart", out,
  ], "final");
  return { seconds: T };
}

async function api(pathname, body) {
  const res = await fetch(`${process.env.MOS_URL.replace(/\/$/, "")}${pathname}`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.MOS_RENDER_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (res.status === 204) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Marketing OS ${res.status}: ${json.error ?? "request failed"}`);
  return json;
}

async function uploadToYoutube(sessionUrl, file) {
  const size = (await stat(file)).size;
  const res = await fetch(sessionUrl, {
    method: "PUT",
    headers: { "content-type": "video/mp4", "content-length": String(size) },
    body: createReadStream(file),
    duplex: "half",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.id) throw new Error(`YouTube upload failed ${res.status}: ${json.error?.message ?? "no video id"}`);
  return json.id;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--local") {
    const job = JSON.parse(await readFile(args[1], "utf8"));
    const r = await render(job, args[2], path.join(tmpdir(), `calm-${Date.now()}`));
    console.log(`rendered ${args[2]} (${r.seconds}s)`);
    return;
  }
  if (!process.env.MOS_URL || !process.env.MOS_RENDER_TOKEN) {
    console.log("MOS_URL or MOS_RENDER_TOKEN is not set; nothing to do.");
    return;
  }
  for (let i = 0; i < 2; i++) {
    const job = await api("/api/cron/calm-next");
    if (!job) {
      console.log(i ? "No more jobs." : "No calm video waiting to be rendered.");
      return;
    }
    console.log(`Rendering "${job.title}" (${job.lines.length} lines)`);
    try {
      const work = path.join(tmpdir(), `calm-${job.id}`);
      // Kept in the workspace so the workflow can attach it to the run (download for manual upload if needed).
      await mkdir("out", { recursive: true });
      const out = path.resolve("out", `${job.id}.mp4`);
      job.font_file = path.join(work, "font.ttf");
      await mkdir(work, { recursive: true });
      await download(job.font_url, job.font_file);
      const r = await render(job, out, work);
      console.log(`Rendered ${r.seconds}s, uploading as private…`);
      const renderUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : undefined;
      const youtubeVideoId = await uploadToYoutube(job.upload_url, out);
      await api("/api/cron/calm-done", { id: job.id, youtubeVideoId, seconds: r.seconds, renderUrl });
      console.log("Uploaded as private; waiting for approval in Marketing OS.");
    } catch (e) {
      console.error(e);
      await api("/api/cron/calm-done", { id: job.id, error: String(e.message ?? e).slice(0, 800) }).catch(() => undefined);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
