/**
 * In-process pub/sub for live (SSE) updates. Single-node only — the same
 * constraint as the rate limiter; a Redis bus can replace this behind the
 * same interface if the app ever scales horizontally.
 *
 * Clients receive lightweight "refresh" hints, not payloads: on any event the
 * dashboard refetches its authoritative state, so no event schema drift and
 * no stale-payload problems.
 */

export interface LiveEvent {
  type: string;
  at: string;
}

type Listener = (event: LiveEvent) => void;

const listeners = new Set<{ topics: Set<string>; fn: Listener }>();
let seq = 0;

function emit(topics: string[], type: string) {
  if (listeners.size === 0) return;
  const event: LiveEvent = { type, at: new Date().toISOString() };
  seq++; // keep a monotonic touch so hot reloads don't dedupe identical events
  void seq;
  for (const l of listeners) {
    if (topics.some((t) => l.topics.has(t))) {
      try {
        l.fn(event);
      } catch {
        // a dead listener must never break the publisher
      }
    }
  }
}

const topicOf = (userId: string) => `user:${userId}`;

/** Refresh hint for one employee's dashboard. */
export function publishUserState(userId: string, type = "state") {
  emit([topicOf(userId)], type);
}

/** Refresh hint for every open admin/supervisor panel. */
export function publishAdminState(type = "admin-state") {
  emit(["admin"], type);
}

/** Refresh hint to all connected dashboards (settings/announcement changes). */
export function publishAll(type = "broadcast") {
  emit(["all", "admin"], type);
}

/** Convenience: employees + admin panel in one call. */
export function publishStates(userIds: string[], opts?: { admin?: boolean }) {
  for (const id of userIds) publishUserState(id);
  if (opts?.admin !== false) publishAdminState();
}

export function subscribe(topics: string[], fn: Listener): () => void {
  const entry = { topics: new Set(topics), fn };
  listeners.add(entry);
  return () => listeners.delete(entry);
}
