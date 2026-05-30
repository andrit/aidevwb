---
name: anim-framer-motion
description: Animate React UIs with Framer Motion — motion components, variants for coordinated animations, AnimatePresence for enter/exit, layout animations, and gesture responses
domain: animation
type: cross-cutting
triggers:
  - "Framer Motion"
  - "motion"
  - "React animation"
  - "AnimatePresence"
  - "layout animation"
  - "variants"
  - "drag gesture"
  - "motion component"
---

# Framer Motion Animation

## When to use

When building React UIs that need smooth, physics-based, or coordinated animations. Framer Motion (now published as the `motion` package) is declarative — you describe the start and end states and it handles the interpolation. Use it for: page transitions, list item enter/exit, drag-and-drop reordering, accordion open/close, shared element transitions, and hover/tap micro-interactions.

For canvas, WebGL, or scroll-linked storytelling where JS drives every frame, prefer GSAP (see `anim-gsap` skill). Framer Motion shines in React component trees.

## Prerequisites

- React 18+ project (Vite, Next.js, Remix, or CRA)
- TypeScript recommended (full type definitions included)

## Installation

```bash
npm install motion
# or the legacy package name (same library):
npm install framer-motion
```

Import from `motion/react` in React projects:

```typescript
import { motion, AnimatePresence, useMotionValue, useSpring } from "motion/react";
```

## Core Patterns

### Basic motion component

Any HTML element gets animation superpowers by prefixing with `motion.`:

```tsx
import { motion } from "motion/react";

// Animate on mount (initial → animate)
export function FadeIn({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

// Animate on hover and tap (micro-interaction)
export function AnimatedButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 400, damping: 17 }}
    >
      {children}
    </motion.button>
  );
}
```

### Variants — coordinated, parent-driven animation

Variants let a parent orchestrate children's animations. The parent sets `animate` to a variant name; children respond to the same name via `variants`.

```tsx
import { motion, Variants } from "motion/react";

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,   // each child starts 100ms after the previous
      delayChildren: 0.2,     // wait 200ms before first child
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 300, damping: 24 },
  },
};

interface CardListProps {
  items: { id: string; title: string }[];
}

export function CardList({ items }: CardListProps) {
  return (
    <motion.ul
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      style={{ listStyle: "none", padding: 0 }}
    >
      {items.map((item) => (
        <motion.li key={item.id} variants={itemVariants}>
          {item.title}
        </motion.li>
      ))}
    </motion.ul>
  );
}
```

### AnimatePresence — enter and exit animations

Elements only animate out if they are wrapped in `AnimatePresence`. The `exit` prop defines the outgoing state.

```tsx
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";

// Toggling a single element
export function ToastNotification({ message }: { message: string | null }) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          key="toast"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.25 }}
          style={{
            position: "fixed",
            top: 16,
            right: 16,
            background: "#1a1a1a",
            color: "#fff",
            padding: "12px 20px",
            borderRadius: 8,
          }}
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Animated list — items enter and exit as the list changes
export function AnimatedList({ items }: { items: { id: string; label: string }[] }) {
  return (
    <AnimatePresence initial={false}>
      {items.map((item) => (
        <motion.div
          key={item.id}                       // key is how AnimatePresence tracks identity
          layout                              // animate reordering when other items exit
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.3 }}
        >
          {item.label}
        </motion.div>
      ))}
    </AnimatePresence>
  );
}
```

### Layout animations — auto-sizing and reordering

Adding `layout` to a motion component causes it to animate any layout change (size, position, flex reorder). Framer Motion uses FLIP under the hood for performance.

```tsx
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";

interface ExpandableCardProps {
  title: string;
  body: string;
}

export function ExpandableCard({ title, body }: ExpandableCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      layout                        // animates width/height changes automatically
      onClick={() => setExpanded(!expanded)}
      style={{
        background: "#f5f5f5",
        borderRadius: 12,
        padding: 20,
        cursor: "pointer",
        overflow: "hidden",
      }}
    >
      <motion.h3 layout="position">{title}</motion.h3>
      <AnimatePresence>
        {expanded && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {body}
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// Shared layout transition — element morphs between two positions in the DOM
// Wrap both locations in <LayoutGroup id="shared"> and give the element the same layoutId
import { LayoutGroup } from "motion/react";

export function SharedLayoutDemo() {
  const [selected, setSelected] = useState<string | null>(null);

  const items = ["Red", "Green", "Blue"];

  return (
    <LayoutGroup id="tabs">
      <div style={{ display: "flex", gap: 8 }}>
        {items.map((item) => (
          <div key={item} onClick={() => setSelected(item)} style={{ position: "relative", padding: "8px 16px" }}>
            {item === selected && (
              <motion.div
                layoutId="tab-indicator"         // same layoutId = shared element across positions
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "#3b82f6",
                  borderRadius: 6,
                  zIndex: -1,
                }}
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              />
            )}
            <span style={{ position: "relative", color: item === selected ? "#fff" : "#111" }}>{item}</span>
          </div>
        ))}
      </div>
    </LayoutGroup>
  );
}
```

