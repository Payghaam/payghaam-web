# @payghaam/web

Payghaam SDK for the web — browser push, identity, tags, and events.

Push goes over the **Web Push Protocol** straight to Chrome, Firefox, Edge and
Safari. There is no Firebase project to create, no provider account, and no
per-message cost: the browser names its own push service and Payghaam signs the
request with a VAPID key.

## Install

```bash
npm install @payghaam/web
```

Then copy the service worker to the **root** of whatever you serve statically
(`public/`, `static/`, `www/` — whichever your framework uses):

```bash
cp node_modules/@payghaam/web/sw/payghaam-sw.js public/payghaam-sw.js
```

This step is not optional and it cannot be done for you. A service worker's
scope comes from the path it is served from, so a worker at `/js/payghaam-sw.js`
only receives pushes for pages under `/js/`. It has to be at the origin root.

Already have a service worker? Don't replace it — import ours from yours:

```js
importScripts("/payghaam-sw.js");
```

## Quick start

```ts
import { Payghaam } from "@payghaam/web";

Payghaam.initialize({ apiKey: "ek_client_..." });

await Payghaam.login("user-123");

// Must be called from a click handler. See below.
document.querySelector("#enable-notifications").addEventListener("click", async () => {
  const result = await Payghaam.requestPushPermission();
  if (!result.ok) console.log("not subscribed:", result.reason);
});

await Payghaam.trackEvent("checkout_started", { cartValue: 42 });
```

One required value. `baseUrl` defaults to the hosted API and only needs setting
if you self-host.

## Things that will bite you

These are the reasons a web push integration appears to do nothing. None of them
produce an error.

**The permission prompt must come from a user gesture.** iOS Safari silently
ignores `Notification.requestPermission()` that isn't inside a click handler, and
other browsers penalise it. Because a *denied* prompt can never be re-shown
programmatically, a wasted prompt is unrecoverable — put your own "turn on
notifications?" UI in front of it and only call this when they say yes.

**On iOS the site must be installed to the Home Screen.** Push does not work in
an iOS Safari tab. Only in an installed web app, iOS 16.4+. This is the biggest
expectation gap for anyone coming from mobile.

**`userVisibleOnly: true` is mandatory.** Chrome requires every push to show a
notification. Silent data-only web push does not exist, unlike Android.

**Subscriptions expire.** Browsers rotate them. A dropped subscriber is normal
attrition; the service worker re-registers on `pushsubscriptionchange` where the
browser supports it, and the server retires endpoints that return 410.

**Use a client key.** `ek_client_…`, never a REST key. Anything in browser
JavaScript is readable by anyone who opens devtools, and a REST key can send to
your whole audience. The SDK throws if you pass one.

## Handling taps

A campaign's deep link arrives as `ek_url`, alongside anything you passed as
`data` on `POST /api/notifications`:

```ts
const unsubscribe = Payghaam.onNotificationOpened((payload) => {
  if (typeof payload.orderId === "string") router.push(`/orders/${payload.orderId}`);
});
```

Registering a handler **suppresses the SDK's own navigation**, so routing —
including the deep link — becomes entirely yours. A tap that cold-opened the tab
is buffered and replayed to a handler registered shortly after, so it is never
dropped.

Reserved keys: `ek_message_id`, `ek_url`, `ek_image`.

## API

| Method | Description |
| --- | --- |
| `initialize(config)` | Required once. Only `apiKey` is mandatory. |
| `isSupported()` | Whether this browser can do web push at all |
| `login(externalId, identityHash?)` | Identify the user. Persisted across reloads. |
| `logout()` | Forget the user locally. Does **not** unsubscribe. |
| `trackEvent(name, properties?)` | Track an event |
| `addTag(key, value)` / `addTags(tags)` | Update profile tags |
| `requestPushPermission()` | Prompt, subscribe and register. Never throws. |
| `permissionState()` | Current permission without prompting |
| `optOut()` | Unsubscribe this browser and record the opt-out |
| `onNotificationOpened(handler)` | Taps. Returns an unsubscribe function. |

`requestPushPermission()` returns a discriminated result rather than throwing:

```ts
const r = await Payghaam.requestPushPermission();
if (r.ok) console.log(r.endpoint);
else console.log(r.reason); // unsupported | denied | dismissed | not_initialized
                            // | no_vapid_key | subscribe_failed | register_failed
```

## Why `logout()` doesn't unsubscribe

The push subscription belongs to the browser, not the account. Revoking it on
logout would force a fresh permission prompt at next login — a prompt the user
can only be shown once. Call `optOut()` when someone actually wants to stop
receiving messages.

## Other SDKs

[iOS](https://github.com/Payghaam/payghaam-ios) ·
[Android](https://github.com/Payghaam/payghaam-android) ·
[Flutter](https://github.com/Payghaam/payghaam-flutter) ·
[React Native](https://github.com/Payghaam/payghaam-react-native)

[Documentation](https://payghaam.com/docs)

MIT
