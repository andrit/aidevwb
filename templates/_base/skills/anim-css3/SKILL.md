---
name: anim-css3
description: CSS3 animations — @keyframes, custom property animation with @property, View Transitions API, and scroll-driven animations with animation-timeline
domain: animation
type: cross-cutting
triggers:
  - "CSS animation"
  - "keyframes"
  - "CSS transitions"
  - "CSS3 animation"
  - "scroll-driven"
  - "View Transitions"
  - "@keyframes"
  - "animation-timeline"
  - "CSS custom property animation"
---

# CSS3 Animation

## When to use

CSS3 animation is the correct default for most UI motion: hover states, loading indicators, fade-in/out on mount, progress bars, and decorative background effects. Use CSS when:

- The animation is triggered by state classes (`:hover`, `.active`, `.visible`)
- No JS coordination between elements is needed
- The animation loops or is always-on (spinners, shimmer, pulse)
- You want scroll-driven animation without a JS library (modern browsers only)
- You need page/view transitions with the View Transitions API

When multiple elements need precise sequencing, physics simulation, or scroll synchronization in Safari pre-2024, prefer GSAP (see `anim-gsap` skill).

## Prerequisites

- Any web project — no installation required
- View Transitions API: Chrome 111+, Safari 18+, Firefox 130+
- `animation-timeline: scroll()`: Chrome 115+, Firefox 110+, Safari 18+
- `@property`: Chrome 85+, Firefox 128+, Safari 16.4+
- Check [caniuse.com](https://caniuse.com) for current support tables

## Core Patterns

### @keyframes animation

```css
/* Define the animation */
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(24px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Apply it */
.hero-title {
  animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
  /*         name     duration  easing                    fill-mode */
}

/* Shorthand breakdown:
   animation: <name> <duration> <easing> <delay> <iteration-count> <direction> <fill-mode> <play-state>
*/

/* Stagger children using :nth-child delay */
.card-list .card:nth-child(1) { animation: fadeInUp 0.5s ease-out 0s    both; }
.card-list .card:nth-child(2) { animation: fadeInUp 0.5s ease-out 0.1s  both; }
.card-list .card:nth-child(3) { animation: fadeInUp 0.5s ease-out 0.2s  both; }

/* Use custom property for dynamic delay (set inline or via JS) */
.card-list .card {
  animation: fadeInUp 0.5s ease-out calc(var(--i, 0) * 100ms) both;
}
```

### Common keyframe templates

```css
/* Spinner */
@keyframes spin {
  to { transform: rotate(360deg); }
}
.spinner {
  animation: spin 0.8s linear infinite;
  will-change: transform;
}

/* Pulse (attention / loading state) */
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}
.loading-text {
  animation: pulse 1.5s ease-in-out infinite;
}

/* Shimmer skeleton */
@keyframes shimmer {
  from { background-position: -200% 0; }
  to   { background-position:  200% 0; }
}
.skeleton {
  background: linear-gradient(90deg, #e0e0e0 25%, #f5f5f5 50%, #e0e0e0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}

/* Bounce-in */
@keyframes bounceIn {
  0%   { transform: scale(0.3); opacity: 0; }
  50%  { transform: scale(1.1); }
  70%  { transform: scale(0.9); }
  100% { transform: scale(1);   opacity: 1; }
}
.modal-backdrop + .modal {
  animation: bounceIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

/* Slide in from right */
@keyframes slideInRight {
  from { transform: translateX(100%); opacity: 0; }
  to   { transform: translateX(0);    opacity: 1; }
}
.toast {
  animation: slideInRight 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
}
```

### CSS transitions

```css
/* Transition shorthand: property duration easing delay */
.button {
  background-color: #3b82f6;
  transform: scale(1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  transition:
    background-color 0.2s ease,
    transform        0.15s ease,
    box-shadow       0.2s ease;
}

.button:hover {
  background-color: #2563eb;
  transform: scale(1.02) translateY(-1px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
}

.button:active {
  transform: scale(0.98);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
}

/* Transition on class toggle (JS adds/removes class) */
.drawer {
  transform: translateX(-100%);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.drawer.is-open {
  transform: translateX(0);
}
```

### CSS custom property animation with @property

`@property` registers a CSS custom property with a type, enabling the browser to interpolate it. Without `@property`, custom property changes are not animatable (they snap instead of interpolate).

```css
/* Register the custom property with a type */
@property --hue {
  syntax: "<angle>";
  inherits: false;
  initial-value: 0deg;
}

@property --progress {
  syntax: "<number>";
  inherits: false;
  initial-value: 0;
}

/* Animate the registered property */
@keyframes rotateHue {
  to { --hue: 360deg; }
}

.gradient-text {
  background: linear-gradient(135deg, hsl(var(--hue), 80%, 60%), hsl(calc(var(--hue) + 120deg), 80%, 60%));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  animation: rotateHue 4s linear infinite;
}

/* Animated gradient border using @property */
@property --border-angle {
  syntax: "<angle>";
  inherits: false;
  initial-value: 0deg;
}

@keyframes borderSpin {
  to { --border-angle: 360deg; }
}

.glowing-card {
  --border-width: 2px;
  border-radius: 12px;
  background:
    linear-gradient(#1a1a2e, #1a1a2e) padding-box,
    conic-gradient(from var(--border-angle), #3b82f6, #8b5cf6, #ec4899, #3b82f6) border-box;
  border: var(--border-width) solid transparent;
  animation: borderSpin 3s linear infinite;
}
```

### View Transitions API — page transitions

```javascript
// Trigger a view transition (works in any SPA or MPA with navigation)
async function navigateTo(url) {
  if (!document.startViewTransition) {
    // Fallback for browsers without support
    window.location.href = url;
    return;
  }

  await document.startViewTransition(async () => {
    // Update the DOM inside the callback
    const response = await fetch(url);
    const html = await response.text();
    const parser = new DOMParser();
    const newDoc = parser.parseFromString(html, "text/html");
    document.body.innerHTML = newDoc.body.innerHTML;
    document.title = newDoc.title;
  });
}
```

```css
/* Default cross-fade is applied automatically. Override with custom keyframes: */
::view-transition-old(root) {
  animation: 300ms ease-in  both fade-out;
}
::view-transition-new(root) {
  animation: 300ms ease-out both fade-in;
}

@keyframes fade-out {
  to { opacity: 0; }
}
@keyframes fade-in {
  from { opacity: 0; }
}

/* Slide transition between pages */
::view-transition-old(root) {
  animation: 350ms ease-in-out both slide-out-left;
}
::view-transition-new(root) {
  animation: 350ms ease-in-out both slide-in-right;
}

@keyframes slide-out-left {
  to { transform: translateX(-30%); opacity: 0; }
}
@keyframes slide-in-right {
  from { transform: translateX(30%); opacity: 0; }
}

/* Named view transitions — animate a specific element (e.g., shared image hero) */
.hero-image {
  view-transition-name: hero;     /* must be unique per page */
}
/* The browser automatically animates the element between its old and new position */
```

For React Router / Next.js integration:

```tsx
// React: wrap router navigation calls in startViewTransition
import { useNavigate } from "react-router-dom";

export function useViewTransitionNavigate() {
  const navigate = useNavigate();

  return (to: string) => {
    if (!document.startViewTransition) {
      navigate(to);
      return;
    }
    document.startViewTransition(() => {
      navigate(to);
    });
  };
}
```

### Scroll-driven animation — animation-timeline: scroll()

No JavaScript required for scroll-linked animations in supporting browsers:

```css
/* Progress bar that fills as user scrolls the page */
@keyframes grow-width {
  from { width: 0%; }
  to   { width: 100%; }
}

.scroll-progress-bar {
  position: fixed;
  top: 0;
  left: 0;
  height: 3px;
  background: #3b82f6;
  animation: grow-width linear both;
  animation-timeline: scroll(root);  /* scroll() = scroll container, root = document */
}

/* Fade in element as it enters the viewport — element-based scroll timeline */
@keyframes reveal {
  from { opacity: 0; translate: 0 40px; }
  to   { opacity: 1; translate: 0 0; }
}

.section-card {
  animation: reveal linear both;
  animation-timeline: view();         /* view() = element's visibility in viewport */
  animation-range: entry 0% entry 30%; /* animate while element goes from 0% → 30% into view */
}

/* Parallax effect — move background at half the scroll speed */
@keyframes parallax-shift {
  from { transform: translateY(0); }
  to   { transform: translateY(-30%); }
}

.parallax-bg {
  animation: parallax-shift linear both;
  animation-timeline: scroll(root);
}
```

## Respecting Reduced Motion

Always wrap intensive animations in a reduced-motion check:

```css
/* Disable animations for users who prefer reduced motion */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

/* Better: design explicitly for reduced motion */
.animated-hero {
  animation: fadeInUp 0.6s ease-out both;
}

@media (prefers-reduced-motion: reduce) {
  .animated-hero {
    animation: none;
    opacity: 1;   /* ensure element is visible without animation */
    transform: none;
  }
}
```

## Performance Notes

- **Only animate `transform` and `opacity`** — these are GPU-composited and skip layout + paint. Everything else (`width`, `height`, `top`, `left`, `color`, `background`) triggers layout reflow or paint invalidation.
- **`will-change: transform`** — hints to the browser to promote the element to its own compositing layer before the animation starts. Remove after the animation: `will-change: auto`. Overuse creates memory pressure.
- **`contain: layout style paint`** — prevents animated elements from affecting the layout of surrounding elements. Useful for independently animated cards.
- **`animation-fill-mode: both`** — keeps the element in the `to` state after the animation ends and applies the `from` state before it starts. Without it, elements can flash to their CSS default value at the animation boundaries.

## Checklist

- [ ] Animating only `transform` and `opacity` — not width/height/top/left
- [ ] `@media (prefers-reduced-motion: reduce)` override for all animations
- [ ] `animation-fill-mode: both` set on entrance animations (elements don't flash)
- [ ] `@property` registered before using a custom property in a `@keyframes` rule
- [ ] View Transitions: fallback provided for non-supporting browsers (`if (!document.startViewTransition)`)
- [ ] `animation-timeline: view()` elements verified in Chrome DevTools Animations panel
- [ ] `view-transition-name` values are unique per rendered page

## Files involved

| File | Action |
|------|--------|
| `src/styles/animations.css` | Create: all `@keyframes` and `@property` declarations |
| `src/styles/globals.css` | Update: `prefers-reduced-motion` block, scroll-progress bar |
| `src/lib/navigation.ts` | Create: `useViewTransitionNavigate` hook |

## Common mistakes

**Animating a CSS custom property without `@property`** — `transition: --my-color 0.3s` does nothing. The browser cannot interpolate custom properties unless they are registered with `@property` (including a `syntax` type). Without registration, the value jumps instantly.

**`animation-fill-mode` omitted on entrance animations** — without `fill-mode: both` (or `forwards`), an element that is `opacity: 0` in the `from` keyframe is visible before the animation delay elapses, then snaps invisible, then fades in. Use `both` on all entrance animations.

**`will-change: transform` left on permanently** — adding `will-change` creates a new compositing layer that consumes GPU memory. It should be applied just before an animation starts (via a class) and removed after it ends. Never add it to every element by default.

**View transition `view-transition-name` collisions** — two elements on the page cannot share the same `view-transition-name` simultaneously. If a list renders multiple items and each has the same name, the view transition is skipped with a console error. Dynamically assign names based on item ID: `style="view-transition-name: item-${id}"`.

**`scroll-driven` + `overflow: hidden` parent** — `animation-timeline: scroll()` looks for the nearest scrolling ancestor. If a parent has `overflow: hidden` or `overflow: clip`, it is treated as the scroll container even though it does not scroll, resulting in an animation that never progresses. Ensure the intended scroll container is the actual scrollable element.
