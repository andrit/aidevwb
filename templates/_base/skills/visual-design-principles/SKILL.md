---
name: visual-design-principles
description: Core visual design theory — Gestalt, hierarchy, contrast, affordances, balance, rule of thirds — optimized for informed discussion with a professional designer and applied to UI decisions
domain: design
type: cross-cutting
triggers:
  - "visual design"
  - "design principles"
  - "Gestalt"
  - "visual hierarchy"
  - "affordances"
  - "rule of thirds"
  - "balance in design"
  - "design review"
  - "design feedback"
---

# Visual Design Principles

## When to use

Before any UI design review, when discussing layout or visual decisions with a designer, or when making UI decisions without a designer present. This skill is theory-first — it gives you the vocabulary and frameworks to participate in design discussions as a peer rather than a consumer, and to make defensible UI decisions when designing alone.

## The Fundamental Goal of Visual Design

Visual design communicates before the user reads a word. The goal is to create a visual hierarchy that guides the eye, communicates structure, and makes the intended action obvious — all within milliseconds of the user's first glance.

## Gestalt Principles

Gestalt psychology (German: "shape" or "form") describes how humans perceive visual elements as unified wholes rather than collections of parts. These are the hidden grammar of layout.

**Proximity** — elements close together are perceived as related. The most powerful grouping force. Whitespace between groups creates visual separation stronger than lines or borders.

**Similarity** — elements that share visual properties (color, shape, size, texture) are perceived as belonging together. The basis of all visual coding systems.

**Continuation** — the eye follows lines, curves, and alignments. A row of icons implies continuation even with gaps. Misaligned elements break the flow and feel like errors.

**Closure** — the mind completes incomplete shapes. Dashed borders, partial outlines, and negative-space logos exploit this. The mind prefers completion over ambiguity.

**Figure/Ground** — every visual field has a figure (foreground object of attention) and ground (background). When figure and ground are ambiguous (like the Rubin vase), the design is failing — one must dominate clearly.

**Common Fate** — elements moving in the same direction are perceived as related. The basis of animation as a grouping tool. Items animating together belong together.

**Symmetry and Order** — the mind prefers symmetry. Asymmetric layouts work but require compensation (visual weight on the heavier side) to feel balanced rather than broken.

**Designer discussion vocabulary:** "The proximity here is fighting the similarity — these two groups share color (similarity) but their spacing says they're one group." / "We need stronger figure/ground contrast — the CTA is dissolving into the background."

## Visual Hierarchy

Hierarchy controls what the eye reads first, second, and third. A design without hierarchy forces the user to decide what matters — which is cognitive work you're making them do.

