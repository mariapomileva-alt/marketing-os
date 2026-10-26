"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

/**
 * The morning brief's voice. At rest the orb breathes; while the brief plays, the voice's loudness moves the ring
 * of fine ticks and the glow (Web Audio analyser on our own-origin audio file). Without audio it is a quiet ornament.
 */
const TICKS = 120;

export function BriefOrb({ src, label }: { src: string | null; label: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const ticks = useRef<Array<SVGLineElement | null>>([]);
  const glow = useRef<HTMLDivElement>(null);
  const graph = useRef<{ ctx: AudioContext; analyser: AnalyserNode; data: Uint8Array<ArrayBuffer> } | null>(null);
  const raf = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => () => {
    cancelAnimationFrame(raf.current);
    graph.current?.ctx.close().catch(() => {});
  }, []);

  function draw() {
    const g = graph.current;
    if (g) {
      g.analyser.getByteFrequencyData(g.data);
      let sum = 0;
      for (let i = 0; i < TICKS; i++) {
        // Speech lives in the lower bins; spread them around the ring, mirrored so it stays symmetric.
        const bin = Math.floor((i < TICKS / 2 ? i : TICKS - i) * (g.data.length * 0.45) / (TICKS / 2));
        const v = g.data[bin] / 255;
        sum += v;
        ticks.current[i]?.setAttribute("y2", String(-118 - 4 - v * 26));
      }
      const level = sum / TICKS;
      if (glow.current) glow.current.style.transform = `scale(${0.94 + level * 0.35})`;
    }
    raf.current = requestAnimationFrame(draw);
  }

  async function toggle() {
    const el = audio.current;
    if (!el) return;
    if (!el.paused) {
      el.pause();
      return;
    }
    if (!graph.current) {
      try {
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.82;
        ctx.createMediaElementSource(el).connect(analyser);
        analyser.connect(ctx.destination);
        graph.current = { ctx, analyser, data: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)) };
      } catch {
        graph.current = null; // plays without the drawing
      }
    }
    await graph.current?.ctx.resume().catch(() => {});
    await el.play();
  }

  const mm = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative size-[248px] sm:size-[288px]">
        <div ref={glow} className="absolute inset-[22%] transition-transform duration-150 ease-out">
          <div className={playing ? "size-full" : "orb-breathe size-full"}>
            <div className="orb-drift size-full rounded-full blur-[2px]" style={{
              background: "radial-gradient(circle at 34% 30%, #e9fff1 0%, #a9e9c4 22%, #5fbf8c 48%, #2b7a57 72%, #143a2b 100%)",
              boxShadow: "0 0 60px 8px rgba(95,191,140,.35), 0 0 140px 30px rgba(95,191,140,.12)",
            }}>
              <div className="size-full rounded-full mix-blend-screen" style={{ background: "radial-gradient(circle at 70% 72%, rgba(200,255,225,.55), transparent 42%)" }} />
            </div>
          </div>
        </div>
        <svg viewBox="-160 -160 320 320" className="orb-scan absolute inset-0 size-full" aria-hidden>
          <circle r={146} fill="none" stroke="var(--mint)" strokeOpacity={0.5} strokeWidth={1} strokeDasharray="60 857" strokeLinecap="round" />
          <circle r={146} fill="none" stroke="var(--mint)" strokeOpacity={0.12} strokeWidth={1} />
        </svg>
        <svg viewBox="-160 -160 320 320" className="absolute inset-0 size-full" aria-hidden>
          <circle r={104} fill="none" stroke="var(--mint)" strokeOpacity={0.18} strokeWidth={1} strokeDasharray="1 5" />
          {Array.from({ length: TICKS }, (_, i) => (
            <line
              key={i}
              ref={(n) => { ticks.current[i] = n; }}
              x1={0} y1={-118} x2={0} y2={i % 10 === 0 ? -130 : -124}
              transform={`rotate(${(i * 360) / TICKS})`}
              stroke="var(--mint)" strokeOpacity={i % 10 === 0 ? 0.75 : 0.4} strokeWidth={1.2} strokeLinecap="round"
            />
          ))}
        </svg>
      </div>
      {src ? (
        <div className="flex w-full max-w-[288px] items-center gap-3">
          <button
            type="button"
            onClick={toggle}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-mint text-night transition-colors hover:bg-white"
            aria-label={playing ? "Пауза" : label}
          >
            {playing ? <Pause className="size-5" fill="currentColor" /> : <Play className="ml-0.5 size-5" fill="currentColor" />}
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-night-ink">{playing ? "Говорю…" : label}</p>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-night-line">
              <div className="h-full bg-mint" style={{ width: `${duration ? (progress / duration) * 100 : 0}%` }} />
            </div>
          </div>
          <span className="num text-[12px] text-night-muted">{mm(duration ? duration - progress : 0)}</span>
          <audio
            ref={audio}
            src={src}
            preload="metadata"
            onPlay={() => { setPlaying(true); cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(draw); }}
            onPause={() => { setPlaying(false); cancelAnimationFrame(raf.current); }}
            onEnded={() => { setPlaying(false); setProgress(0); cancelAnimationFrame(raf.current); }}
            onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
          />
        </div>
      ) : null}
    </div>
  );
}
