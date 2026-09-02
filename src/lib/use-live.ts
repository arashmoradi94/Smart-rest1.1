"use client";

import { useEffect } from "react";

/**
 * Live refresh via SSE. The server sends lightweight "refresh" hints; the
 * dashboard refetches its authoritative state. Polling continues at
 * `fallbackMs` as a safety net (SSE drop, proxy buffering, hibernation).
 */
export function useLiveRefresh(onRefresh: () => void, fallbackMs: number) {
  useEffect(() => {
    let closed = false;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let lastKick = 0;

    // Burst of events (e.g. group break) → refetch at most once per 1.5s
    const kick = () => {
      const now = Date.now();
      if (now - lastKick < 1500) return;
      lastKick = now;
      onRefresh();
    };

    const connect = () => {
      if (closed) return;
      try {
        es = new EventSource("/api/events");
      } catch {
        retry = setTimeout(connect, 10_000);
        return;
      }
      es.onmessage = kick;
      es.onerror = () => {
        // EventSource retries on its own; recreate only after a fatal close.
        if (es?.readyState === 2) {
          es.close();
          es = null;
          retry = setTimeout(connect, 5000);
        }
      };
    };
    connect();

    const id = setInterval(onRefresh, fallbackMs);
    const onVisible = () => document.visibilityState === "visible" && onRefresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      closed = true;
      es?.close();
      if (retry) clearTimeout(retry);
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [onRefresh, fallbackMs]);
}
