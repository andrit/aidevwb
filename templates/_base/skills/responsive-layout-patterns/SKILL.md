---
name: responsive-layout-patterns
description: Responsive layout implementation — mobile-first strategy, content-driven breakpoints, CSS Grid patterns, container queries, fluid sizing with clamp(), and intrinsic layout techniques
domain: design
type: cross-cutting
triggers:
  - "responsive design"
  - "responsive layout"
  - "mobile first"
  - "breakpoints"
  - "container queries"
  - "fluid layout"
  - "CSS Grid patterns"
  - "responsive grid"
  - "adaptive layout"
---

# Responsive Layout Patterns

## When to use

When building any UI that needs to work across viewport sizes. Mobile-first is not optional — Google uses mobile-first indexing; most user traffic is mobile; designing desktop-first and retrofitting mobile produces worse mobile experiences. This skill covers implementation patterns; for composition theory see `layout-and-composition`.

## Mobile-First vs Desktop-First

**Mobile-first:** Write base styles for the smallest viewport. Use `min-width` media queries to add styles for larger viewports. Start with the hardest constraint and expand.

**Desktop-first:** Write base styles for desktop. Use `max-width` media queries to override for smaller viewports. Start easy and progressively break things.

**Why mobile-first wins:**
- Forces content prioritization — what is essential enough to show on mobile? That hierarchy carries to desktop.
- Progressive enhancement — add complexity as space allows; don't subtract it.
- Performance — smaller viewports don't load desktop-only assets unless specifically loaded.
- CSS specificity — `min-width` overrides layer cleanly; cascading `max-width` overrides can conflict.

```css
/* ✗ Desktop-first: base styles assume large viewport */
.nav { display: flex; gap: 24px; }
@media (max-width: 768px) { .nav { flex-direction: column; } }

/* ✓ Mobile-first: base styles are mobile; expand for larger viewports */
.nav { display: flex; flex-direction: column; gap: 16px; }
@media (min-width: 768px) { .nav { flex-direction: row; gap: 24px; } }
```

## Breakpoint Strategy

**Content-driven breakpoints** (preferred) — set a breakpoint when the content needs it, not when a device exists. Inspect your layout at every viewport width; add a breakpoint where it breaks.

**Device-driven breakpoints** (common but fragile) — tied to specific device sizes that change every hardware generation.

**Practical breakpoints** (used by most frameworks):

```css
:root {
  /* Breakpoints as custom media queries (PostCSS or Sass) */
  /* Alternatively, reference these values in @media queries */
}

/* Tailwind-style naming (adjust values to your content's needs) */
/* sm  */ @media (min-width: 640px)  { ... }
/* md  */ @media (min-width: 768px)  { ... }
/* lg  */ @media (min-width: 1024px) { ... }
/* xl  */ @media (min-width: 1280px) { ... }
/* 2xl */ @media (min-width: 1536px) { ... }
```

**The real test:** Drag the browser window from 320px to 2560px. Every layout should look intentional at every width. Layout jumps are acceptable at breakpoints; visual breakage (overflow, overlap, text collision) is not.

## Core CSS Grid Patterns

```css
/* Pattern 1: Classic sidebar layout */
.with-sidebar {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: var(--space-8);
}
@media (max-width: 768px) {
  .with-sidebar { grid-template-columns: 1fr; }
}

/* Pattern 2: Holy grail (header, footer, two sidebars, main) */
.holy-grail {
  display: grid;
  grid-template:
    "header  header  header"  auto
    "nav     main    aside"   1fr
    "footer  footer  footer"  auto
    / 200px  1fr     200px;
  min-height: 100dvh;
}
@media (max-width: 900px) {
  .holy-grail {
    grid-template:
      "header" auto
      "nav"    auto
      "main"   1fr
      "aside"  auto
      "footer" auto
      / 1fr;
  }
}

/* Pattern 3: Auto-fit card grid (intrinsic — no breakpoints needed) */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-6);
}

/* Pattern 4: Centered content with max-width */
.content {
  max-width: 1280px;
  margin-inline: auto;
  padding-inline: clamp(var(--space-4), 5vw, var(--space-12));
}

/* Pattern 5: Feature section (image + text, alternating sides) */
.feature-section {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-12);
  align-items: center;
}
.feature-section:nth-child(even) { direction: rtl; } /* Flip order */
.feature-section > * { direction: ltr; }             /* Reset content direction */

@media (max-width: 768px) {
  .feature-section { grid-template-columns: 1fr; }
  .feature-section:nth-child(even) { direction: ltr; }
}
```

## Flexbox Patterns

