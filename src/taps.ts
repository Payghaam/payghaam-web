import type { NotificationOpenedHandler, NotificationPayload } from "./types.js";

/**
 * Notification-tap dispatch.
 *
 * The service worker posts a message to every controlled page when a
 * notification is clicked. A page that has not registered a handler yet — the
 * common case for a tap that *opened* the tab — would otherwise drop it, so
 * taps are buffered and replayed to the first handler that registers.
 *
 * Buffering is capped and cleared on delivery: an app that never registers a
 * handler should not accumulate payloads for the life of the tab.
 */
const MAX_BUFFERED = 5;

export class TapDispatcher {
  private handlers = new Set<NotificationOpenedHandler>();
  private buffered: NotificationPayload[] = [];

  /** Returns an unsubscribe function, matching the React Native SDK. */
  register(handler: NotificationOpenedHandler): () => void {
    this.handlers.add(handler);
    if (this.buffered.length) {
      const pending = this.buffered;
      this.buffered = [];
      for (const payload of pending) safely(handler, payload);
    }
    return () => {
      this.handlers.delete(handler);
    };
  }

  dispatch(payload: NotificationPayload): void {
    if (this.handlers.size === 0) {
      this.buffered.push(payload);
      if (this.buffered.length > MAX_BUFFERED) this.buffered.shift();
      return;
    }
    for (const handler of this.handlers) safely(handler, payload);
  }

  /** True once the app has taken over routing, so the SDK stops navigating. */
  get hasHandler(): boolean {
    return this.handlers.size > 0;
  }
}

/**
 * One throwing handler must not stop the others, and must not surface as an
 * unhandled rejection inside a message listener.
 */
function safely(handler: NotificationOpenedHandler, payload: NotificationPayload): void {
  try {
    handler(payload);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[Payghaam] notification handler threw", err);
  }
}

/** Reserved keys are stripped from nothing — apps read them deliberately. */
export function normalizeTapPayload(raw: unknown): NotificationPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as NotificationPayload;
}
