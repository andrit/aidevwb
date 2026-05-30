---
name: lighthouse-audit-fix
description: Run a Lighthouse audit, interpret the scores, prioritize fixes, and get all 4 PWA categories above 90 — Performance, Accessibility, Best Practices, and the PWA installability checklist
domain: pwa
type: pwa
triggers:
  - "lighthouse audit"
  - "improve lighthouse score"
  - "PWA score"
  - "performance score"
  - "installable"
  - "lighthouse"
  - "web vitals"
  - "CLS"
  - "LCP"
  - "FCP"
  - "make it installable"
---

# Lighthouse Audit and Fix

## When to use

When the app needs to pass PWA installability checks, when performance feels slow, or when the goal is a Lighthouse score above 90 across all categories. Activate when the user asks "run lighthouse", "why isn't my app installable", or "how do I improve my score."

## Prerequisites

- App deployed to HTTPS (Lighthouse PWA checks require a real URL, not localhost — or use `--chrome-flags="--ignore-certificate-errors"` for staging)
- Service worker registered and active
- `web app manifest` linked in HTML

## Running Lighthouse

```bash
# Option 1: Chrome DevTools — open DevTools → Lighthouse tab → Generate report
# Best for interactive investigation

# Option 2: CLI (for CI integration)
npm install -g lighthouse
lighthouse https://your-app.com --output=html --output-path=./lighthouse-report.html

# Option 3: CI with JSON output for score gating
lighthouse https://your-app.com --output=json --output-path=./lighthouse.json --chrome-flags="--headless --no-sandbox"

# Parse scores in CI (fail if any category < 90):
node -e "
  const r = require('./lighthouse.json');
  const cats = r.categories;
  const pass = Object.entries(cats).every(([k, v]) => {
    const score = v.score * 100;
    const ok = score >= 90;
    console.log(k + ': ' + score.toFixed(0) + (ok ? ' ✓' : ' ✗ FAIL'));
    return ok;
  });
  process.exit(pass ? 0 : 1);
"
```

## Score Targets

| Category | Target | Min to pass |
|----------|--------|-------------|
| Performance | 90+ | 80 |
| Accessibility | 95+ | 90 |
| Best Practices | 95+ | 90 |
| SEO | 90+ | 80 |
| PWA | All checks pass | All checks pass |

**PWA is pass/fail, not a number.** Every checklist item must pass.

## PWA Installability Checklist

Lighthouse checks these — all must pass before the browser shows an install prompt:

```
✓ Served over HTTPS
✓ Has a registered service worker with a fetch event handler
✓ Has a web app manifest linked with <link rel="manifest" href="/manifest.json">
✓ Manifest has: name or short_name, icons (192px + 512px), start_url, display
✓ Icons exist at the specified sizes
✓ display is "standalone", "fullscreen", or "minimal-ui" (not "browser")
✓ start_url is reachable
```

### Minimal manifest that passes

```json
{
  "name": "My App",
  "short_name": "App",
  "description": "What the app does",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#333333",
  "icons": [
    { "src": "/pwa-192x192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/pwa-512x512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/pwa-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

Link in HTML:
```html
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#333333" />
<!-- iOS Safari requires these — manifest isn't used on iOS -->
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="My App" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
```

## Performance Fixes (High Impact → Low Impact)

### LCP (Largest Contentful Paint) — target < 2.5s

The LCP element is usually a hero image or the main heading.

```html
<!-- Preload the LCP image — tells browser to fetch immediately -->
<link rel="preload" as="image" href="/hero.webp" />

<!-- Or if it's a font causing LCP -->
<link rel="preload" as="font" href="/fonts/Inter.woff2" crossorigin />
```

```typescript
// vite.config.ts — convert images to WebP at build time
import viteImagemin from "vite-plugin-imagemin";

export default defineConfig({
  plugins: [
    viteImagemin({
      webp: { quality: 80 },
    }),
  ],
});
```

```html
<!-- Use <picture> for next-gen format with fallback -->
<picture>
  <source srcset="/hero.webp" type="image/webp" />
  <img src="/hero.jpg" alt="Hero" loading="eager" fetchpriority="high" />
</picture>
```

### CLS (Cumulative Layout Shift) — target < 0.1

CLS happens when content shifts after initial render — images without dimensions, late-loading fonts, ads injected above content.

```html
<!-- Always set width + height on images -->
<img src="/photo.jpg" width="800" height="600" alt="..." />

<!-- Reserve space for async content -->
<div style="min-height: 200px">
  <!-- loaded asynchronously -->
</div>
```

```css
/* Prevent font layout shift — use font-display: optional for non-critical fonts */
@font-face {
  font-family: "Inter";
  src: url("/fonts/Inter.woff2") format("woff2");
  font-display: swap;   /* shows fallback, then swaps — CLS risk */
  /* font-display: optional; — no swap, no CLS, may use fallback permanently */
}
```

### FID / INP (Interaction responsiveness) — target < 200ms

```typescript
// Break up long tasks with scheduler API or setTimeout(0)
async function processLargeList(items: Item[]) {
  const CHUNK_SIZE = 100;
  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    processChunk(items.slice(i, i + CHUNK_SIZE));
    // Yield to the browser between chunks
    await new Promise((r) => setTimeout(r, 0));
  }
}

// Defer non-critical initialization
window.addEventListener("load", () => {
  // Third-party scripts, analytics, etc.
  setTimeout(() => initAnalytics(), 3000);
});
```

### Bundle size

```bash
# Analyze bundle composition
npm install -D rollup-plugin-visualizer

