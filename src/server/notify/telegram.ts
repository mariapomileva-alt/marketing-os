import "server-only";

/**
 * Notifications to the owner's Telegram (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID, server-side only).
 * Notifications only: Telegram never approves or sends anything — approval happens in Marketing OS, where the
 * whole thread and the exact text are visible. Message text carries counts and links, never comment text or
 * anything a commenter wrote, so nothing personal leaves the app.
 */
export interface NotifyResult {
  sent: boolean;
  reason: string;
}

export async function notifyTelegram(text: string, opts: { urgent?: boolean } = {}): Promise<NotifyResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return { sent: false, reason: "Telegram is not configured (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)." };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: opts.urgent ? `🔴 ${text}` : text, disable_web_page_preview: true }),
      cache: "no-store",
    });
    if (!res.ok) return { sent: false, reason: `Telegram answered ${res.status}.` }; // never include the URL: it holds the token
    return { sent: true, reason: "sent" };
  } catch {
    return { sent: false, reason: "Telegram could not be reached." };
  }
}

/** Public address of this deployment, for links in notifications. */
export function appUrl(path = ""): string {
  const base =
    process.env.APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");
  return `${base.replace(/\/$/, "")}${path}`;
}
