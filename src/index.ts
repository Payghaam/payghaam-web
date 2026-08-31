import { ApiClient, DEFAULT_BASE_URL, PayghaamApiError } from "./api-client.js";
import { TapDispatcher, normalizeTapPayload } from "./taps.js";
import { serializeSubscription, urlBase64ToUint8Array } from "./vapid.js";
import type {
  NotificationOpenedHandler,
  PayghaamConfig,
  PushPermissionResult,
} from "./types.js";

export type {
  NotificationOpenedHandler,
  NotificationPayload,
  PayghaamConfig,
  PushPermissionResult,
} from "./types.js";
export { PayghaamApiError, DEFAULT_BASE_URL } from "./api-client.js";
export { serializeSubscription, urlBase64ToUint8Array } from "./vapid.js";

const STORAGE_KEY = "payghaam:externalId";
const SDK_NAME = "web";

class PayghaamWeb {
  private config: PayghaamConfig | null = null;
  private api: ApiClient | null = null;
  private externalId: string | null = null;
  private registration: ServiceWorkerRegistration | null = null;
  private readonly taps = new TapDispatcher();
  private listening = false;

  /**
   * Required once, as early as possible.
   *
   * Only `apiKey` is required. `baseUrl` defaults to the hosted API and
   * `serviceWorkerPath` to the origin root — a service worker's scope is
   * derived from its path, so serving it anywhere else silently limits which
   * pages can receive a push.
   */
  initialize(config: PayghaamConfig): void {
    const apiKey = config.apiKey?.trim();
    if (!apiKey) throw new Error("Payghaam: apiKey is required");
    if (apiKey.startsWith("ek_rest_") || apiKey.startsWith("ek_server_")) {
      // A REST key in browser JavaScript is readable by anyone who opens
      // devtools, and it can send messages to the whole audience.
      throw new Error("Payghaam: use a client key (ek_client_…), never a REST key, in a browser");
    }

    this.config = { serviceWorkerPath: "/payghaam-sw.js", ...config, apiKey };
    this.api = new ApiClient(apiKey, config.baseUrl);
    this.externalId = readStoredExternalId();
    this.listenForTaps();
  }

