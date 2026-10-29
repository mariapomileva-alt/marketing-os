import "server-only";
import { renderPost } from "@/server/cards/render";
import { fileStore } from "@/server/storage";
import type { DeskMedia } from "@/server/services/content-desk";

/** Live card drawing and storage for the content desk. */
export function liveDeskMedia(): DeskMedia {
  return {
    render: (format, slides, brand) => renderPost(format, slides, brand),
    store: (key, bytes) => fileStore().put(key, bytes, "image/jpeg"),
  };
}
