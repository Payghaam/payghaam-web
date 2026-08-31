import type { SerializedSubscription } from "./vapid.js";

export const DEFAULT_BASE_URL = "https://api.payghaam.com/api";

/** Thrown for a non-2xx response so callers can read the status. */
export class PayghaamApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PayghaamApiError";
  }
}

/**
 * Thin `fetch` wrapper over the Payghaam SDK REST surface.
 *
 * Everything here is fire-and-forget from the app's point of view: the API
 * buffers identify/subscription/tag/event writes and returns 202, so a slow
 * response should never block a UI. The one exception is subscription
 * registration, whose result the caller needs in order to report success.
 */
export class ApiClient {
  private readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    baseUrl?: string,
  ) {
    this.baseUrl = (baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  private async request(path: string, method: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        // X-Api-Key rather than Authorization: the guard accepts either, and
        // this one does not collide with an app's own auth header on the same
        // origin.
        "x-api-key": this.apiKey,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      keepalive: true,
    });
    if (!res.ok) {
      throw new PayghaamApiError(res.status, `Payghaam API ${res.status} on ${method} ${path}`);
    }
    return res.status === 204 ? null : res.json().catch(() => null);
  }

  identify(externalId: string, identityHash?: string): Promise<unknown> {
    return this.request("/sdk/users", "POST", {
      externalId,
      ...(identityHash ? { identityHash } : {}),
    });
  }

  /**
   * Register the browser subscription.
   *
   * `token` carries the endpoint URL. That is not a naming accident — the
   * server stores every channel's address in one column, and for web push the
   * address *is* the endpoint. The two keys ride alongside it.
   */
  registerSubscription(
    externalId: string,
    sub: SerializedSubscription,
    meta: { deviceOs?: string; sdk?: string } = {},
  ): Promise<unknown> {
    return this.request(`/sdk/users/${encodeURIComponent(externalId)}/subscriptions`, "POST", {
      type: "WEB_PUSH",
      token: sub.endpoint,
      webP256dh: sub.p256dh,
      webAuth: sub.auth,
      ...meta,
    });
  }

  updateTags(externalId: string, tags: Record<string, unknown>): Promise<unknown> {
    return this.request(`/sdk/users/${encodeURIComponent(externalId)}/tags`, "PUT", { tags });
  }

  trackEvent(
    externalId: string | null,
    name: string,
    properties?: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request("/sdk/events", "POST", {
      name,
      ...(externalId ? { externalId } : {}),
      ...(properties ? { properties } : {}),
    });
  }

  /** Delivery / engagement receipt. Best-effort; see the note in taps.ts. */
  reportReceipt(messageId: string, type: "delivered" | "opened"): Promise<unknown> {
    return this.request("/sdk/receipts", "POST", { messageId, type });
  }

  optOut(endpoint: string): Promise<unknown> {
    return this.request("/sdk/opt-out", "POST", { type: "WEB_PUSH", token: endpoint });
  }
}
