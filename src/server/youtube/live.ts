import "server-only";
import type { YoutubeWriteApi } from "@/server/services/youtube-publish";
import { accessToken, listReplies, postComment, postReply } from "./write";

/** The real YouTube calls. Reading replies uses the read-only API key; posting uses the channel's OAuth token. */
export function liveWriteApi(): YoutubeWriteApi {
  const key = process.env.YOUTUBE_API_KEY;
  return {
    accessToken,
    postComment,
    postReply,
    listReplies: (threadId) => {
      if (!key) throw new Error("YOUTUBE_API_KEY is not set, so replies cannot be read.");
      return listReplies(threadId, key);
    },
  };
}
