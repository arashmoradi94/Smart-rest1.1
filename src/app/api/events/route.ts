import { requireAuth, isTeamLead } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { subscribe, type LiveEvent } from "@/lib/events";
import { ensureReminderScheduler } from "@/services/reminder-job";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-Sent Events stream of live refresh hints. Team leads also receive
 * admin-topic events. Payloads are hints only — dashboards refetch their
 * state endpoint, which stays the single source of truth.
 */
export async function GET(request: Request) {
  let user;
  try {
    user = await requireAuth();
  } catch (e) {
    return errorResponse(e);
  }
  // While any dashboard is connected, server-side break reminders keep running.
  ensureReminderScheduler();

  const topics = isTeamLead(user.role) ? [`user:${user.id}`, "admin", "all"] : [`user:${user.id}`, "all"];
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: LiveEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      send({ type: "connected", at: new Date().toISOString() });
      unsubscribe = subscribe(topics, send);
      // Comment-only heartbeat keeps proxies from buffering/closing the stream.
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": hb\n\n"));
        } catch {
          close();
        }
      }, 25_000);

      request.signal.addEventListener("abort", close);
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
