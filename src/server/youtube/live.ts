import "server-only";
import type { WriteApis, YoutubeWriteApi } from "@/server/services/youtube-publish";
import type { ThreadsReadApi } from "@/server/services/threads";
import { accessToken, listReplies, postComment, postReply } from "./write";
import { threadsInsights, threadsPublish, threadsRefresh, threadsReplies } from "@/server/threads/api";
import { instagramComments, instagramMedia, instagramRefresh, instagramReply } from "@/server/instagram/api";

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

export function liveThreadsApi() {
  return {
    publish: (token: string, userId: string, text: string, replyToId: string | null) => threadsPublish(token, userId, text, replyToId),
    refresh: (token: string) => threadsRefresh(token),
    replies: (token: string, mediaId: string) => threadsReplies(token, mediaId),
    insights: (token: string, mediaId: string) => threadsInsights(token, mediaId),
  } satisfies ThreadsReadApi & NonNullable<WriteApis["threads"]>;
}

export function liveInstagramApi() {
  return {
    reply: (token: string, commentId: string, text: string) => instagramReply(token, commentId, text),
    refresh: (token: string) => instagramRefresh(token),
    media: (token: string) => instagramMedia(token),
    comments: (token: string, mediaId: string) => instagramComments(token, mediaId),
  };
}

/** Every platform we can post to, for the posting queue and "Post now". */
export function liveApis(): WriteApis {
  return { youtube: liveWriteApi(), threads: liveThreadsApi(), instagram: liveInstagramApi() };
}