  /** True when this browser can do web push at all. */
  isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window
    );
  }

  /** Identify the current user. Persisted, so a reload keeps the identity. */
  async login(externalId: string, identityHash?: string): Promise<void> {
    const id = externalId?.trim();
    if (!id) throw new Error("Payghaam: externalId is required");
    this.externalId = id;
    writeStoredExternalId(id);
    await this.api?.identify(id, identityHash).catch((e) => this.warn("identify failed", e));
  }

  /**
   * Forget the current user locally.
   *
   * Deliberately does *not* unsubscribe the browser. The push subscription
   * belongs to the browser, not the account, and revoking it would force a new
   * permission prompt on next login — a prompt the user can only be shown once.
   * Call `optOut()` for an actual unsubscribe.
   */
  logout(): void {
    this.externalId = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Private browsing or blocked storage. Identity is in-memory either way.
    }
  }

  async trackEvent(name: string, properties?: Record<string, unknown>): Promise<void> {
    if (!name?.trim()) throw new Error("Payghaam: event name is required");
    await this.api
      ?.trackEvent(this.externalId, name.trim(), properties)
      .catch((e) => this.warn("trackEvent failed", e));
  }

  async addTag(key: string, value: unknown): Promise<void> {
    await this.addTags({ [key]: value });
  }

  async addTags(tags: Record<string, unknown>): Promise<void> {
    if (!this.externalId) {
      this.warn("addTags called before login — tags need a user");
      return;
    }
    await this.api?.updateTags(this.externalId, tags).catch((e) => this.warn("addTags failed", e));
  }

  /**
   * Prompt for permission and register the subscription.
   *
   * **Must be called from a user gesture** (a click or tap handler). iOS Safari
   * silently ignores a request that is not, and other browsers penalise it —
   * and because a denied prompt cannot be re-shown programmatically, a wasted
   * prompt is unrecoverable. Gate it behind your own soft-ask UI.
   *
   * On iOS the site must also be installed to the Home Screen: push does not
   * work in a Safari tab, only in an installed web app (iOS 16.4+).
   *
   * Never throws — returns a discriminated result so callers can branch.
   */
  async requestPushPermission(): Promise<PushPermissionResult> {
    if (!this.config || !this.api) {
      return { ok: false, reason: "not_initialized" };
    }
    if (!this.isSupported()) {
      return { ok: false, reason: "unsupported" };
    }

    const vapidPublicKey = await this.fetchVapidKey();
    if (!vapidPublicKey) return { ok: false, reason: "no_vapid_key" };

    let registration: ServiceWorkerRegistration;
    try {
      registration = await navigator.serviceWorker.register(this.config.serviceWorkerPath!);
      await navigator.serviceWorker.ready;
      this.registration = registration;
    } catch (err) {
      return { ok: false, reason: "register_failed", detail: String(err) };
    }

    const permission = await Notification.requestPermission();
    if (permission === "denied") return { ok: false, reason: "denied" };
    if (permission !== "granted") return { ok: false, reason: "dismissed" };

    try {
      // Reuse an existing subscription when there is one: re-subscribing with
      // the same key returns the same endpoint, but calling subscribe() with a
      // *different* applicationServerKey throws rather than replacing it.
      const existing = await registration.pushManager.getSubscription();
      const sub =
        existing ??
        (await registration.pushManager.subscribe({
          // Mandatory in Chrome. Silent data-only web push is not available.
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
        }));

      const serialized = serializeSubscription(sub);
      if (!serialized) {
        return { ok: false, reason: "subscribe_failed", detail: "subscription is missing its keys" };
      }
      if (!this.externalId) {
        // Anonymous subscribers cannot be addressed. Better to say so than to
        // register a row nothing can ever target.
        this.warn("requestPushPermission before login — call login() first");
      } else {
        await this.api.registerSubscription(this.externalId, serialized, {
          deviceOs: navigator.userAgent,
          sdk: SDK_NAME,
        });
      }
      return { ok: true, endpoint: serialized.endpoint };
    } catch (err) {
      return { ok: false, reason: "subscribe_failed", detail: String(err) };
    }
  }

  /** Current permission without prompting. */
  permissionState(): NotificationPermission | "unsupported" {
    if (!this.isSupported()) return "unsupported";
    return Notification.permission;
  }

  /**
   * Unsubscribe this browser and record the opt-out.
   *
   * Order matters: tell the server first. If the local unsubscribe succeeded
   * but the API call failed, we would keep sending to an endpoint that no
   * longer exists and only learn about it from 410s.
   */
  async optOut(): Promise<void> {
    const registration = this.registration ?? (await navigator.serviceWorker?.getRegistration());
    const sub = await registration?.pushManager.getSubscription();
    if (!sub) return;
    await this.api?.optOut(sub.endpoint).catch((e) => this.warn("optOut failed", e));
    await sub.unsubscribe().catch(() => undefined);
  }

  /**
   * Handle notification taps.
   *
   * Registering a handler suppresses the SDK's own navigation, so routing —
   * including the deep link in `ek_url` — becomes entirely yours. A tap that
   * cold-opened the tab is replayed to a handler registered shortly after, so
   * it is never dropped.
   */
  onNotificationOpened(handler: NotificationOpenedHandler): () => void {
    return this.taps.register(handler);
  }

  /**
   * Ask the API for the project's `applicationServerKey`.
   *
   * Fetched rather than configured so rotating the platform pair does not
   * require every customer to ship a new build. Failing here is fatal to
   * subscribing, which is why it is a distinct result reason.
   */
  private async fetchVapidKey(): Promise<string | null> {
    const base = (this.config?.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    try {
      const res = await fetch(`${base}/sdk/web-push/key`, {
        headers: { "x-api-key": this.config!.apiKey },
      });
      if (!res.ok) throw new PayghaamApiError(res.status, "could not fetch VAPID key");
      const body = (await res.json()) as { vapidPublicKey?: string };
      return body.vapidPublicKey?.trim() || null;
    } catch (err) {
      this.warn("could not fetch the VAPID public key", err);
      return null;
    }
  }

  private listenForTaps(): void {
    if (this.listening || typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    this.listening = true;
    navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
      const data = event.data as { type?: string; payload?: unknown } | null;
      if (data?.type !== "payghaam:notification-opened") return;
      const payload = normalizeTapPayload(data.payload);
      if (!payload) return;
      this.taps.dispatch(payload);
      const messageId = payload.ek_message_id;
      if (typeof messageId === "string" && messageId) {
        void this.api?.reportReceipt(messageId, "opened").catch(() => undefined);
      }
    });
  }

  private warn(message: string, err?: unknown): void {
    if (this.config?.quiet) return;
    // eslint-disable-next-line no-console
    console.warn(`[Payghaam] ${message}`, err ?? "");
  }
}

function readStoredExternalId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredExternalId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage blocked. Identity still works for the life of the page.
  }
}

/** Singleton, matching the other Payghaam SDKs. */
export const Payghaam = new PayghaamWeb();
export default Payghaam;
