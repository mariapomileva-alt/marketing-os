import "server-only";

/**
 * Media for calm videos. Voice: OpenAI text-to-speech (the workspace's OpenAI key from Connections). Footage: Pexels
 * (free licence, commercial use allowed, attribution appreciated: we credit authors in the description).
 */
type Fetch = typeof fetch;

export const CALM_VOICE_INSTRUCTIONS =
  "Speak slowly, softly and warmly, like a calm friend sitting next to someone at night. Low energy, gentle, unhurried. Leave natural space at commas. Never sound like an announcer.";

export async function speak(apiKey: string, text: string, voice: string, f: Fetch = fetch): Promise<Uint8Array> {
  const res = await f("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice, input: text, instructions: CALM_VOICE_INSTRUCTIONS, response_format: "mp3" }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`OpenAI voice ${res.status}: ${body.error?.message ?? "request failed"}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

export const THEME_QUERIES: Record<string, string[]> = {
  river: ["calm river", "slow stream forest", "river stones water"],
  forest: ["forest trees wind", "sunlight through trees", "green leaves breeze"],
  clouds: ["clouds timelapse sky", "soft clouds", "clouds above mountains"],
  rain: ["rain on leaves", "rain window", "gentle rain forest"],
  ocean: ["calm ocean waves", "sea shore waves slow", "ocean horizon"],
  snow: ["snow falling forest", "snowfall calm", "snowy trees"],
  lake: ["calm lake", "lake reflection mountains", "misty lake morning"],
  meadow: ["meadow grass wind", "wildflowers breeze", "field golden hour"],
};

export interface Clip {
  url: string;
  author: string;
  source_url: string;
}

/** Landscape HD clips for a theme, longest first, without people (search terms are nature only). */
export async function findClips(apiKey: string, theme: string, want = 8, f: Fetch = fetch): Promise<Clip[]> {
  const out: Clip[] = [];
  const seen = new Set<number>();
  for (const q of THEME_QUERIES[theme] ?? [theme]) {
    const u = new URL("https://api.pexels.com/videos/search");
    u.search = new URLSearchParams({ query: q, orientation: "landscape", size: "medium", per_page: "15" }).toString();
    const res = await f(u, { headers: { authorization: apiKey } });
    if (!res.ok) throw new Error(`Pexels ${res.status}: could not search footage`);
    const body = (await res.json()) as { videos?: Array<{ id: number; url: string; duration: number; user?: { name?: string }; video_files?: Array<{ link: string; width: number; height: number; file_type: string }> }> };
    for (const v of (body.videos ?? []).sort((a, b) => b.duration - a.duration)) {
      if (seen.has(v.id) || v.duration < 8) continue;
      const file = (v.video_files ?? [])
        .filter((x) => x.file_type === "video/mp4" && x.width >= 1280 && x.width <= 2560 && x.width > x.height)
        .sort((a, b) => Math.abs(a.width - 1920) - Math.abs(b.width - 1920))[0];
      if (!file) continue;
      seen.add(v.id);
      out.push({ url: file.link, author: v.user?.name ?? "Pexels", source_url: v.url });
      if (out.length >= want) return out;
    }
  }
  return out;
}
