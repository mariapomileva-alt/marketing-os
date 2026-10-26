import "server-only";
import { openaiKey } from "@/server/ai";
import { BRIEF_VOICE_INSTRUCTIONS, speak } from "@/server/calm/media";
import { fileStore } from "@/server/storage";
import type { BriefVoice } from "./brief";

/** The spoken brief: OpenAI voice with the workspace key, stored privately. Null when no OpenAI key is connected. */
export async function briefVoice(workspaceId: string): Promise<BriefVoice | null> {
  const key = await openaiKey(workspaceId);
  if (!key) return null;
  const store = fileStore();
  return {
    speak: (text) => speak(key, text, "sage", fetch, BRIEF_VOICE_INSTRUCTIONS),
    put: (k, bytes) => store.put(k, bytes, "audio/mpeg"),
  };
}
