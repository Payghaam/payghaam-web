/**
 * Payghaam service worker.
 *
 * Serve this from your origin root, e.g. https://example.com/payghaam-sw.js.
 * A service worker's scope is derived from the path it is served from, so a
 * worker at /js/payghaam-sw.js can only receive pushes for pages under /js/.
 * Copying it to your public/ or static/ directory is the usual answer.
 *
 * Already have a service worker? Do not replace it — import this one:
 *
 *     importScripts("/payghaam-sw.js");
 *
 * Shipped as plain JavaScript rather than compiled output because it is served
 * verbatim by the customer, and a source map pointing at files they do not have
 * is worse than no source map.
 */

/* global self, clients */

const RESERVED_URL = "ek_url";
const RESERVED_IMAGE = "ek_image";
const RESERVED_MESSAGE_ID = "ek_message_id";

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    // A push with a non-JSON body is not ours. Showing "undefined" to a user
    // is worse than showing nothing.
    return;
  }

  // Declarative Web Push (Safari 18.4+) renders `notification` itself without
  // waking this worker at all. If we are running, the browser did not take that
  // path — but the same payload carries both shapes, so prefer the declarative
  // block when our own keys are absent.
  const declarative = payload.notification ?? {};
  const title = payload.title || declarative.title || "";
  const body = payload.body || declarative.body || "";
  if (!title && !body) return;

  const data = { ...payload };
  delete data.notification;
  delete data.web_push;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: payload.icon,
      badge: payload.badge,
      image: payload[RESERVED_IMAGE],
      tag: payload[RESERVED_MESSAGE_ID],
      data,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data[RESERVED_URL];

  event.waitUntil(
    (async () => {
      const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });

      // Tell every open page, so an app that registered a handler can route
      // this itself. Posting before navigating matters: focusing a client can
      // settle before the message is delivered otherwise.
      for (const client of windows) {
        client.postMessage({ type: "payghaam:notification-opened", payload: data });
      }

      if (!url) {
        // No deep link — surface an existing tab rather than opening a new one.
        const existing = windows.find((c) => "focus" in c);
        if (existing) await existing.focus();
        return;
      }

      // Reuse a tab already on the target URL instead of stacking duplicates.
      const match = windows.find((c) => c.url === url && "focus" in c);
      if (match) {
        await match.focus();
        return;
      }
      if (clients.openWindow) await clients.openWindow(url);
    })(),
  );
});

/**
 * Browsers rotate subscriptions. This fires when one is replaced, and without
 * re-registering, the subscriber silently stops receiving anything — the most
 * common cause of web push "just stopping" for a segment of users.
 *
 * Support is uneven (Chrome fires it, Firefox partially, Safari not at all), so
 * treat it as an optimisation rather than the only recovery path: the server
 * also retires endpoints that 410.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const applicationServerKey = event.oldSubscription?.options?.applicationServerKey;
      if (!applicationServerKey) return;
      try {
        const sub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
        const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const client of windows) {
          client.postMessage({
            type: "payghaam:subscription-changed",
            payload: { endpoint: sub.endpoint },
          });
        }
      } catch {
        // Nothing useful to do here; the next 410 retires the old endpoint.
      }
    })(),
  );
});
