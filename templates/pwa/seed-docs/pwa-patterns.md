# Progressive Web App — Reference Guide

## Service Worker Caching Strategies

### Cache-First (Offline-First)
Check the cache before the network. Best for static assets (CSS, JS, images) that change infrequently. Serve instantly from cache, update in background.

### Network-First
Try the network, fall back to cache if offline. Best for dynamic content (API responses, feeds) where freshness matters. Slower when online but always current.

### Stale-While-Revalidate
Serve from cache immediately, then update the cache from the network in the background. Best compromise for content that should be fast but also relatively fresh. The user sees cached data first, then gets updated data on next visit.

### Cache-Only / Network-Only
Cache-only for fully offline assets. Network-only for data that must never be stale (authentication, real-time data). Use sparingly.

## Web App Manifest

Required fields for installability:
- `name` and `short_name` — app title
- `start_url` — entry point when launched from home screen
- `display: standalone` — removes browser chrome
- `icons` — at least 192x192 and 512x512 PNG icons
- `theme_color` and `background_color`

## iOS Safari Limitations

Safari on iOS has PWA restrictions not present on Android:
- No push notifications support prior to iOS 16.4
- Service worker cache limited to ~50MB
- No background sync API
- `beforeinstallprompt` event not supported — users must manually "Add to Home Screen"
- Standalone mode doesn't share cookies/state with Safari
- Audio/video playback restrictions in standalone mode

## Key APIs

### Cache API
```javascript
// Open a named cache
const cache = await caches.open('app-v1');
await cache.put(request, response);
const cached = await cache.match(request);
```

### Background Sync
```javascript
// Register a sync event (deferred action when online)
const reg = await navigator.serviceWorker.ready;
await reg.sync.register('sync-messages');
```

### Web Push
```javascript
// Subscribe to push notifications
const sub = await reg.pushManager.subscribe({
  userVisibleOnly: true,
  applicationServerKey: vapidPublicKey,
});
```

## Lighthouse Targets
- Performance: >90
- Accessibility: >90
- Best Practices: >90
- PWA: all checks passing (installable, works offline, HTTPS)
