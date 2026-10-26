/** Names of the Threads Studio post formats, as the owner sees them. */
export const FORMAT_LABEL: Record<string, string> = {
  tip: "Tip", myth: "Myth vs true", normalize: "You’re not alone", question: "Question", article: "From our article", list: "List", trend: "Trend", product: "Back moment",
};

/** Reactions weighted the way Threads spreads posts: a repost or quote travels further than a like. */
export function reactionScore(p: { likes: number | null; replies: number | null; reposts: number | null; quotes: number | null }) {
  return (p.likes ?? 0) + (p.replies ?? 0) * 2 + (p.reposts ?? 0) * 3 + (p.quotes ?? 0) * 3;
}

/** Share of viewers who reacted at all (likes, replies, reposts, quotes per view). */
export function reactionRate(p: { views: number | null; likes: number | null; replies: number | null; reposts: number | null; quotes: number | null }) {
  const v = p.views ?? 0;
  return v ? ((p.likes ?? 0) + (p.replies ?? 0) + (p.reposts ?? 0) + (p.quotes ?? 0)) / v : null;
}