### Drag gesture

```tsx
import { useRef } from "react";
import { motion } from "motion/react";

export function DraggableCard({ children }: { children: React.ReactNode }) {
  const constraintsRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={constraintsRef}
      style={{
        width: 400,
        height: 400,
        border: "2px dashed #ccc",
        borderRadius: 12,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <motion.div
        drag
        dragConstraints={constraintsRef}  // constrain drag to parent bounds
        dragElastic={0.1}                 // 0 = rigid, 1 = full rubber band
        dragTransition={{ bounceStiffness: 300, bounceDamping: 20 }}
        whileDrag={{ scale: 1.05, boxShadow: "0 20px 40px rgba(0,0,0,0.2)" }}
        style={{
          width: 100,
          height: 100,
          background: "#3b82f6",
          borderRadius: 12,
          cursor: "grab",
          position: "absolute",
          top: 150,
          left: 150,
        }}
      >
        {children}
      </motion.div>
    </div>
  );
}
```

## Performance Notes

- **Framer Motion animates on the main thread** unless you use `useTransform`/`useMotionValue` with transforms — keep animated values to `transform` and `opacity` to stay on the compositor thread.
- **`layout` prop uses FLIP** (First, Last, Invert, Play) — it reads the DOM before and after the change, then animates using `transform`. This avoids layout thrash but adds a read-write cycle. Do not use `layout` on hundreds of elements simultaneously.
- **`AnimatePresence mode="wait"`** waits for the exit animation to complete before mounting the next element. Use it for page transitions; avoid it in lists where it would block new items from appearing.
- **Reduce motion:** Wrap animations in a check for `prefers-reduced-motion`. Framer Motion respects this automatically when you use the `useReducedMotion` hook.

```tsx
import { useReducedMotion } from "motion/react";

export function AccessibleFade({ children }: { children: React.ReactNode }) {
  const shouldReduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {children}
    </motion.div>
  );
}
```

## Checklist

- [ ] `key` prop set on every `AnimatePresence` child — it is how Framer Motion tracks identity
- [ ] Exit animations defined with `exit` prop on elements inside `AnimatePresence`
- [ ] Layout animations use `layout` prop (not manual width/height CSS transitions)
- [ ] `layoutId` used for shared element transitions instead of duplicating DOM nodes
- [ ] `useReducedMotion` consulted and motion reduced for accessibility
- [ ] Spring transitions used for physical interactions (drag, tap); duration-based for page-level transitions

## Files involved

| File | Action |
|------|--------|
| `src/components/AnimatedList.tsx` | Create: reusable animated list with AnimatePresence |
| `src/components/PageTransition.tsx` | Create: AnimatePresence page transition wrapper |
| `src/lib/variants.ts` | Create: shared variant definitions (containerVariants, itemVariants) |

## Common mistakes

**Missing `key` on AnimatePresence children** — without a stable `key`, Framer Motion cannot detect when an element is a new mount vs an update. The exit animation never fires, and enter animations retrigger on re-renders. Always give every direct child of `AnimatePresence` a unique, stable `key`.

**Animating `height: "auto"` without `layout`** — `height: "auto"` as an animate target does not work in plain CSS transitions and is unreliable without `layout`. For expand/collapse, use the `layout` prop on the container and `AnimatePresence` on the inner content, or animate `scaleY` with `transform-origin: top`.

**`layoutId` conflicts across page instances** — if two routes both render a component with the same `layoutId`, Framer Motion tries to animate between them. Wrap each route's animated content in a `<LayoutGroup id="unique-per-route">` to namespace layoutIds.

**`AnimatePresence mode="wait"` in lists** — `mode="wait"` makes the exiting element finish before any entering element starts. This creates a visual freeze in lists (all new items wait for one item to exit). Use `mode="sync"` (default) or `mode="popLayout"` for lists.

**Using `motion.div` for everything** — Framer Motion has specific components for custom elements: use `motion.create(MyComponent)` to wrap custom components. Passing `motion` props directly to a non-motion component causes React unknown-prop warnings and the animations are silently ignored.
