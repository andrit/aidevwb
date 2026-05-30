---
name: animation-and-motion
description: Animation theory — Disney's 12 principles, easing curves, motion as UX affordance, timeline animation — and implementation with CSS transitions, Framer Motion, and GSAP; including prefers-reduced-motion
domain: design
type: cross-cutting
triggers:
  - "animation"
  - "motion design"
  - "transitions"
  - "Framer Motion"
  - "GSAP"
  - "easing"
  - "animation as affordance"
  - "reduced motion"
  - "timeline animation"
  - "micro-animation"
  - "page transitions"
---

# Animation and Motion

## When to use

When adding transitions to a UI, discussing motion design with a designer, or deciding whether animation serves the user or just looks good. Animation is the most easily misused design tool: it costs performance, can cause harm (vestibular disorders), and when wrong reads as unprofessional faster than any other design mistake. This skill separates purposeful motion from decoration.

## Why Motion Exists in UI

Animation in interfaces earns its existence by doing at least one of these:

**Spatial orientation** — reveals where content came from and where it went. A panel that slides in from the right establishes that it's "to the right" of the current view. The back gesture slides it out right. The user builds a mental map.

**State continuity** — connects a before and after state. A card that expands into a full-screen view is obviously the same object. Without animation, users must infer the relationship.

**Feedback and confirmation** — confirms that an action was received. A button press that visually responds gives immediate feedback. Delay without animation looks like nothing happened.

**Directing attention** — a subtle pulse on a new notification; a badge count that animates in. Animation is the strongest attention-direction signal in UI.

**Delight and personality** — the least defensible category. Acceptable only after the first three are satisfied, and only at a dose that doesn't impede the user.

**Designer discussion vocabulary:** "This animation isn't earning its runtime — it's decorative. Can you articulate what spatial relationship or state change it communicates?" / "The loading skeleton solves a real problem: it holds the layout space and sets expectations. The page entrance animation does neither."

## Disney's 12 Principles of Animation

Frank Thomas and Ollie Johnston's principles (from *The Illusion of Life*, 1981) were developed for character animation but apply directly to UI motion. See `docs/references.md`.

**1. Squash and Stretch** — objects deform under acceleration and compression, implying mass and physicality. In UI: subtle scale changes (a button that squashes on press, bounces on release) imply physical response.

**2. Anticipation** — a small preparatory movement before the main action. A dropdown menu that briefly expands upward before extending downward. Rare in UI; misuse causes jarring double-movements.

**3. Staging** — present the important thing clearly, one at a time. In UI: staggered list animations that introduce items sequentially, so each item has a moment to register.

**4. Straight-ahead vs Pose-to-Pose** — Pose-to-pose (keyframe) is the UI approach: define start state, end state, and the interpolation between them.

**5. Follow-through and Overlapping Action** — when the main element stops, secondary elements continue briefly before settling. A menu that overshoots and springs back slightly. Creates a sense of momentum.

**6. Slow In and Slow Out** — objects accelerate from rest and decelerate to rest. Constant-velocity motion (linear) looks mechanical and wrong. This is the easing principle. See: cubic-bezier curves.

**7. Arcs** — natural movement follows curved paths, not straight lines. In UI: rare; mostly relevant for objects moving across a screen (notification arriving from a corner).

**8. Secondary Action** — small supporting motion that reinforces the main action. A success icon that animates in alongside a confirmation message.

**9. Timing** — the duration of an action communicates its weight and importance. Fast = light, trivial, immediate. Slow = heavy, important, deliberate.

**10. Exaggeration** — push the pose further than realistic to emphasize the emotion or action. Rare in UI; used in delightful empty states and loading animations for brand personality.

**11. Solid Drawing** — form follows function in 3D. In 2D UI: design elements that look correct in their animated state, not just their start/end.

**12. Appeal** — the animation feels good and engaging. In UI: the hardest to quantify; a function of timing, easing, and choreography combined.

**Designer discussion vocabulary:** "The menu lacks slow-in/slow-out — it moves at constant velocity which reads mechanical. A standard ease-out curve would give it weight." / "The follow-through on the modal is what makes it feel premium — the content settles a beat after the container stops."

## Easing Curves

Easing is the timing function that maps elapsed time to position. The shape of the curve defines the feel of the motion.

