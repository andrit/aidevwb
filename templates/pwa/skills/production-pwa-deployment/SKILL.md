---
name: production-pwa-deployment
description: Deploy a PWA to production — build pipeline with versioned cache names, service worker update flow, CDN deployment, HTTPS enforcement, and testing the update path end-to-end
domain: pwa
type: pwa
triggers:
  - "deploy pwa"
  - "pwa production"
  - "pwa build pipeline"
  - "service worker deploy"
  - "versioned cache"
  - "pwa update flow"
  - "cdn pwa"
  - "pwa https"
  - "pwa ci"
---

# Production PWA Deployment

## When to use

When a PWA built in the workbench is ready to serve real users. Development builds are unoptimized, use localhost, and have no CDN. Production PWA deployment means: a versioned build pipeline that bakes the cache name into the service worker, a CDN that serves the shell with `no-store` and static assets with long-lived cache headers, HTTPS enforcement (service workers require it), and a tested update flow so users actually receive new versions.

## Prerequisites

- PWA passing Lighthouse audit in workbench (`lighthouse-audit-fix` complete)
- Service worker implemented (`add-cache-strategy` complete)
- Push notifications configured if used (`setup-push-notifications` complete)
- Domain name provisioned with HTTPS certificate
- CDN account (Cloudflare, AWS CloudFront, or similar)

## Step 1 — Build Pipeline with Versioned Cache Names

The cache name must change with every deploy. If it doesn't, the service worker sees familiar cache names, skips re-caching, and users run stale assets indefinitely.

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const BUILD_VERSION = process.env.BUILD_VERSION ?? Date.now().toString();

export default defineConfig({
  build: {
    // Content-hash filenames for long-lived CDN caching
    rollupOptions: {
      output: {
        entryFileNames:   "assets/[name]-[hash].js",
        chunkFileNames:   "assets/[name]-[hash].js",
        assetFileNames:   "assets/[name]-[hash][extname]",
      },
    },
  },
  plugins: [
    VitePWA({
      registerType: "prompt",  // "autoUpdate" silently replaces — prefer "prompt" for user control

      workbox: {
        // Versioned cache names — MUST change with each deploy
        cacheId: `myapp-v${BUILD_VERSION}`,

        // Precache all build artifacts (Workbox generates the manifest)
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],

        // Runtime cache: API responses (short TTL)
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.myapp\.com\//,
            handler: "NetworkFirst",
            options: {
              cacheName: `api-cache-v${BUILD_VERSION}`,
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 300 },
            },
          },
        ],

        // Delete caches from previous versions on activation
        cleanupOutdatedCaches: true,
      },

      manifest: {
        name: "My App",
        short_name: "App",
        start_url: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#000000",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
});
```

Set `BUILD_VERSION` in CI so every deploy gets a unique cache ID:

```yaml
# .github/workflows/deploy.yml
- name: Build
  env:
    BUILD_VERSION: ${{ github.sha }}
  run: npm run build
```

## Step 2 — Service Worker Update Flow

The browser installs a new service worker in the background while the old one still controls the page. The new worker only activates when all tabs running the old version are closed — unless you prompt the user.

```typescript
// src/sw-register.ts — registers the service worker and handles updates
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", async () => {
    const reg = await navigator.serviceWorker.register("/sw.js");

    // Detect when a new worker is waiting
    reg.addEventListener("updatefound", () => {
      const newWorker = reg.installing;
      if (!newWorker) return;

      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          // New version ready — ask user to reload
          showUpdateBanner(() => {
            newWorker.postMessage({ type: "SKIP_WAITING" });
            window.location.reload();
          });
        }
      });
    });
  });

  // Reload when the new worker takes control
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    window.location.reload();
  });
}

