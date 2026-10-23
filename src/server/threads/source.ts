import "server-only";
import type { Tx } from "@/server/db/client";
import type { FoundPost, PostSource } from "@/server/services/threads";
import { channelConnection, threadsToken } from "@/server/services/youtube-publish";
import { threadsKeywordSearch, threadsRefresh } from "./api";

/** Threads keyword search as the connected account. Before Meta approves keyword search it returns our own posts only. */
export async function threadsApiSource(tx: Tx, productId: string): Promise<{ source: PostSource; ownUsername: string | null } | null> {
  const conn = await channelConnection(tx, productId, "threads");
  if (!conn || conn.status === "revoked") return null;
  const token = await threadsToken(tx, conn, { refresh: threadsRefresh });
  return { source: { kind: "api", search: (q) => threadsKeywordSearch(token, q) }, ownUsername: conn.account_label.replace(/^@/, "") || null };
}

const DEMO: FoundPost[] = [
  { id: "demo-th-1", username: "nora.writes", permalink: "https://www.threads.com/@nora.writes", timestamp: "2026-10-22T08:00:00Z",
    text: "does anyone else get panic attacks right before falling asleep? like the second my head hits the pillow my heart decides to sprint. what do you do in that moment" },
  { id: "demo-th-2", username: "tomas_k", permalink: "https://www.threads.com/@tomas_k", timestamp: "2026-10-22T09:30:00Z",
    text: "Had my first panic attack on the metro today. Thought I was having a heart attack. Doctor says I'm fine physically. How do people live with this fear of the next one?" },
  { id: "demo-th-3", username: "calm.daily", permalink: "https://www.threads.com/@calm.daily", timestamp: "2026-10-22T10:00:00Z",
    text: "Use code CALM20 for 20% off our anxiety course! Link in bio. Panic attacks gone in 7 days." },
  { id: "demo-th-4", username: "lena.m", permalink: "https://www.threads.com/@lena.m", timestamp: "2026-10-22T11:00:00Z",
    text: "паническая атака в очереди в супермаркете. бросила тележку и ушла. стыдно ужасно, хотя понимаю что никто не заметил" },
];

export function threadsDemoSource(): PostSource {
  return { kind: "demo", search: async (q) => DEMO.filter((p) => p.text.toLowerCase().includes(q.toLowerCase().split(" ")[0]) || /panic|паник/i.test(p.text)) };
}