**Linear** — constant velocity. Never use for entrance/exit animation. Acceptable for opacity transitions where rate of change is continuous.

**Ease-in** — starts slow, accelerates. Good for: exits (things leaving the screen accelerate away). Feels like something is being launched.

**Ease-out** — starts fast, decelerates. Good for: entrances (things arriving decelerate to a stop). Feels like something is landing.

**Ease-in-out** — slow start, fast middle, slow end. Good for: position changes within the screen (moving something from A to B). The most natural feel for lateral movement.

**Spring** — overshoots the target, oscillates, and settles. Feels physical and alive. Good for: menu opens, panel reveals, interactive elements. Defined by stiffness and damping, not duration.

**Custom bezier curves** — CSS `cubic-bezier(x1, y1, x2, y2)` defines any curve. Tools: [Easings.net](https://easings.net), [cubic-bezier.com](https://cubic-bezier.com).

```css
/* CSS easing reference */
.element {
  /* Built-ins */
  transition: transform 200ms linear;
  transition: transform 200ms ease-in;
  transition: transform 200ms ease-out;
  transition: transform 200ms ease-in-out;

  /* Custom — a satisfying exit ease */
  transition: transform 300ms cubic-bezier(0.55, 0, 1, 0.45);

  /* Custom — a satisfying entrance ease */
  transition: transform 400ms cubic-bezier(0, 0, 0.2, 1);
}
```

## Duration Guidelines

Duration communicates the weight and significance of a change.

| Motion type | Duration | Rationale |
|-------------|---------|-----------|
| Micro-interaction (button press, toggle) | 100–150ms | Must feel immediate |
| UI element appears/disappears | 150–250ms | Fast enough not to wait for |
| Panel/drawer enters | 200–350ms | Spatial reveal needs time to process |
| Modal enters | 200–300ms | Important but not slow |
| Page transition | 200–400ms | Longer than components; full context change |
| Loading animation | ∞ (looping) | Indefinite by definition |
| Success/completion animation | 300–600ms | Worth watching; communicates finality |

**Rule:** The larger the area affected, the longer the acceptable duration. A 16px icon state change at 400ms is agony. A full-screen page transition at 400ms is comfortable.

## Motion as UX Affordance

The most defensible animation explains a spatial or state relationship that would otherwise require user inference.

**Spatial metaphors:**
- **Layering depth:** a modal overlays the page → animation scales up from center (zooms into foreground)
- **Hierarchical navigation:** drill into an item → slide left; back → slide right
- **Drawer:** comes from the side → slides from that side
- **Dropdown:** expands from the trigger → originates at the trigger, not the center

**State communication:**
- **Toggle switch:** thumb slides to match new state → communicates direction of change
- **Checkmark:** draws itself in → confirms the action, not just the state
- **Error shake:** horizontal shake → no (universal gesture for rejection)
- **Loading → success:** spinner morphs into checkmark → continuity confirms completion

**Choreography — when multiple elements animate:**

```typescript
// Staggered list entrance: each item delays by 50ms
// Items appear in sequence, not all at once
function AnimatedList({ items }: { items: string[] }) {
  return (
    <ul>
      {items.map((item, i) => (
        <motion.li
          key={item}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05, duration: 0.2, ease: "easeOut" }}
        >
          {item}
        </motion.li>
      ))}
    </ul>
  );
}
```

## Implementation — CSS Transitions

```css
/* Property-specific transitions: only animate what changes */
.card {
  transition:
    transform 200ms ease-out,
    box-shadow 200ms ease-out;
}
.card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
}

/* Appearance/disappearance with scale + fade */
.tooltip {
  opacity: 0;
  transform: scale(0.95) translateY(4px);
  transition:
    opacity 150ms ease-out,
    transform 150ms ease-out;
  pointer-events: none;
}
.tooltip.visible {
  opacity: 1;
  transform: scale(1) translateY(0);
  pointer-events: auto;
}

/* Performance: only transform and opacity animate on the compositor (no layout) */
/* ✓ Animate: transform, opacity, filter */
/* ✗ Avoid animating: width, height, top, left, margin, padding (causes layout reflow) */
```

## Implementation — Framer Motion (React)

```typescript
import { motion, AnimatePresence } from "framer-motion";

// Entrance + exit with AnimatePresence
function Notification({ show, message }: { show: boolean; message: string }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="notification"
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0,   scale: 1 }}
          exit={{    opacity: 0, y: -10,  scale: 0.95 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="notification"
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Spring physics for interactive elements
<motion.button
  whileHover={{ scale: 1.02 }}
  whileTap={{ scale: 0.97 }}
  transition={{ type: "spring", stiffness: 400, damping: 17 }}
>
  Click me
</motion.button>

// Shared layout animation — animates element between positions
<motion.div layoutId="selected-indicator" />
// Move this element to a new container → Framer Motion animates the transition
```

## Implementation — GSAP (Timeline Animation)

GSAP is the industry standard for complex, sequenced animations — scroll-triggered reveals, SVG path animation, multi-step choreography.

```typescript
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

// Timeline: sequenced, precisely timed
function animateHero() {
  const tl = gsap.timeline({ defaults: { ease: "power2.out" } });

  tl
    .from(".hero-headline", { opacity: 0, y: 30, duration: 0.6 })
    .from(".hero-subhead",  { opacity: 0, y: 20, duration: 0.5 }, "-=0.3") // overlap by 0.3s
    .from(".hero-cta",      { opacity: 0, y: 15, duration: 0.4 }, "-=0.2")
    .from(".hero-image",    { opacity: 0, x: 40, duration: 0.7 }, "-=0.5");
}

// Scroll-triggered reveal
gsap.from(".feature-card", {
  scrollTrigger: {
    trigger: ".features-section",
    start: "top 80%",    // when the trigger's top hits 80% of viewport height
    toggleActions: "play none none none",
  },
  opacity: 0,
  y: 40,
  duration: 0.5,
  stagger: 0.1,  // each card delays by 0.1s
  ease: "power2.out",
});
```

## Prefers-Reduced-Motion

Users with vestibular disorders, photosensitivity, or motion sensitivity can experience nausea, dizziness, or seizures from animation. The `prefers-reduced-motion` media query respects their system preference.

```css
/* CSS: remove all animation for users who prefer reduced motion */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration:   0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration:  0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

```typescript
// React: check preference before animating
const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Framer Motion: disable animations globally when reduced motion preferred
import { MotionConfig } from "framer-motion";

<MotionConfig reducedMotion="user">  {/* Respects system preference automatically */}
  <App />
</MotionConfig>

// GSAP: skip animations for reduced motion users
if (!prefersReduced) {
  animateHero();
}
```

**Reduced-motion alternatives:** Don't just remove animation — provide a static version. A scroll-triggered reveal that disappears becomes immediately visible. A loading spinner that stops still needs to communicate loading state (static indicator or text).

## Checklist

- [ ] Every animation answers "what UX purpose does this serve?" (spatial, state, feedback, attention, delight)
- [ ] Duration appropriate to the element size (micro: 100–150ms, component: 200–350ms, page: 300–400ms)
- [ ] Easing curves: ease-out for entrances, ease-in for exits, ease-in-out for lateral movement, spring for interactive
- [ ] Only `transform` and `opacity` animated (no layout-triggering properties)
- [ ] `AnimatePresence` (Framer) or `display: none` timing managed for exit animations
- [ ] `prefers-reduced-motion` respected — static fallback provided (not just removed)
- [ ] Staggered animations for lists (50ms per item, max 5–7 visible items staggered)
- [ ] No animation looping indefinitely in the background (off-screen content)

## Common mistakes

**Animating layout properties** — `width`, `height`, `top`, `left`, `margin` trigger layout recalculation on every frame. At 60fps, this is 60 style + layout + paint operations per second. Use `transform: scale()` and `transform: translate()` instead — they run on the GPU compositor thread.

**Linear easing on everything** — linear motion looks mechanical because nothing in the physical world moves at constant velocity. Even simple UI transitions benefit from ease-out (arrival) or ease-in-out (crossing).

**Forgetting exit animations** — `AnimatePresence` in Framer Motion, or managing `display: none` timing manually. Without exit animation, elements disappear instantly, breaking the spatial metaphor the entrance animation established.

**Animating while the user is waiting** — a loading animation that's more complex than a spinner delays perceived readiness. The brain interprets visual activity as "still working." Simple spinners are faster-feeling than elaborate animations.

**No `prefers-reduced-motion` support** — a decorative scroll animation for a neurotypical user is a health hazard for a user with vestibular disorder. This is not a nice-to-have; it is an accessibility requirement.
