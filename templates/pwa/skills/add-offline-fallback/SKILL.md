---
name: add-offline-fallback
description: Add an offline fallback page, cache the app shell for offline use, detect online/offline state, and queue failed requests for retry when connectivity returns
domain: pwa
type: pwa
triggers:
  - "offline fallback"
  - "offline page"
  - "works offline"
  - "no internet"
  - "cache app shell"
  - "background sync"
  - "queue requests"
  - "offline support"
  - "detect offline"
---

# Add Offline Fallback

## When to use

When the app should remain functional without a network connection — showing cached content, queuing actions taken offline, and displaying a helpful offline page rather than the browser's default "No internet" screen. Activate when the user says "works offline", "offline page", or "what happens when there's no connection."

## Prerequisites

- Service worker registered and active (see `add-cache-strategy` skill)
- App shell built as static assets (HTML/CSS/JS entry point doesn't change per-request)
- Decisions made about which features work offline vs. require network (write these down before coding)

## What "offline fallback" means in practice

| Feature | Offline behavior |
|---------|-----------------|
| Viewing cached pages | Works — served from cache |
| Navigating to uncached pages | Shows offline fallback page |
| Submitting a form / mutation | Queue the action, retry when online |
| Real-time data (live prices, chat) | Show stale data + "Last updated X ago" indicator |
| Authentication | Cannot re-authenticate offline — cached session only |

## Steps

### 1. Create the offline fallback page

```html
<!-- public/offline.html -->
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>You're offline</title>
    <style>
      body {
        font-family: system-ui, sans-serif;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        margin: 0;
        padding: 1rem;
        text-align: center;
        background: #f9f9f9;
      }
      .icon { font-size: 4rem; margin-bottom: 1rem; }
      h1 { margin: 0 0 0.5rem; }
      p { color: #666; max-width: 30ch; }
      button {
        margin-top: 1.5rem;
        padding: 0.75rem 1.5rem;
        border: none;
        border-radius: 0.5rem;
        background: #333;
        color: #fff;
        font-size: 1rem;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <div class="icon">📡</div>
    <h1>You're offline</h1>
    <p>Check your connection and try again. Any changes you made will sync when you're back online.</p>
    <button onclick="location.reload()">Try again</button>
  </body>
</html>
```

### 2. Precache the offline page and app shell

```javascript
// public/sw.js (or src/sw.ts with vite-plugin-pwa)
import { precacheAndRoute } from "workbox-precaching";
import { registerRoute, setCatchHandler } from "workbox-routing";
import { NetworkFirst, CacheFirst } from "workbox-strategies";

// Precache the build output (Workbox injects __WB_MANIFEST)
precacheAndRoute(self.__WB_MANIFEST);

// Navigation routes — network-first, fallback to cache, then offline page
registerRoute(
  ({ request }) => request.mode === "navigate",
  new NetworkFirst({ cacheName: "pages-cache" })
);

// Fallback: serve offline.html for navigate requests that fail
setCatchHandler(async ({ request }) => {
  if (request.mode === "navigate") {
    const cache = await caches.open("precache-v1");
    return (await cache.match("/offline.html")) || Response.error();
  }
  return Response.error();
});
```

With `vite-plugin-pwa`, add the offline page to precache explicitly:

```typescript
// vite.config.ts
VitePWA({
  workbox: {
    globPatterns: ["**/*.{js,css,html,ico,png,svg}", "offline.html"],
  },
})
```

### 3. Detect and surface online/offline state in the UI

```typescript
// src/hooks/useNetworkStatus.ts
import { useState, useEffect } from "react";

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}

// Usage in a component
function OfflineBanner() {
  const isOnline = useNetworkStatus();
  if (isOnline) return null;
  return (
    <div role="status" style={{ background: "#f59e0b", padding: "0.5rem", textAlign: "center" }}>
      You're offline — changes will sync when you reconnect
    </div>
  );
}
```

### 4. Queue failed mutations with Background Sync

Background Sync retries queued requests when connectivity returns. Supported on Chrome/Android; not supported on Safari/iOS — always provide a manual retry path as fallback.

```typescript
// src/api/queue.ts
const SYNC_TAG = "pending-mutations";

export async function queueMutation(url: string, payload: unknown): Promise<void> {
  // Store in IndexedDB for persistence
  const db = await openDB("mutation-queue", 1, {
    upgrade(db) {
      db.createObjectStore("mutations", { keyPath: "id", autoIncrement: true });
    },
  });
  await db.add("mutations", { url, payload, createdAt: Date.now() });

  // Register background sync if available
  if ("serviceWorker" in navigator && "SyncManager" in window) {
    const reg = await navigator.serviceWorker.ready;
    await (reg as any).sync.register(SYNC_TAG);
  }
}
```

```javascript
// public/sw.js — handle the sync event
import { openDB } from "idb";

self.addEventListener("sync", (event) => {
  if (event.tag === "pending-mutations") {
    event.waitUntil(flushMutationQueue());
  }
});

async function flushMutationQueue() {
  const db = await openDB("mutation-queue", 1);
  const mutations = await db.getAll("mutations");

  for (const mutation of mutations) {
    try {
      const response = await fetch(mutation.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mutation.payload),
      });
      if (response.ok) {
        await db.delete("mutations", mutation.id);
      }
    } catch {
      // Network still unavailable — sync will retry automatically
    }
  }
}
```

### 5. Graceful degradation for iOS Safari (no Background Sync)

```typescript
// src/api/mutations.ts
import { queueMutation } from "./queue";

export async function submitForm(data: FormData): Promise<void> {
  try {
    const response = await fetch("/api/submit", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(data)),
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) throw new Error(response.statusText);
  } catch (error) {
    if (!navigator.onLine) {
      // Queue for later (Background Sync on Chrome; manual on iOS)
      await queueMutation("/api/submit", Object.fromEntries(data));
      showToast("Saved offline — will sync when you reconnect");
    } else {
      throw error; // Network error, not offline — surface to user
    }
  }
}

// For iOS: flush queue when app regains focus
window.addEventListener("online", async () => {
  if (!("SyncManager" in window)) {
    await flushMutationQueue(); // Manual flush for iOS
  }
});
```

### 6. Show stale data age

```typescript
// src/hooks/useStaleIndicator.ts
export function useStaleIndicator(lastFetchedAt: Date | null): string | null {
  const isOnline = useNetworkStatus();
  if (isOnline || !lastFetchedAt) return null;

  const minutes = Math.floor((Date.now() - lastFetchedAt.getTime()) / 60000);
  if (minutes < 1) return "Last updated just now";
  if (minutes < 60) return `Last updated ${minutes}m ago`;
  return `Last updated ${Math.floor(minutes / 60)}h ago`;
}
```

## Templates

### Minimal offline page (no dependencies)

The offline page is served from cache when there's no network. Keep it self-contained — no external CSS or JS imports, since those can't load offline.

```html
<!-- Everything inline, no external dependencies -->
<style> /* inline styles */ </style>
<script> /* inline script only */ </script>
```

### Test helper

```typescript
// tests/offline.test.ts
it("shows offline banner when network goes down", async () => {
  // Simulate offline
  Object.defineProperty(navigator, "onLine", { value: false, writable: true });
  window.dispatchEvent(new Event("offline"));

  const { getByRole } = render(<App />);
  expect(getByRole("status")).toHaveTextContent("You're offline");

  // Restore
  Object.defineProperty(navigator, "onLine", { value: true });
  window.dispatchEvent(new Event("online"));
});
```

## Checklist

- [ ] `offline.html` created and precached in service worker
- [ ] Navigation requests that fail serve `/offline.html` (not browser error page)
- [ ] App shell (HTML/CSS/JS) precached and loads without network
- [ ] Online/offline banner visible in the UI when connection drops
- [ ] Mutations taken offline are queued and retried (or user is told to retry manually)
- [ ] Stale data shows a "Last updated X ago" indicator
- [ ] Offline page has no external dependencies (inline CSS/JS only)
- [ ] Tested in Chrome DevTools: Application → Service Workers → check "Offline", reload page
- [ ] iOS Safari tested: storage limit respected (< 50MB), no Background Sync dependency

## Files involved

| File | Action |
|------|--------|
| `public/offline.html` | Create: self-contained offline fallback page |
| `public/sw.js` or `src/sw.ts` | Update: `setCatchHandler`, `sync` event listener |
| `src/hooks/useNetworkStatus.ts` | Create: `online`/`offline` event listener hook |
| `src/api/queue.ts` | Create: IndexedDB mutation queue + Background Sync registration |
| `src/api/mutations.ts` | Update: wrap fetch calls with offline queue fallback |
| `vite.config.ts` | Update: add `offline.html` to `globPatterns` |

## Common mistakes

**Offline page with external resources** — `<link rel="stylesheet" href="//cdn.example.com/styles.css">` in the offline page fails when offline. The page must be entirely self-contained with inline CSS.

**Assuming Background Sync works everywhere** — Safari (all platforms before some future release) and Firefox don't support Background Sync. Always provide a manual "retry now" path or flush the queue on the `online` event.

**Not precaching the offline page** — the offline fallback is served by the service worker. If the offline page itself isn't precached, the service worker can't serve it. Add it to `globPatterns` explicitly.

**Catching network errors in the wrong place** — service worker `setCatchHandler` only fires for requests routed through Workbox. Fetch calls in your app code that aren't registered as routes are not caught. Handle those explicitly with `try/catch` + `navigator.onLine` check.

**Queueing everything** — not all requests should be queued. Analytics events: drop them. Authentication: cannot replay offline. Only queue user-initiated data mutations (form submissions, creating records).