function showUpdateBanner(onAccept: () => void): void {
  const banner = document.createElement("div");
  banner.className = "update-banner";
  banner.innerHTML = `
    <span>A new version is available.</span>
    <button id="update-btn">Update now</button>
  `;
  document.body.appendChild(banner);
  document.getElementById("update-btn")?.addEventListener("click", onAccept);
}
```

```typescript
// public/sw.js — handle SKIP_WAITING message
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
```

## Step 3 — CDN Configuration

The shell (`index.html`) must never be cached at the CDN — it's the entry point that fetches versioned assets. Versioned static assets (JS, CSS, fonts) can be cached for a year.

```nginx
# nginx.conf (origin server behind CDN)
server {
    listen 443 ssl;
    root /usr/share/nginx/html;
    index index.html;

    # Service worker — no cache (must always be fresh for update detection)
    location = /sw.js {
        add_header Cache-Control "no-store, max-age=0";
        add_header Service-Worker-Allowed "/";
    }

    # App shell — revalidate on every request
    location = /index.html {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    # Web app manifest — short cache
    location = /manifest.webmanifest {
        add_header Cache-Control "public, max-age=3600";
    }

    # Versioned assets (content-hash filenames) — cache for 1 year
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # SPA fallback — all paths serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

**Cloudflare Page Rules / Cache Rules:**
- `example.com/index.html` → Cache Level: Bypass
- `example.com/sw.js` → Cache Level: Bypass
- `example.com/assets/*` → Cache Level: Cache Everything, Edge TTL: 1 year

## Step 4 — HTTPS Enforcement

Service workers only register on HTTPS (and `localhost`). Redirect all HTTP traffic.

```nginx
# nginx.conf — HTTP redirect (handled before the app)
server {
    listen 80;
    server_name myapp.com www.myapp.com;
    return 301 https://$host$request_uri;
}
```

For SPAs deployed to Netlify/Vercel/Cloudflare Pages, HTTPS is enforced automatically. For custom deployments, use `certbot` with Let's Encrypt:

```bash
certbot --nginx -d myapp.com -d www.myapp.com
```

Verify the `Strict-Transport-Security` header is set (from the `security-hardening` skill):
```bash
curl -I https://myapp.com | grep -i strict
# Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

## Step 5 — Test the Update Path

The update path is the most commonly broken PWA feature. Test it explicitly before every production deploy.

```bash
#!/usr/bin/env bash
# scripts/test-sw-update.sh
# Requires: Playwright or Puppeteer installed

set -e

echo "=== Service Worker Update Test ==="

# 1. Verify sw.js is served with no-store
SW_CACHE=$(curl -sI https://staging.myapp.com/sw.js | grep -i "cache-control")
echo "$SW_CACHE" | grep -qi "no-store" \
  && echo "✓ sw.js: no-store header present" \
  || { echo "✗ sw.js: missing no-store — updates will be stale"; exit 1; }

# 2. Verify index.html is not cached
HTML_CACHE=$(curl -sI https://staging.myapp.com/ | grep -i "cache-control")
echo "$HTML_CACHE" | grep -qi "no-cache\|no-store" \
  && echo "✓ index.html: not cached" \
  || { echo "✗ index.html: may be cached by CDN"; exit 1; }

# 3. Verify assets are long-cached (look for a hashed asset)
ASSET_URL=$(curl -s https://staging.myapp.com/ | grep -o 'src="[^"]*assets/[^"]*\.js"' | head -1 | sed 's/src="//;s/"//')
if [ -n "$ASSET_URL" ]; then
  ASSET_CACHE=$(curl -sI "https://staging.myapp.com${ASSET_URL}" | grep -i "cache-control")
  echo "$ASSET_CACHE" | grep -qi "max-age=3153" \
    && echo "✓ versioned asset: long-lived cache" \
    || echo "⚠ versioned asset: cache header may need review"
fi

# 4. Verify HTTPS redirect
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://staging.myapp.com/)
[ "$HTTP_STATUS" = "301" ] \
  && echo "✓ HTTP redirects to HTTPS" \
  || { echo "✗ HTTP does not redirect (status: $HTTP_STATUS)"; exit 1; }

echo "=== All checks passed ==="
```

## Checklist

- [ ] `BUILD_VERSION` env var set in CI pipeline — tied to git SHA or build number
- [ ] `cacheId` includes `BUILD_VERSION` — cache names change every deploy
- [ ] `cleanupOutdatedCaches: true` — old cache entries deleted on activate
- [ ] `registerType: "prompt"` — user sees update banner, not silent reload
- [ ] `SKIP_WAITING` message handler in service worker — update happens when user accepts
- [ ] `sw.js` served with `Cache-Control: no-store` — browser always checks for new version
- [ ] `index.html` served with `Cache-Control: no-cache` — shell never served stale from CDN
- [ ] Versioned assets in `/assets/` cached with `max-age=31536000, immutable`
- [ ] HTTP → HTTPS redirect active (301, not 302)
- [ ] `Strict-Transport-Security` header present on HTTPS responses
- [ ] Update path smoke test passes on staging before production deploy

## Files involved

| File | Action |
|------|--------|
| `vite.config.ts` | Update: `cacheId` with `BUILD_VERSION`, `cleanupOutdatedCaches: true` |
| `src/sw-register.ts` | Update: `updatefound` handler + update banner |
| `public/sw.js` | Update: `SKIP_WAITING` message handler |
| `nginx.conf` | Update: per-path cache headers, HTTP→HTTPS redirect |
| `scripts/test-sw-update.sh` | Create: post-deploy update path smoke test |
| `.github/workflows/deploy.yml` | Update: set `BUILD_VERSION=${{ github.sha }}` |

## Common mistakes

**`registerType: "autoUpdate"`** — silently installs and reloads the page without warning. Users mid-task lose unsaved state. Use `"prompt"` and show a non-intrusive banner.

**Not versioning the cache name** — if `cacheId` is constant across deploys, the new service worker sees an existing cache and skips re-caching. Users get old assets until they hard-refresh. Always tie `cacheId` to a build artifact (git SHA, build number).

**CDN caching `index.html`** — if the CDN caches the shell, users receive a stale version that references old hashed assets that no longer exist at the CDN. The shell must always be served fresh. Bypass the CDN for `index.html` and `sw.js`.

**Not testing the update path on staging** — the update flow involves the browser, the service worker, and the CDN cache all interacting. Unit tests can't catch cache header misconfigurations. Run the smoke test script against staging before every production deploy.
