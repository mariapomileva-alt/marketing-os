"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

/**
 * The invitation email's link lands here with the session in the address fragment (#access_token=…), which the
 * server never sees. This signs the invited person in from it and opens God of Marketing.
 */
export function HashSession({ url, anonKey }: { url: string; anonKey: string }) {
  // Read once on first render (client only): whether the address carries a session from the invitation link.
  const [state, setState] = useState<"idle" | "working" | "failed">(() =>
    typeof window !== "undefined" && window.location.hash.includes("access_token=") ? "working" : "idle");
  useEffect(() => {
    const p = new URLSearchParams(window.location.hash.slice(1));
    const access = p.get("access_token");
    const refresh = p.get("refresh_token");
    if (!access || !refresh) return;
    createBrowserClient(url, anonKey).auth.setSession({ access_token: access, refresh_token: refresh })
      .then(({ error }) => {
        if (error) setState("failed");
        else window.location.replace("/");
      })
      .catch(() => setState("failed"));
  }, [url, anonKey]);
  if (state === "working") return <p className="text-[13px] text-muted">Signing you in…</p>;
  if (state === "failed") return <p className="text-[13px] text-red">This invitation link has expired. Enter your email below and press “Send sign-in link”.</p>;
  return null;
}
