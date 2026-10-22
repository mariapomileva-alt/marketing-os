import "server-only";
import { parseIsoDuration, type VideoCandidate } from "@/domain/youtube";

/**
 * Where videos come from. The real source is the official YouTube Data API v3 with a server-side API key
 * (YOUTUBE_API_KEY): search.list (100 quota units per query) + videos.list (1 unit). Read-only; nothing here can
 * post. The demo source returns invented, clearly labelled videos so the flow can be tried without a key.
 */
export interface VideoSource {
  readonly kind: "youtube_api" | "demo";
  find(query: string, opts: { publishedAfter: Date; language: string | null; max: number }): Promise<VideoCandidate[]>;
}

export class YouTubeApiError extends Error {
  constructor(message: string, readonly reason: string, readonly status: number) {
    super(message);
  }
}

const API = "https://www.googleapis.com/youtube/v3";

async function getJson(url: URL): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: Array<{ reason?: string }> } } & Record<string, unknown>;
  if (!res.ok) {
    const reason = body.error?.errors?.[0]?.reason ?? "unknown";
    // The key travels in the query string; never echo the URL into errors or logs.
    throw new YouTubeApiError(`YouTube API ${res.status}: ${body.error?.message ?? reason}`, reason, res.status);
  }
  return body;
}

type ApiVideo = {
  id: string;
  snippet?: { title?: string; description?: string; channelId?: string; channelTitle?: string; publishedAt?: string; defaultAudioLanguage?: string; defaultLanguage?: string };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; commentCount?: string };
  status?: { madeForKids?: boolean };
};

export function youtubeApiSource(apiKey: string): VideoSource {
  return {
    kind: "youtube_api",
    async find(query, { publishedAfter, language, max }) {
      const s = new URL(`${API}/search`);
      s.search = new URLSearchParams({
        part: "snippet", type: "video", order: "date", q: query, maxResults: String(Math.min(max, 25)),
        publishedAfter: publishedAfter.toISOString(), safeSearch: "moderate", key: apiKey,
        ...(language ? { relevanceLanguage: language } : {}),
      }).toString();
      const found = await getJson(s);
      const ids = ((found.items as Array<{ id?: { videoId?: string } }>) ?? []).map((i) => i.id?.videoId).filter((x): x is string => !!x);
      if (!ids.length) return [];
      const v = new URL(`${API}/videos`);
      v.search = new URLSearchParams({ part: "snippet,contentDetails,statistics,status", id: ids.join(","), key: apiKey }).toString();
      const details = await getJson(v);
      return ((details.items as ApiVideo[]) ?? []).map(toCandidate);
    },
  };
}

export function toCandidate(v: ApiVideo): VideoCandidate {
  return {
    videoId: v.id,
    title: v.snippet?.title ?? "",
    description: v.snippet?.description ?? "",
    channelId: v.snippet?.channelId ?? "",
    channelTitle: v.snippet?.channelTitle ?? "",
    publishedAt: v.snippet?.publishedAt ?? new Date(0).toISOString(),
    language: v.snippet?.defaultAudioLanguage ?? v.snippet?.defaultLanguage ?? null,
    durationSeconds: parseIsoDuration(v.contentDetails?.duration),
    views: v.statistics?.viewCount ? Number(v.statistics.viewCount) : null,
    // videos.list omits commentCount when comments are turned off.
    commentsDisabled: v.statistics ? v.statistics.commentCount === undefined : false,
    madeForKids: v.status?.madeForKids === true,
  };
}

/** Invented videos for trying the flow. Every title is prefixed so they can never be mistaken for real ones. */
export function demoSource(): VideoSource {
  const base = [
    { t: "What to do during a panic attack: the first two minutes", d: "A psychologist explains why short steps work better than long instructions when panic rises.", c: "Calm Minds", dur: 612 },
    { t: "Grounding when your thoughts race (5-4-3-2-1, gently)", d: "A slow walkthrough of grounding for anxiety and sensory overwhelm.", c: "Quiet Practice", dur: 420 },
    { t: "Panic attack on the train — what helped me get off at the next stop", d: "Talking about panic on public transport and small things to try.", c: "Everyday Anxiety", dur: 365 },
    { t: "Что делать при панической атаке: первые минуты", d: "Психолог о том, почему в момент паники трудно читать длинные инструкции.", c: "Спокойно", dur: 540 },
    { t: "Panic attack #shorts", d: "60 seconds", c: "Fast Tips", dur: 45 },
    { t: "Cure panic attacks forever in 7 days", d: "My guaranteed method.", c: "Hype Health", dur: 900 },
    { t: "My morning routine", d: "Coffee and journaling.", c: "Lifestyle Daily", dur: 700 },
  ];
  return {
    kind: "demo",
    async find(_query, { max }) {
      return base.slice(0, max).map((b, i) => ({
        videoId: `demo${String(i).padStart(4, "0")}xx`,
        title: `[DEMO] ${b.t}`,
        description: b.d,
        channelId: `UCdemo${i}`,
        channelTitle: `[DEMO] ${b.c}`,
        publishedAt: new Date(Date.now() - (i + 1) * 86_400_000).toISOString(),
        language: /[а-я]/i.test(b.t) ? "ru" : "en",
        durationSeconds: b.dur,
        views: 1000 + i * 137,
        commentsDisabled: false,
        madeForKids: false,
      }));
    },
  };
}

export function configuredSource(): VideoSource | null {
  const key = process.env.YOUTUBE_API_KEY;
  return key ? youtubeApiSource(key) : null;
}
