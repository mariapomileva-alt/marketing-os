const { chromium } = require('playwright');
const fs = require('fs');
const { execFileSync } = require('child_process');
const LIB = '/tmp/claude-0/shots-lib';
// Each shot: what the app shows, recorded from the real app (web build) at phone size.
const SHOTS = {
  home: { secs: 4, run: async () => {} },
  breathe: { secs: 7, run: async (b, at) => { await at(0.5); await b('Breathe').click(); } },
  try_another: { secs: 5, start: '/breathe', run: async (b, at, app) => { await at(1.2); await app.getByText('Breathing feels uncomfortable').click(); } },
  ground: { secs: 6, start: '/session/alternatives?feeling=same&tool=breathe', run: async (b, at) => { await at(0.6); await b('Ground').click(); } },
  listen: { secs: 6, run: async (b, at) => { await at(0.5); await b('Listen').click(); } },
  move: { secs: 6, run: async (b, at) => { await at(0.5); await b('Move').click(); } },
  read: { secs: 6, run: async (b, at) => { await at(0.5); await b('Read').click(); } },
  distract: { secs: 5, run: async (b, at) => { await at(0.5); await b('Distract').click(); } },
  call_person: { secs: 4.5, run: async (b, at, app) => { await at(0.5); await app.getByRole('button', { name: /Call my person/ }).first().click(); } },
};
(async () => {
  const br = await chromium.launch();
  for (const [name, s] of Object.entries(SHOTS)) {
    const ctx = await br.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('back.firstLaunchSeen', 'true'); localStorage.setItem('back.homeNamePromptDismissed', '1'); localStorage.setItem('back.lockScreenHintShown', 'true');
        localStorage.setItem('back.supportContact', JSON.stringify({ id: 'local', name: 'Anna', phoneNumber: '+371 2000 0000' }));
      } catch {}
      addEventListener('pointerdown', (e) => {
        const d = document.createElement('div');
        Object.assign(d.style, { position: 'fixed', left: `${e.clientX - 26}px`, top: `${e.clientY - 26}px`, width: '52px', height: '52px', borderRadius: '50%', background: 'rgba(12,59,46,.22)', border: '2px solid rgba(12,59,46,.4)', pointerEvents: 'none', zIndex: 99999, transition: 'opacity .45s, transform .45s' });
        document.body.appendChild(d); setTimeout(() => { d.style.opacity = '0'; d.style.transform = 'scale(1.4)'; }, 240); setTimeout(() => d.remove(), 700);
      }, true);
    });
    const p = await ctx.newPage();
    await p.goto(`http://localhost:4400${s.start ?? '/'}`, { waitUntil: 'load' }); await p.waitForTimeout(1500);
    await p.waitForTimeout(1500);
    const b = (n) => p.getByRole('button', { name: n, exact: true });
    const dir = `${LIB}/${name}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const cdp = await ctx.newCDPSession(p);
    const frames = [];
    cdp.on('Page.screencastFrame', async (f) => { frames.push({ t: f.metadata.timestamp, data: f.data }); await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: 780, maxHeight: 1520 });
    const t0 = Date.now();
    const at = async (x) => { const w = t0 + x * 1000 - Date.now(); if (w > 0) await p.waitForTimeout(w); };
    await s.run(b, at, p);
    await at(s.secs);
    await cdp.send('Page.stopScreencast'); await p.waitForTimeout(200);
    frames.forEach((f, i) => fs.writeFileSync(`${dir}/${String(i).padStart(5, '0')}.png`, Buffer.from(f.data, 'base64')));
    const t0s = t0 / 1000;
    const lines = [`file '00000.png'\nduration ${Math.max(0, frames[0].t - t0s).toFixed(4)}`];
    frames.forEach((f, i) => lines.push(`file '${String(i).padStart(5, '0')}.png'\nduration ${(i + 1 < frames.length ? frames[i + 1].t - f.t : Math.max(0.2, s.secs - (f.t - t0s))).toFixed(4)}`));
    lines.push(`file '${String(frames.length - 1).padStart(5, '0')}.png'`);
    fs.writeFileSync(`${dir}/list.txt`, lines.join('\n'));
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', `${dir}/list.txt`, '-vf', 'fps=30,scale=780:1520,format=yuv420p', '-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-t', String(s.secs), '-an', '-movflags', '+faststart', `${LIB}/${name}.mp4`]);
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(name, frames.length);
    await ctx.close();
  }
  await br.close();
})().catch((e) => { console.error(e); process.exit(1); });
