import "server-only";
import { openaiKey } from "@/server/ai";
import { fileStore } from "@/server/storage";
import type { CalmMedia } from "@/server/services/calm";
import { findClips, speak } from "./media";

/** Real voice (OpenAI) and footage (Pexels, when PEXELS_API_KEY is set). Null when no OpenAI key is connected. */
export async function liveCalmMedia(workspaceId: string): Promise<CalmMedia | null> {
  const key = await openaiKey(workspaceId);
  if (!key) return null;
  const pexels = process.env.PEXELS_API_KEY;
  return {
    speak: (text, voice) => speak(key, text, voice),
    clips: async (theme) => (pexels ? findClips(pexels, theme) : []),
    store: (k, bytes) => fileStore().put(k, bytes, "audio/mpeg"),
  };
}
