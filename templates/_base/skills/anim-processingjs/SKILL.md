---
name: anim-processingjs
description: Build generative and interactive canvas animations with p5.js — setup/draw loop, noise-based particle systems, and React component integration
domain: animation
type: cross-cutting
triggers:
  - "Processing"
  - "p5.js"
  - "generative art"
  - "canvas animation"
  - "creative coding"
  - "particle system"
  - "noise field"
  - "p5 sketch"
---

# p5.js Generative Animation

## When to use

When a project needs generative, algorithmic, or interactive canvas-based visuals — background animations, data visualizations, interactive art, or procedural graphics. p5.js is the modern successor to Processing, running in the browser via `<canvas>`. Use it when the visuals cannot be expressed as CSS/SVG (complex particle systems, noise fields, real-time generative patterns) and when you want Processing's creative-coding conventions in a web context.

For 3D scenes and WebGL, prefer Three.js (see `anim-threejs` skill). For UI element animations, use CSS or Framer Motion.

## Prerequisites

- Any web project (Vanilla, React, Vue, etc.)
- No server-side rendering for the p5 canvas component (p5 requires browser APIs — use dynamic import or `"use client"` in Next.js)

## Installation

```bash
npm install p5
npm install -D @types/p5    # TypeScript types
```

## Core Patterns

### Minimal p5 sketch — setup + draw loop

```javascript
// sketch.js — p5.js in "instance mode" (avoids polluting the global scope)
import p5 from "p5";

const sketch = (p) => {
  let x = 0;

  p.setup = () => {
    // Runs once: create canvas, initialize state
    p.createCanvas(800, 600);
    p.background(20);
    p.noStroke();
  };

  p.draw = () => {
    // Runs at ~60fps: clear, update, draw
    p.background(20, 20, 20, 25);  // semi-transparent bg = trail effect

    p.fill(100, 200, 255);
    p.circle(x, p.height / 2, 40);
    x = (x + 2) % p.width;
  };

  p.mousePressed = () => {
    // Input events
    x = p.mouseX;
  };

  p.keyPressed = () => {
    if (p.key === " ") p.background(20);  // clear on spacebar
  };
};

// Mount the sketch to a DOM element
const container = document.getElementById("canvas-container");
const myP5 = new p5(sketch, container);

// Cleanup when done (e.g., SPA navigation)
// myP5.remove();
```

### Noise-field particle system

Perlin noise creates organic, flowing vector fields that guide particle movement:

```javascript
import p5 from "p5";

const noiseFieldSketch = (p) => {
  const PARTICLE_COUNT = 600;
  const NOISE_SCALE = 0.003;    // smaller = smoother, larger = more turbulent
  const SPEED = 2.5;

  let particles = [];
  let time = 0;

  class Particle {
    constructor() {
      this.reset();
    }

    reset() {
      this.x = p.random(p.width);
      this.y = p.random(p.height);
      this.alpha = p.random(80, 160);
      this.size = p.random(1.5, 4);
    }

    update() {
      // Sample Perlin noise at this position + time offset → angle
      const noiseVal = p.noise(
        this.x * NOISE_SCALE,
        this.y * NOISE_SCALE,
        time * 0.002
      );
      const angle = noiseVal * p.TWO_PI * 2;

      this.x += Math.cos(angle) * SPEED;
      this.y += Math.sin(angle) * SPEED;

      // Wrap or reset when out of bounds
      if (this.x < 0 || this.x > p.width || this.y < 0 || this.y > p.height) {
        this.reset();
      }
    }

    draw() {
      p.fill(160, 200, 255, this.alpha);
      p.noStroke();
      p.circle(this.x, this.y, this.size);
    }
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.background(15, 15, 30);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push(new Particle());
    }
  };

  p.draw = () => {
    p.background(15, 15, 30, 8);  // slow fade — creates trails
    particles.forEach((pt) => {
      pt.update();
      pt.draw();
    });
    time++;
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
    p.background(15, 15, 30);
  };
};

export default noiseFieldSketch;
```