```css
/* Navigation bar */
.navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-6);
  padding: var(--space-4) var(--space-6);
}
.navbar-logo { flex-shrink: 0; }
.navbar-links { display: flex; gap: var(--space-4); flex: 1; justify-content: center; }
.navbar-actions { flex-shrink: 0; }

/* Cluster (wrapping badge/tag group) */
.cluster {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

/* Stack (vertical rhythm) */
.stack > * + * { margin-top: var(--space-4); }
/* Or: */
.stack { display: flex; flex-direction: column; gap: var(--space-4); }

/* Switcher: horizontal when space allows, vertical when not */
.switcher {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-6);
}
.switcher > * {
  flex-grow: 1;
  flex-basis: calc((30rem - 100%) * 999);
  /* When container < 30rem: flex-basis huge → wraps to single column
     When container ≥ 30rem: flex-basis negative → horizontal */
}
```

## Container Queries

Container queries respond to the container's size rather than the viewport's size. A card component can be narrow in a sidebar and wide in a main content area — the same component, two layouts.

```css
/* Mark a container as a query context */
.card-container {
  container-type: inline-size;
  container-name: card;
}

/* Style the card based on its container's width */
.card {
  display: grid;
  grid-template-columns: 1fr;    /* Default: stacked */
  gap: var(--space-4);
}

@container card (min-width: 400px) {
  .card {
    grid-template-columns: 160px 1fr;  /* Side-by-side when wide enough */
    gap: var(--space-6);
  }
}

/* Real-world: a product card that can appear in both grid and list views */
.product-card {
  container-type: inline-size;
}
.product-card__inner {
  display: flex;
  flex-direction: column;
}
@container (min-width: 500px) {
  .product-card__inner {
    flex-direction: row;
    align-items: center;
  }
}
```

**Browser support:** Container queries are supported in all modern browsers (Chrome 105+, Firefox 110+, Safari 16+). Safe for production with a CSS `@supports` fallback if needed.

## Fluid Sizing

Use `clamp()` to size elements that should grow smoothly between minimum and maximum values without breakpoint jumps.

```css
/* Fluid spacing: 16px at 320px viewport → 48px at 1280px */
.section {
  padding-block: clamp(1rem, 2.5vw + 0.5rem, 3rem);
}

/* Fluid grid gap: 16px → 32px */
.grid {
  gap: clamp(1rem, 2vw, 2rem);
}

/* Fluid page gutter: 16px → 80px */
.content {
  padding-inline: clamp(1rem, 5vw, 5rem);
}

/* Fluid max-width for prose: always comfortable to read */
.prose {
  max-width: clamp(45ch, 60vw, 75ch);
}
```

**The clamp formula:**
```
clamp(MIN, PREFERRED, MAX)
PREFERRED = slope * 100vw + intercept

Where:
  slope = (MAX_SIZE - MIN_SIZE) / (MAX_VP - MIN_VP)
  intercept = MIN_SIZE - slope * MIN_VP
```

Use [Utopia.fyi](https://utopia.fyi) to generate fluid space and type scales automatically.

## Responsive Images

```html
<!-- art direction: different crop for different sizes -->
<picture>
  <source media="(max-width: 767px)" srcset="hero-mobile.webp">
  <source media="(min-width: 768px)" srcset="hero-desktop.webp">
  <img src="hero-desktop.webp" alt="Hero image" loading="lazy" decoding="async">
</picture>

<!-- resolution switching: same crop, different resolution -->
<img
  src="photo-800.webp"
  srcset="photo-400.webp 400w, photo-800.webp 800w, photo-1600.webp 1600w"
  sizes="(max-width: 768px) 100vw, 50vw"
  alt="Product photo"
  loading="lazy"
  decoding="async"
>
```

## Checklist

- [ ] Mobile-first: base CSS is for narrowest viewport; `min-width` queries add for larger
- [ ] Layout works at every viewport width from 320px to 2560px (no overflow or collision)
- [ ] Content-driven breakpoints: value chosen where content breaks, not device assumption
- [ ] Auto-fill/auto-fit card grids don't require breakpoints
- [ ] Container queries used for components that appear at different sizes across contexts
- [ ] `clamp()` for fluid spacing and sizing between breakpoints
- [ ] `max-width` + `margin-inline: auto` centers content; `padding-inline` provides edge gutter
- [ ] Responsive images: `srcset` + `sizes` for variable-width images

## Common mistakes

**Desktop-first with `max-width` overrides** — adding `max-width: 768px` rules to undo desktop styles for mobile creates specificity battles and fragile cascades. Restart with mobile-first.

**Breakpoints at every round-number pixel** — 320px, 480px, 576px, 768px, 992px, 1200px, 1400px is six breakpoints before a single line of content-specific CSS. Add breakpoints only where the content actually breaks.

**Not using `dvh` for full-viewport-height layouts** — `100vh` on mobile includes the browser chrome (address bar), causing overflow. Use `100dvh` (dynamic viewport height) for elements intended to fill the visible viewport.

**Ignoring landscape mobile** — a 375×812 iPhone in portrait is a phone. The same device at 812×375 in landscape is a small tablet and needs a different layout. Check landscape at common mobile sizes.