# vite.config.ts
import { visualizer } from "rollup-plugin-visualizer";
plugins: [visualizer({ open: true })]

# Run build — a treemap opens in the browser showing what's large
npm run build
```

Common fixes:
```typescript
// Dynamic import for large, rarely-used features
const HeavyChart = lazy(() => import("./components/HeavyChart"));

// Import only what you use from large libraries
import { format } from "date-fns";        // ✓ tree-shakeable
import _ from "lodash";                   // ✗ imports everything
import { debounce } from "lodash-es";     // ✓ tree-shakeable
```

## Accessibility Fixes (Most Common Failures)

```html
<!-- Missing alt text -->
<img src="logo.png" alt="Company logo" />         <!-- descriptive -->
<img src="decorative.png" alt="" role="presentation" /> <!-- decorative -->

<!-- Missing form labels -->
<label for="email">Email</label>
<input id="email" type="email" name="email" />

<!-- Low contrast — check in DevTools: Ctrl+Shift+C → Accessibility -->
<!-- Target: 4.5:1 for normal text, 3:1 for large text (18px+) -->

<!-- Missing ARIA on interactive elements -->
<button aria-label="Close dialog" aria-expanded={isOpen}>✕</button>

<!-- Focus management for modals -->
<dialog open aria-labelledby="dialog-title">
  <h2 id="dialog-title">Confirm deletion</h2>
  <!-- ... -->
</dialog>
```

```typescript
// Focus trap in modals
useEffect(() => {
  if (isOpen) {
    const firstFocusable = modalRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    firstFocusable?.focus();
  }
}, [isOpen]);
```

## Best Practices Fixes

```html
<!-- Use HTTPS for all resources -->
<!-- ✗ <script src="http://..."> -->
<!-- ✓ <script src="https://..."> or relative paths -->

<!-- Content Security Policy -->
<meta http-equiv="Content-Security-Policy"
  content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';" />

<!-- Avoid document.write() — blocks parsing -->
<!-- Avoid deprecated APIs (sync XHR, etc.) -->
```

## CI Integration

```yaml
# .github/workflows/lighthouse.yml
name: Lighthouse
on: [pull_request]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: npm ci && npm run build
      - run: npx serve dist &  # Start server in background
      - run: sleep 3
      - run: |
          npx lighthouse http://localhost:3000 \
            --output=json \
            --output-path=lighthouse.json \
            --chrome-flags="--headless --no-sandbox"
      - name: Assert scores
        run: |
          node -e "
            const r = require('./lighthouse.json').categories;
            const thresholds = { performance: 0.9, accessibility: 0.9, 'best-practices': 0.9, seo: 0.8 };
            let failed = false;
            for (const [k, t] of Object.entries(thresholds)) {
              const score = r[k]?.score ?? 0;
              if (score < t) { console.error(k + ': ' + (score * 100).toFixed(0) + ' < ' + (t * 100)); failed = true; }
            }
            if (failed) process.exit(1);
          "
```

## Checklist

- [ ] All 4 Lighthouse categories scored (Performance, Accessibility, Best Practices, PWA)
- [ ] PWA checklist: HTTPS, service worker with fetch handler, manifest linked, icons at 192px and 512px, `display: standalone`
- [ ] iOS meta tags: `apple-mobile-web-app-capable`, `apple-touch-icon`
- [ ] LCP < 2.5s — hero image preloaded, converted to WebP
- [ ] CLS < 0.1 — images have explicit width/height, fonts use `font-display`
- [ ] All images have `alt` text (decorative images: `alt=""`)
- [ ] All form inputs have associated labels
- [ ] Color contrast ≥ 4.5:1 for body text
- [ ] No HTTP resources on an HTTPS page
- [ ] Lighthouse CI gate in CI/CD pipeline

## Files involved

| File | Action |
|------|--------|
| `public/manifest.json` | Create/update: name, icons, start_url, display, theme_color |
| `index.html` | Update: `<link rel="manifest">`, `theme-color` meta, apple meta tags |
| `public/pwa-192x192.png` | Create: 192×192 icon |
| `public/pwa-512x512.png` | Create: 512×512 icon (also maskable) |
| `public/apple-touch-icon.png` | Create: 180×180 for iOS Home Screen |
| `vite.config.ts` | Update: imagemin plugin, VitePWA manifest config |
| `.github/workflows/lighthouse.yml` | Create: CI score gate |

## Common mistakes

**Running Lighthouse on localhost** — localhost bypasses PWA HTTPS checks and gives inflated scores because there's no real network latency. Use a staging URL for pre-ship audits.

**Only one icon size** — the manifest needs at least a 192px and a 512px icon. Missing either causes the PWA installability check to fail. Add a `maskable` purpose variant of the 512px icon for Android adaptive icons.

**`display: "browser"` in the manifest** — this is the default but it means the app opens in a browser tab with the URL bar, not as a standalone app. Set to `"standalone"` for app-like appearance.

**Ignoring iOS meta tags** — Safari on iOS doesn't use the manifest for Home Screen bookmarks. It requires `apple-mobile-web-app-capable`, `apple-touch-icon`, and `apple-mobile-web-app-title` meta tags separately.

**Fixing symptoms instead of root causes** — a low Performance score often comes from one large bundle or one unoptimized image, not 10 small issues. Run the bundle visualizer and look at the waterfall — fix the biggest item first.
