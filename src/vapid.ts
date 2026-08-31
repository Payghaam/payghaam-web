/**
 * VAPID key encoding and PushSubscription serialisation.
 *
 * Pure functions with no browser globals, so the fiddly parts — base64url
 * padding, the ArrayBuffer round trip — are unit-testable without a DOM. These
 * are also the parts that fail *silently*: a mis-decoded applicationServerKey
 * does not throw, it produces a subscription the push service rejects later
 * with a 401 that looks like a server misconfiguration.
 */

/**
 * Decode a base64url VAPID public key into the `Uint8Array` that
 * `pushManager.subscribe` wants as `applicationServerKey`.
 *
 * Browsers hand out and accept base64url (`-` and `_`, no padding), while
 * `atob` only speaks standard base64 with padding — hence the translation. A
 * P-256 uncompressed public key is always 65 bytes, so anything else is a
 * truncated or mistyped key and is worth rejecting loudly here rather than at
 * the push service.
 */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const trimmed = base64Url.trim();
  if (!trimmed) throw new Error("VAPID public key is empty");

  const padding = "=".repeat((4 - (trimmed.length % 4)) % 4);
  const base64 = (trimmed + padding).replace(/-/g, "+").replace(/_/g, "/");

  let raw: string;
  try {
    raw = atob(base64);
  } catch {
    throw new Error("VAPID public key is not valid base64url");
  }

  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

  if (bytes.length !== 65) {
    throw new Error(
      `VAPID public key must decode to 65 bytes (got ${bytes.length}) — check it was copied in full`,
    );
  }
  return bytes;
}

/** Encode raw bytes as base64url, the shape the API stores. */
export function uint8ArrayToUrlBase64(bytes: ArrayBuffer | null): string {
  if (!bytes) return "";
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i] as number);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The three values the API needs, matching Subscription.{token,webP256dh,webAuth}. */
export interface SerializedSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Flatten a browser `PushSubscription` into the API shape.
 *
 * Returns null when either key is absent. That should not happen for a
 * subscription created with `userVisibleOnly: true`, but the keys come from
 * `getKey()`, which is specified to return null — and posting a subscription
 * with a missing key creates a row that can never be encrypted to, i.e. a
 * subscriber who silently receives nothing forever.
 */
export function serializeSubscription(sub: {
  endpoint: string;
  getKey(name: "p256dh" | "auth"): ArrayBuffer | null;
}): SerializedSubscription | null {
  const endpoint = sub.endpoint?.trim();
  if (!endpoint) return null;
  const p256dh = uint8ArrayToUrlBase64(sub.getKey("p256dh"));
  const auth = uint8ArrayToUrlBase64(sub.getKey("auth"));
  if (!p256dh || !auth) return null;
  return { endpoint, p256dh, auth };
}