### Interactive mouse-repulsion particle system

```javascript
import p5 from "p5";

const interactiveSketch = (p) => {
  const PARTICLE_COUNT = 300;
  const REPULSION_RADIUS = 100;
  const REPULSION_FORCE = 5;

  let particles = [];

  class Particle {
    constructor() {
      this.pos = p.createVector(p.random(p.width), p.random(p.height));
      this.vel = p.createVector(0, 0);
      this.acc = p.createVector(0, 0);
      this.home = this.pos.copy();  // resting position
      this.color = p.color(p.random(180, 220), p.random(100, 160), 255, 200);
    }

    applyForce(force) {
      this.acc.add(force);
    }

    update() {
      // Spring back to home position
      const spring = p5.Vector.sub(this.home, this.pos);
      spring.mult(0.05);
      this.applyForce(spring);

      // Mouse repulsion
      const mouse = p.createVector(p.mouseX, p.mouseY);
      const distToMouse = p.dist(this.pos.x, this.pos.y, mouse.x, mouse.y);

      if (distToMouse < REPULSION_RADIUS) {
        const repulse = p5.Vector.sub(this.pos, mouse);
        repulse.normalize();
        repulse.mult(REPULSION_FORCE * (1 - distToMouse / REPULSION_RADIUS));
        this.applyForce(repulse);
      }

      this.vel.add(this.acc);
      this.vel.mult(0.9);          // damping
      this.pos.add(this.vel);
      this.acc.mult(0);            // reset acceleration
    }

    draw() {
      p.fill(this.color);
      p.noStroke();
      p.circle(this.pos.x, this.pos.y, 6);
    }
  }

  p.setup = () => {
    p.createCanvas(800, 600);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push(new Particle());
    }
  };

  p.draw = () => {
    p.background(20, 20, 35, 180);
    particles.forEach((pt) => {
      pt.update();
      pt.draw();
    });
  };
};

export default interactiveSketch;
```

### React component wrapping a p5 sketch

```tsx
import { useEffect, useRef } from "react";
import type p5Type from "p5";

type SketchFn = (p: p5Type) => void;

interface P5CanvasProps {
  sketch: SketchFn;
  className?: string;
}

export function P5Canvas({ sketch, className }: P5CanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const p5Ref = useRef<p5Type | null>(null);

  useEffect(() => {
    // Dynamically import p5 to avoid SSR errors (p5 requires window/document)
    let cancelled = false;

    import("p5").then(({ default: P5 }) => {
      if (cancelled || !containerRef.current) return;

      // Create instance-mode sketch mounted to container div
      p5Ref.current = new P5(sketch, containerRef.current);
    });

    return () => {
      cancelled = true;
      if (p5Ref.current) {
        p5Ref.current.remove();  // removes canvas, clears animation loop
        p5Ref.current = null;
      }
    };
  }, [sketch]); // re-create if sketch function reference changes

  return <div ref={containerRef} className={className} />;
}
```

Usage:

```tsx
import { P5Canvas } from "./P5Canvas";
import noiseFieldSketch from "./sketches/noiseField";

export function HeroBackground() {
  return (
    <div style={{ position: "relative", height: "100vh" }}>
      <P5Canvas
        sketch={noiseFieldSketch}
        className="absolute inset-0 w-full h-full"
      />
      <div style={{ position: "relative", zIndex: 1 }}>
        <h1>My App</h1>
      </div>
    </div>
  );
}
```

### Keyboard and mouse interaction reference

