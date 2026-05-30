---
name: setup-push-notifications
description: Add Web Push notifications to a PWA — generate VAPID keys, register a push subscription, send from a server, and handle the push event in the service worker
domain: pwa
type: pwa
triggers:
  - "push notifications"
  - "web push"
  - "VAPID"
  - "push subscription"
  - "send notification"
  - "browser notification"
  - "background notification"
---

# Set Up Push Notifications

## When to use

When the app needs to re-engage users with server-initiated messages — order updates, chat messages, alerts — even when the app isn't open. Activate when the user asks "how do I send push notifications" or "how do I set up web push."

## Prerequisites

- Service worker registered and active
- HTTPS (push notifications require a secure context — localhost is exempt)
- A server that can send HTTP requests (Node.js, Python, etc.)
- `web-push` library on the server side

**iOS Safari limitations:**
- Push notifications on iOS require Safari 16.4+ **and** the user must add the app to their Home Screen first
- No push support on iOS Chrome or Firefox — WebKit only
- Always design the subscription flow to gracefully degrade when push is unavailable

## Steps

### 1. Generate VAPID keys

VAPID (Voluntary Application Server Identification) keys authenticate your server to the push service. Generate once and store in environment variables.

```bash
npm install web-push
npx web-push generate-vapid-keys
# Output:
# Public Key: BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U
# Private Key: UUxI4O8-FbRouAevSmBQ6co62GDYsB_CkCTFbP7mzr4
```

```env
# .env
VAPID_PUBLIC_KEY=BEl62iUYgUivxIkv69yViE...
VAPID_PRIVATE_KEY=UUxI4O8-FbRouAevSmBQ...
VAPID_SUBJECT=mailto:you@example.com
```

**Never regenerate VAPID keys in production** — existing subscriptions are tied to the public key. Regenerating invalidates all subscriptions.

### 2. Request notification permission and subscribe

```typescript
// src/notifications.ts
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export async function subscribeToPush(): Promise<PushSubscription | null> {
  // 1. Check support
  if (!("PushManager" in window)) {
    console.warn("Push not supported in this browser");
    return null;
  }

  // 2. Request permission
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    console.log("Push permission denied");
    return null;
  }

  // 3. Get the active service worker registration
  const registration = await navigator.serviceWorker.ready;

  // 4. Subscribe to push
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true, // Required — push must always show a notification
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  // 5. Send subscription to your server
  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription),
  });

  return subscription;
}

export async function unsubscribeFromPush(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    await subscription.unsubscribe();
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
  }
}
```

### 3. Handle the push event in the service worker

```javascript
// public/sw.js (or injected into the Workbox service worker)
self.addEventListener("push", (event) => {
  if (!event.data) return;

  const data = event.data.json();

  const options = {
    body: data.body,
    icon: "/pwa-192x192.png",
    badge: "/badge-72x72.png",
    data: { url: data.url || "/" },
    // Actions (Android Chrome only)
    actions: data.actions || [],
    // Vibration pattern (Android only)
    vibrate: [200, 100, 200],
    // Replace existing notification with same tag
    tag: data.tag || "default",
    renotify: data.renotify || false,
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Open the app and navigate when notification is clicked
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Focus existing window if open
        for (const client of clientList) {
          if (client.url === url && "focus" in client) {
            return client.focus();
          }
        }
        // Otherwise open a new window
        if (clients.openWindow) return clients.openWindow(url);
      })
  );
});
```

### 4. Store subscriptions on the server

```typescript
// server/routes/push.ts (Node.js / Fastify example)
import webpush from "web-push";

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

// Store subscriptions in DB (endpoint is the unique key)
app.post("/api/push/subscribe", async (req, reply) => {
  const subscription = req.body as PushSubscription;
  await db.pushSubscriptions.upsert({
    where: { endpoint: subscription.endpoint },
    create: { endpoint: subscription.endpoint, keys: subscription.keys, userId: req.user.id },
    update: { keys: subscription.keys },
  });
  return reply.code(201).send({ ok: true });
});

app.post("/api/push/unsubscribe", async (req, reply) => {
  const { endpoint } = req.body as { endpoint: string };
  await db.pushSubscriptions.delete({ where: { endpoint } });
  return reply.send({ ok: true });
});
```

### 5. Send a push notification from the server