**The six levers of hierarchy (in rough order of power):**
1. **Size** — larger = more important. The most primitive and universal hierarchy signal.
2. **Color/Value** — saturated or high-contrast elements attract before muted ones. Dark on light reads before light on light.
3. **Weight** — bold text reads before regular weight. Used for heading → subheading → body sequences.
4. **Position** — top-left reads first in LTR cultures (F-pattern). Center commands attention. Bottom-right reads last.
5. **Texture/Detail** — visually complex areas attract the eye (even when they shouldn't — watch for accidental complexity).
6. **Whitespace** — isolation amplifies importance. An element with generous whitespace reads as more important than a cluttered equivalent.

**The 3-second test:** Cover the screen and uncover it — what's the first thing your eye lands on? That's your visual hierarchy level 1. Is it what you intended?

**Designer discussion vocabulary:** "The hierarchy is inverted here — the secondary action is the same size as the primary CTA." / "Isolating this element would lift its hierarchy without changing its size."

## Contrast and Emphasis

Every effective design has one thing with the most contrast, and everything else has less. Contrast creates the entry point.

**Types of contrast:**
- **Value contrast** — light vs dark. The most legible form.
- **Color contrast** — hue against hue (see `color-theory-and-systems` for WCAG requirements).
- **Size contrast** — large vs small.
- **Shape contrast** — geometric vs organic, round vs sharp.
- **Texture contrast** — smooth vs rough, dense vs sparse.
- **Type contrast** — bold/light, serif/sans-serif weight pairings.

**The law of emphasis:** If everything is emphasized, nothing is. Adding a third "highlighted" element neutralizes all three.

## Affordances and Signifiers

Don Norman's framework from *The Design of Everyday Things* (see `docs/references.md`):

**Affordance** (Gibson, extended by Norman) — a relationship between an object's properties and an agent's capabilities. A flat surface affords standing on; a handle affords pulling. Affordances are real, not perceived.

**Signifier** — a signal that communicates where and how an action can be taken. A button's raised shadow signals "press me." Underlined text signals "click me." Signifiers are perceived — they are the communication of affordance.

**Mapping** — the relationship between control and effect. A light switch immediately above the light it controls has good mapping. A panel of identical switches for a row of lights has poor mapping.

**Feedback** — the system's response to action. A button that changes color on press provides feedback; a button that responds 3 seconds later with no visual change provides none.

**Discoverability** — can users figure out what actions are possible? Hidden menus fail discoverability. Visible affordances aid it.

**Designer discussion vocabulary:** "The signifier is missing — users can't tell this is interactive because it looks identical to static text." / "The mapping is reversed — the left control moves the right element." / "We've prioritized discoverability over cleanliness here; let's pressure-test whether the affordances are strong enough."

## Balance and Composition

**Symmetrical balance** — identical or mirrored weight on both sides of an axis. Feels stable, formal, trustworthy. Common in corporate, financial, institutional designs.

**Asymmetrical balance** — different elements with equal visual weight. Feels dynamic, modern, interesting. Requires one heavy element offset by multiple lighter ones, or a large light element offset by a small dark one.

**Radial balance** — elements arranged around a center point. Unusual in UI; common in logos, icons, loading indicators.

**Visual weight** factors: size, density, color saturation, isolation, position (elements near the center or top feel heavier), texture.

**Rule of thirds** — divide the canvas into a 3×3 grid; place focal points at the four intersections (the "power points"). Content placed on intersections feels naturally composed. Content centered within a cell feels static; content crossing a grid line feels dynamic.

**Golden ratio (φ ≈ 1.618)** — the ratio that appears repeatedly in nature and is perceived as aesthetically pleasing. A golden rectangle has sides in ratio 1:1.618. Used in logo design, layout proportioning, and typography scale (1.618 type scale). More of a sensibility than a precise rule in UI.

**Designer discussion vocabulary:** "The composition is bottom-heavy — the visual weight is pooling below the fold." / "Try the rule of thirds: pull the hero image to the right intersection and let the headline breathe into the left third." / "The symmetrical layout signals authority but loses the dynamism the brand brief asked for."

## Whitespace (Negative Space)

Whitespace is not empty space — it is an active design element. It:
- Groups related elements (proximity)
- Separates unrelated elements
- Amplifies the importance of what it surrounds
- Creates visual rhythm
- Communicates quality and confidence (luxury brands use extreme whitespace)

**Micro whitespace** — space between letters (tracking), lines (leading), list items. Controls readability.

**Macro whitespace** — space between sections, blocks, and layout regions. Controls comprehension.

**Designer discussion vocabulary:** "The design feels cluttered not because there's too much content but because the micro whitespace is collapsed — there's no breathing room between elements." / "Expanding the macro whitespace here would signal that these sections are distinct concepts."

## Implementation — Applying These Principles

```typescript
// Visual hierarchy in component props — encode hierarchy decisions explicitly
type CardVariant = "primary" | "secondary" | "tertiary";

// Hierarchy in CSS — one dominant element, everything else subordinate
// ✗ Every section header the same weight
// ✓ Clear size/weight progression
.heading-1 { font-size: 2.5rem; font-weight: 700; }
.heading-2 { font-size: 1.75rem; font-weight: 600; }
.heading-3 { font-size: 1.25rem; font-weight: 600; }
.body      { font-size: 1rem;    font-weight: 400; }
.caption   { font-size: 0.875rem; font-weight: 400; color: var(--color-text-secondary); }

// Signifiers — make interactive elements unambiguous
// ✗ Static-looking text that happens to be a link
// ✓ Consistent signifier vocabulary
a          { color: var(--color-primary); text-decoration: underline; }
button     { cursor: pointer; /* + border, background, or shadow to signal affordance */ }
[role="button"] { cursor: pointer; }

// Contrast — one dominant CTA, everything else subordinate
.btn-primary   { background: var(--color-primary); color: white; }
.btn-secondary { background: transparent; border: 1px solid var(--color-primary); }
.btn-ghost     { background: transparent; color: var(--color-text); }
```

## Checklist

- [ ] 3-second test passed: eye lands on intended level-1 element first
- [ ] Only one element at maximum contrast — the primary CTA or focal point
- [ ] Related elements use proximity, not just color, to signal grouping
- [ ] Every interactive element has a clear signifier (not just hover state)
- [ ] Figure/ground contrast is unambiguous — no visual ambiguity about what's foreground
- [ ] Whitespace is intentional: micro (readability) and macro (section separation) both considered
- [ ] Hierarchy uses at least 2 different levers (not just size OR color alone)

## Common mistakes

**Competing for hierarchy** — multiple elements at the same size, weight, and color. The eye has no entry point and scans randomly. Assign exactly one element the "most important" visual treatment.

**Treating whitespace as wasted space** — a designer will resist "cramming more in." Whitespace is budget for emphasis. Spending it on density removes the budget for importance.

**Affordances without signifiers** — building interactive elements that only reveal their interactivity on hover. Mobile users have no hover state; discoverability requires persistent, visible signifiers.

**Gestalt betrayal** — placing unrelated elements close together (proximity grouping) while styling related elements differently (similarity contradiction). Choose one grouping mechanism and apply it consistently.
