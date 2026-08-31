/** Public types. Kept in one file so the surface is easy to read in one go. */

export interface PayghaamConfig {
  /**
   * Client key from the dashboard, starting `ek_client_`.
   *
   * The only required value. Never ship a REST key to a browser: a client key
   * can identify users and register subscriptions, a REST key can send.
   */
  apiKey: string;
  /** Override only when self-hosting. */
  baseUrl?: string;
  /**
   * Path the service worker is served from. Scope is derived from this path,
   * so a worker at `/js/sw.js` can only receive pushes for `/js/*` — which is
   * why the default is the origin root.
   */
  serviceWorkerPath?: string;
  /** Silence the SDK's console warnings. Errors are still surfaced. */
  quiet?: boolean;
}

/**
 * Payload handed to a tap handler.
 *
 * Reserved keys mirror the native SDKs: `ek_message_id`, `ek_url`, `ek_image`.
 * Anything passed as `data` on `POST /api/notifications` arrives alongside them.
 */
export interface NotificationPayload {
  ek_message_id?: string;
  ek_url?: string;
  ek_image?: string;
  [key: string]: unknown;
}

export type NotificationOpenedHandler = (payload: NotificationPayload) => void;

/** Why `requestPushPermission()` did not produce a subscription. */
export type PushPermissionResult =
  | { ok: true; endpoint: string }
  | {
      ok: false;
      reason:
        | "unsupported"
        | "denied"
        | "dismissed"
        | "not_initialized"
        | "no_vapid_key"
        | "subscribe_failed"
        | "register_failed";
      detail?: string;
    };