```typescript
// server/services/push.ts
import webpush from "web-push";

interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  actions?: Array<{ action: string; title: string }>;
}

export async function sendPushNotification(
  subscription: PushSubscription,
  payload: PushPayload
): Promise<void> {
  try {
    await webpush.sendNotification(
      subscription,
      JSON.stringify(payload)
    );
  } catch (error: any) {
    if (error.statusCode === 410 || error.statusCode === 404) {
      // Subscription expired or invalid — remove from DB
      await db.pushSubscriptions.delete({
        where: { endpoint: subscription.endpoint },
      });
    } else {
      throw error;
    }
  }
}

// Send to all subscribers of a user
export async function notifyUser(userId: string, payload: PushPayload): Promise<void> {
  const subs = await db.pushSubscriptions.findMany({ where: { userId } });
  await Promise.allSettled(subs.map((s) => sendPushNotification(s, payload)));
}
```

### 6. Handle subscription in Workbox-managed service worker

If using `vite-plugin-pwa`, the generated service worker is self-contained. Inject push handlers with the `injectManifest` strategy:

```typescript
// vite.config.ts
VitePWA({
  strategies: "injectManifest",    // use your own sw.js with precache injection
  srcDir: "src",
  filename: "sw.ts",               // your custom service worker source
})
```

```typescript
// src/sw.ts — your service worker with push handlers
import { precacheAndRoute } from "workbox-precaching";
declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);  // Workbox injects this at build time

// Push handler below...
self.addEventListener("push", (event) => { /* ... */ });
self.addEventListener("notificationclick", (event) => { /* ... */ });
```

## Templates

### Permission request UI pattern

Never ask for permission on page load — browsers may block the permission prompt. Ask in context:

```typescript
// Show a prompt asking the user first, then request permission only if they click "yes"
function SubscribeButton() {
  return (
    <button onClick={async () => {
      const sub = await subscribeToPush();
      if (sub) showToast("Notifications enabled");
    }}>
      Enable notifications
    </button>
  );
}
```

### Push payload schema

```typescript
interface PushPayload {
  title: string;        // Required — notification title
  body: string;         // Required — notification body text
  url?: string;         // Where to navigate on click (default "/")
  tag?: string;         // Collapses duplicate notifications with same tag
  renotify?: boolean;   // Re-alert even if same tag is already visible
  actions?: Array<{ action: string; title: string; icon?: string }>;
}
```

## Checklist

- [ ] VAPID keys generated and stored in environment variables (not in code)
- [ ] `VITE_VAPID_PUBLIC_KEY` exposed to browser; private key stays on server only
- [ ] Permission requested in context (user action), not on page load
- [ ] `userVisibleOnly: true` set on subscribe call (required by Chrome)
- [ ] Subscription stored server-side with user association
- [ ] Stale subscriptions (410/404 errors) removed from DB when encountered
- [ ] Service worker shows a notification on every push event (required — silent push not allowed)
- [ ] `notificationclick` handler opens or focuses the app
- [ ] iOS fallback: if `PushManager` not available, gracefully hide the subscribe button
- [ ] Tested on Android Chrome and desktop Chrome (and iOS Safari 16.4+ if applicable)

## Files involved

| File | Action |
|------|--------|
| `.env` | Add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
| `src/notifications.ts` | Create: `subscribeToPush`, `unsubscribeFromPush` |
| `public/sw.js` or `src/sw.ts` | Add `push` and `notificationclick` event listeners |
| `server/routes/push.ts` | Create: subscribe/unsubscribe endpoints |
| `server/services/push.ts` | Create: `sendPushNotification`, `notifyUser` |
| `db/migrations/` | Create: `push_subscriptions` table (endpoint, keys JSON, userId, createdAt) |

## Common mistakes

**Asking for permission on page load** — browsers suppress the permission dialog if it fires without a user gesture, and users find it intrusive. Always tie permission requests to a visible "Enable notifications" button.

**Not handling 410/404 from web-push** — a 410 means the subscription has expired (user cleared browser data or revoked permission). Not removing stale subscriptions causes the DB to grow indefinitely and wastes send attempts.

**Storing VAPID private key in frontend code** — the private key must never leave the server. Only `VAPID_PUBLIC_KEY` goes into the browser bundle (`VITE_VAPID_PUBLIC_KEY`).

**Silent push on Chrome** — Chrome requires every push event to show a visible notification. A service worker that receives a push but doesn't call `showNotification()` will be killed after a few seconds and Chrome may revoke push permission.

**iOS: push without Home Screen install** — iOS Safari 16.4+ supports push only after the user adds the app to the Home Screen. If the user is on iOS and the app isn't installed, `PushManager` is undefined. Check and degrade gracefully.