```javascript
p.setup = () => { p.createCanvas(600, 400); };

p.draw = () => {
  p.background(30);

  // Mouse position (always available)
  p.fill(255);
  p.circle(p.mouseX, p.mouseY, 30);

  // Is a key held down?
  if (p.keyIsDown(p.LEFT_ARROW)) { /* move left */ }
  if (p.keyIsDown(65)) { /* 'A' key — use key codes for held-down checks */ }
};

// Event callbacks (fire once per event)
p.mousePressed  = () => { /* left click */ };
p.mouseReleased = () => { /* mouse up */ };
p.mouseMoved    = () => { /* cursor moved (no button) */ };
p.mouseDragged  = () => { /* moved with button held */ };
p.keyPressed    = () => { if (p.keyCode === p.ENTER) { /* enter pressed */ } };
p.keyReleased   = () => { /* key released */ };
```

## Performance Notes

- **Target 60fps:** Keep `draw()` under ~16ms. Profile with `p.frameRate()` drawn on canvas — if it drops below 45, reduce particle count or simplify noise calculations.
- **Off-screen graphics buffer:** Use `p.createGraphics(w, h)` for layers that don't need to be redrawn every frame (backgrounds, static layers). Draw to the buffer once, blit to main canvas each frame with `p.image(buffer, 0, 0)`.
- **Avoid creating objects in `draw()`** — `new Particle()`, `p.createVector()`, and `p.createColor()` inside `draw()` run at 60fps and generate heavy garbage. Pre-allocate objects in `setup()` and mutate them.
- **CSS vs canvas:** For static decorative backgrounds, a CSS animated gradient or SVG is far cheaper than a canvas particle system. Use p5 only when the visual genuinely requires per-frame computation.
- **`noLoop()` + `redraw()`** — if the animation only changes on user input (not continuously), call `p.noLoop()` in `setup()` and `p.redraw()` in event handlers. This eliminates the continuous 60fps loop entirely.

## Checklist

- [ ] p5 sketch in instance mode (`(p) => { ... }`) — not global mode — to avoid polluting `window`
- [ ] React: using dynamic `import("p5")` to avoid SSR errors
- [ ] `p5Ref.current.remove()` called in `useEffect` cleanup to stop the animation loop on unmount
- [ ] Objects not allocated inside `draw()` — pre-allocated in `setup()` or particle reset
- [ ] `p.windowResized()` handler resizes canvas for full-bleed layouts
- [ ] `noLoop()` used if animation only needs to respond to events, not run continuously

## Files involved

| File | Action |
|------|--------|
| `src/components/P5Canvas.tsx` | Create: generic React wrapper for p5 sketches |
| `src/sketches/noiseField.ts` | Create: noise particle system sketch |
| `src/sketches/interactive.ts` | Create: mouse-interactive particle sketch |

## Common mistakes

**Global mode in a bundled app** — writing `function setup() {}` and `function draw() {}` at the top level works in CodePen but pollutes `window` in bundled apps and conflicts with other code. Always use instance mode: `const sketch = (p) => { p.setup = ...; p.draw = ...; }`.

**p5 imported at module level in Next.js/SSR** — `import p5 from "p5"` at the top of a file that is server-rendered throws `ReferenceError: window is not defined` because p5 accesses browser APIs on import. Always use dynamic `import("p5")` inside a `useEffect` (or a `"use client"` + `dynamic(() => import(...), { ssr: false })` wrapper in Next.js App Router).

**Not calling `p5Instance.remove()` on cleanup** — the `requestAnimationFrame` loop inside p5 keeps running even after the React component unmounts. Each re-mount adds another loop. Always store the p5 instance and call `.remove()` in the `useEffect` cleanup function.

**`p.createVector()` inside `draw()`** — every call to `p.createVector()` allocates a new object. At 60fps with 300 particles, that is 18,000 allocations per second, causing GC pauses and stuttering. Store vectors on the particle object and use `.set()` or `.add()` to mutate them.

**Using 2D noise for time with `p.noise(x, y)` but no time axis** — `p.noise(x * scale, y * scale)` gives a static field. Without a time component the animation freezes once initialized. Add `time * 0.002` as a third argument to `p.noise()` to make the field evolve.
