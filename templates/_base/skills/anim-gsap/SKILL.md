---
name: anim-gsap
description: Animate with GSAP — timelines, ScrollTrigger scroll-driven animations, SVG morphing, stagger effects, and React integration via useGSAP
domain: animation
type: cross-cutting
triggers:
  - "GSAP"
  - "GreenSock"
  - "ScrollTrigger"
  - "timeline animation"
  - "scroll animation"
  - "stagger animation"
  - "SVG morph"
---

# GSAP Animation

## When to use

When a project requires precise, sequenced JS-driven animations — hero reveals, scroll-linked storytelling, SVG morphing, or staggered list entrances. GSAP is the right choice when CSS animations reach their limits: cross-browser timeline control, scroll synchronization, or complex SVG path interpolation. For simple hover/transition states, prefer CSS transitions (see `anim-css3` skill).

## Prerequisites

- Node.js project with npm
- React project if using `useGSAP` hook (any React 18+ setup)
- For ScrollTrigger: a scrollable page layout (no `overflow: hidden` on body)

## Installation

```bash
npm install gsap
# ScrollTrigger is bundled with gsap — no separate install needed
```

For React integration:

```bash
npm install gsap @gsap/react
```

## Core Patterns

### Basic tween — gsap.to / gsap.from / gsap.fromTo

```typescript
import gsap from "gsap";

// Animate TO final values (element starts from current state)
gsap.to(".hero-title", {
  opacity: 1,
  y: 0,
  duration: 0.8,
  ease: "power3.out",
});

// Animate FROM starting values (element starts here, returns to CSS state)
gsap.from(".hero-title", {
  opacity: 0,
  y: 40,
  duration: 0.8,
  ease: "power3.out",
});

// Explicit FROM → TO (most predictable — define both states)
gsap.fromTo(
  ".hero-title",
  { opacity: 0, y: 40 },
  { opacity: 1, y: 0, duration: 0.8, ease: "power3.out" }
);
```

### Timeline — sequenced, controllable animations

```typescript
import gsap from "gsap";

// Create a timeline and chain tweens
const tl = gsap.timeline({
  defaults: { ease: "power2.out", duration: 0.6 },
  onComplete: () => console.log("Intro complete"),
});

tl.fromTo(".nav",       { y: -60, opacity: 0 }, { y: 0, opacity: 1 })
  .fromTo(".hero-text", { opacity: 0, y: 30 },  { opacity: 1, y: 0 }, "-=0.3") // overlap 0.3s
  .fromTo(".hero-cta",  { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1 }, "+=0.1");

// Pause, resume, reverse, seek
tl.pause();
tl.play();
tl.reverse();
tl.seek(1.2); // jump to 1.2s mark
tl.timeScale(2); // double speed
```

### Stagger — animating multiple elements with offset

```typescript
import gsap from "gsap";

// Stagger a list of cards
gsap.from(".card", {
  opacity: 0,
  y: 50,
  duration: 0.5,
  stagger: 0.1,          // each card starts 100ms after the previous
  ease: "power2.out",
});

// Advanced stagger: from center outward, with grid layout
gsap.from(".grid-item", {
  opacity: 0,
  scale: 0.8,
  duration: 0.4,
  stagger: {
    amount: 0.8,         // total stagger spread in seconds
    from: "center",      // start from the center element
    grid: [3, 4],        // 3 rows × 4 columns — calculates 2D stagger distances
  },
});
```

### ScrollTrigger — scroll-driven animation

```typescript
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

// REQUIRED: register the plugin before use
gsap.registerPlugin(ScrollTrigger);

// Animate when element enters the viewport
gsap.from(".section-heading", {
  opacity: 0,
  x: -60,
  duration: 0.8,
  ease: "power3.out",
  scrollTrigger: {
    trigger: ".section-heading",  // element that triggers the animation
    start: "top 80%",             // when top of trigger hits 80% down the viewport
    end: "top 40%",               // end point (for scrub)
    toggleActions: "play none none reverse",
    // toggleActions: onEnter onLeave onEnterBack onLeaveBack
    // values: "play", "pause", "resume", "reset", "restart", "complete", "reverse", "none"
  },
});

// Scrub — animation progress tied directly to scroll position
gsap.to(".parallax-bg", {
  yPercent: -30,
  ease: "none",
  scrollTrigger: {
    trigger: ".hero",
    start: "top top",
    end: "bottom top",
    scrub: true,        // true = instant scrub, number = seconds of lag (smoothness)
  },
});

// Pin a section while animating through a sequence
const pinTl = gsap.timeline({
  scrollTrigger: {
    trigger: ".pinned-section",
    start: "top top",
    end: "+=2000",      // pin for 2000px of scroll
    pin: true,
    scrub: 1,           // 1 second smooth scrub
  },
});

pinTl
  .from(".step-1", { opacity: 0, x: -100 })
  .from(".step-2", { opacity: 0, x: 100 })
  .from(".step-3", { opacity: 0, scale: 0.5 });
```

### SVG path morphing

```typescript
import gsap from "gsap";
import { MorphSVGPlugin } from "gsap/MorphSVGPlugin"; // Club GreenSock (paid) or use free workaround

gsap.registerPlugin(MorphSVGPlugin);

// Morph one SVG path shape to another
gsap.to("#shape-start", {
  morphSVG: "#shape-end",  // target path's 'd' attribute
  duration: 1.2,
  ease: "power2.inOut",
  repeat: -1,
  yoyo: true,
});

// Free alternative: animate the 'd' attribute directly (paths must have same number of points)
gsap.to("#my-path", {
  attr: {
    d: "M 10 80 Q 95 10 180 80",  // target path data
  },
  duration: 1,
  ease: "power2.inOut",
});
```

### React integration — useGSAP hook

The `useGSAP` hook from `@gsap/react` handles cleanup automatically (kills tweens when component unmounts) and integrates with React's rendering cycle. Always use it instead of raw `useEffect` for GSAP in React.

```tsx
import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

interface HeroProps {
  title: string;
  subtitle: string;
}

export function Hero({ title, subtitle }: HeroProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      // All GSAP code here — automatically cleaned up on unmount
      const tl = gsap.timeline({ defaults: { ease: "power3.out", duration: 0.7 } });

      tl.fromTo("h1", { opacity: 0, y: 50 }, { opacity: 1, y: 0 })
        .fromTo("p",  { opacity: 0, y: 30 }, { opacity: 1, y: 0 }, "-=0.4");

      // ScrollTrigger inside useGSAP — also auto-cleaned up
      gsap.from(".feature-card", {
        opacity: 0,
        y: 60,
        stagger: 0.15,
        scrollTrigger: {
          trigger: ".features",
          start: "top 75%",
        },
      });
    },
    { scope: containerRef } // scope limits selector queries to this component's DOM
  );

  return (
    <div ref={containerRef}>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      <div className="features">
        <div className="feature-card">Feature 1</div>
        <div className="feature-card">Feature 2</div>
        <div className="feature-card">Feature 3</div>
      </div>
    </div>
  );
}
```

## Performance Notes

- **GPU compositing:** Animate `transform` (translate, scale, rotate) and `opacity` only — these are GPU-composited and do not trigger layout. Animating `width`, `height`, `top`, `left`, `margin` triggers layout reflow on every frame and is slow.
- **will-change:** Add `will-change: transform` to elements that will animate. GSAP can set this automatically: `gsap.set(".box", { willChange: "transform" })`. Remove after animation: `gsap.set(".box", { willChange: "auto" })`.
- **ScrollTrigger refresh:** Call `ScrollTrigger.refresh()` after dynamic content loads (e.g., after an image loads that shifts layout). Wrap in a `ResizeObserver` for robustness.
- **Avoid animating layout-triggering properties** — `width`, `height`, `padding`, `border` all trigger layout. Use `scaleX`/`scaleY` with `transform-origin` adjustments instead of width/height.

## Checklist

- [ ] `gsap.registerPlugin(ScrollTrigger)` called once at module level (not inside a component or effect)
- [ ] React: using `useGSAP` with `{ scope: containerRef }` — not raw `useEffect`
- [ ] Only animating `transform` and `opacity` properties for performance
- [ ] `ScrollTrigger.refresh()` called after any dynamic content/image loads
- [ ] Timelines stored in a ref or variable if you need to pause/reverse/seek them
- [ ] Stagger on lists uses selector strings, not imperative loops

## Files involved

| File | Action |
|------|--------|
| `src/components/Hero.tsx` | Create/update: add `useGSAP` animation hook |
| `src/lib/animations.ts` | Create: shared timeline factory functions |
| `src/main.tsx` or `src/index.ts` | Update: `gsap.registerPlugin(ScrollTrigger)` at entry point |

## Common mistakes

**Calling `registerPlugin` inside a React component or `useEffect`** — plugins must be registered once at module level. Inside a component, the registration runs on every render or re-mount. Move `gsap.registerPlugin(ScrollTrigger)` to the top of the file, outside all functions.

**Using raw `useEffect` instead of `useGSAP`** — GSAP tweens and ScrollTriggers created in `useEffect` are not automatically cleaned up unless you return a cleanup function. `useGSAP` handles this; missing cleanup causes memory leaks and duplicate animations on re-renders.

**`gsap.from()` in strict mode double-invocation** — React 18 Strict Mode mounts/unmounts/remounts components, causing `gsap.from()` to fire twice. The element ends up at its CSS state (visible), then the from-animation starts from hidden again. Use `gsap.fromTo()` to always control both endpoints explicitly.

**ScrollTrigger start/end values flip when viewport changes** — `start: "top 80%"` is calculated once. If the page layout shifts after initialization (lazy-loaded images, accordions opening), triggers are wrong. Always call `ScrollTrigger.refresh()` after layout-affecting operations.

**Selector scope leaking in React** — `gsap.to(".card", ...)` inside a component selects ALL `.card` elements on the page, including those in other components. Always pass `{ scope: containerRef }` to `useGSAP` so GSAP scopes selectors to the component's DOM subtree.
