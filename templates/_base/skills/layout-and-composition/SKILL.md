---
name: layout-and-composition
description: Layout theory — grid systems, reading patterns, visual weight, 8pt spacing, F/Z/layer-cake patterns — and implementation with CSS Grid, named areas, and a spacing scale
domain: design
type: cross-cutting
triggers:
  - "layout"
  - "grid system"
  - "composition"
  - "spacing system"
  - "visual weight"
  - "F pattern"
  - "Z pattern"
  - "8pt grid"
  - "CSS grid layout"
  - "page layout"
---

# Layout and Composition

## When to use

When designing page structure, reviewing a layout with a designer, deciding on spacing scale, or building a grid-based component system. Layout is the skeleton — design details applied to a weak skeleton never recover.

## Grid Systems

A grid constrains placement choices to a set that looks intentional and aligned. The absence of a grid forces every element to be positioned independently, which produces entropy — nothing lines up, every spacing decision is ad hoc.

**12-column grid** — the dominant web grid. Divisible by 2, 3, 4, and 6, giving layouts of 1, 2, 3, 4, 6, or 12 equal columns. The basis of Bootstrap, Material Grid, CSS Grid in most design systems.

**Column anatomy:**
- **Column** — the usable area for content
- **Gutter** — the space between columns (typically 16–32px; often matches the base spacing unit)
- **Margin** — space between the grid and the container edge (typically 16–64px depending on viewport)

**Common layouts in a 12-column grid:**

| Layout | Column spans | Use |
|--------|-------------|-----|
| Full-width | 12/12 | Hero sections, navigation |
| Two-thirds + sidebar | 8 + 4 | Content + related content |
| Half and half | 6 + 6 | Feature comparisons, split views |
| Three-column | 4 + 4 + 4 | Card grids, feature lists |
| Centered narrow | 6/12, offset 3 | Long-form reading view |
| Centered medium | 8/12, offset 2 | Article with margins |

**Baseline grid** — a horizontal rhythm grid where all text sits on consistent vertical intervals (commonly 4px or 8px). More relevant in print; in web, achieved by consistent line-height multiples rather than hard baseline snapping. "Baseline grid" in designer conversation usually means "please use consistent vertical rhythm."

**8pt grid** — all spacing and sizing values are multiples of 8 (or 4 for fine-grained control). Benefits: consistent rhythm, easier cross-component alignment, fewer arbitrary numbers in the codebase.

**Designer discussion vocabulary:** "The sidebar is collapsing to 4 columns below 1024px — should it stack or reduce to a 3/9 split?" / "The gutter is 24px but the card internal padding is 18px — they're not on the same grid unit. Can we normalize to 24?"

## Reading Patterns

Eye-tracking research reveals how users scan content before they read it. These patterns are tendencies in unfamiliar interfaces, not laws — once a user is familiar with a layout, scanning patterns change.

**F-Pattern** — in text-heavy interfaces, users scan horizontally across the top, then a shorter horizontal scan lower, then vertically down the left edge. Implication: put the most important information in the first paragraph (top horizontal), then again early in the second paragraph (second horizontal). The right side of the layout gets little attention.

**Z-Pattern** — in sparse, primarily visual layouts (landing pages, marketing), the eye moves from top-left to top-right, diagonally to bottom-left, then to bottom-right. CTAs placed at the bottom-right capture attention at the end of the scan. Headline → subheading or visual → CTA flows work in Z-pattern.

**Layer Cake Pattern** — in content-heavy pages with headers, users scan horizontally at each heading layer, skipping body text. Implication: subheadings are not supplementary — they are the primary navigation mechanism. Every subheading must stand alone as a decision point: "do I keep reading this section?"

**Gutenberg Diagram** — formal model: top-left (primary optical area), top-right (fallow area), bottom-left (fallow area), bottom-right (terminal area). Primary CTA goes at the terminal area; branding goes at the primary optical area.

**Designer discussion vocabulary:** "The F-pattern predicts this right-side feature block will be ignored on first scan — should we consider moving the social proof above the fold on the left?" / "The Z-pattern works for the homepage hero but the dashboard uses a layer-cake pattern — the subheadings need to carry more hierarchy."

## Visual Weight and Balance

**Visual weight** — how much attention an element commands relative to its neighbors. Heavier elements dominate the composition.

Weight is increased by: larger size, higher saturation, darker value, more visual complexity, isolation from other elements, position near the center, red/warm color, rough texture.

Weight is decreased by: smaller size, lower saturation, lighter value, proximity to other elements, position near edges.

**Achieving balance:**
- A large, light element can balance a small, dark element
- Many small elements can balance one large element
- Empty space on one side can be intentional — but only if the weight difference is deliberate
- An off-center heavy element needs compensating weight on the other side

**Visual tension** — deliberate imbalance creates energy and movement. A photo where the subject is looking off-frame creates tension toward the empty space. Used in fashion, editorial, and product photography — less so in application UI.

**Designer discussion vocabulary:** "The hero image is right-side weighted with the subject looking left — it naturally pulls into the headline. That's the tension working in your favor." / "The layout is bottom-heavy — there's a lot of content below the fold but nothing anchoring the top. The hero section needs more visual weight."

## The 8-Point Spacing System

Using multiples of 8 (or 4 for finer steps) for all margins, padding, gaps, and sizing creates visual rhythm and eliminates arbitrary spacing decisions.

```css
:root {
  /* Spacing scale: multiples of 4 for fine control, 8 for rhythm */
  --space-1:  4px;
  --space-2:  8px;
  --space-3:  12px;
  --space-4:  16px;
  --space-5:  20px;
  --space-6:  24px;
  --space-8:  32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;
  --space-20: 80px;
  --space-24: 96px;
  --space-32: 128px;
}
```

**Semantic spacing tokens** — map numeric values to intent:

```css
:root {
  /* Component internal spacing */
  --space-component-xs: var(--space-2);   /* 8px  — tight: chips, badges */
  --space-component-sm: var(--space-3);   /* 12px — small: compact inputs */
  --space-component-md: var(--space-4);   /* 16px — default: standard inputs, buttons */
  --space-component-lg: var(--space-6);   /* 24px — large: cards, panels */
  --space-component-xl: var(--space-8);   /* 32px — extra large: section padding */

  /* Layout spacing */
  --space-section:      var(--space-16);  /* 64px  — between page sections */
  --space-page-gutter:  var(--space-6);   /* 24px  — page edge margin (mobile) */
  --space-page-gutter-desktop: var(--space-12); /* 48px — page edge margin (desktop) */
}
```

## CSS Grid Implementation

```css
/* 12-column grid container */
.grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: var(--space-6);   /* gutter */
  padding-inline: var(--space-page-gutter);
  max-width: 1280px;
  margin-inline: auto;
}

/* Named layout areas for complex pages */
.page-layout {
  display: grid;
  grid-template-areas:
    "header  header  header"
    "nav     content aside"
    "footer  footer  footer";
  grid-template-columns: 240px 1fr 280px;
  grid-template-rows: auto 1fr auto;
  min-height: 100dvh;
  gap: var(--space-8);
}

.page-header  { grid-area: header; }
.page-nav     { grid-area: nav; }
.page-content { grid-area: content; }
.page-aside   { grid-area: aside; }
.page-footer  { grid-area: footer; }

/* Responsive: stack on small viewports */
@media (max-width: 768px) {
  .page-layout {
    grid-template-areas:
      "header"
      "content"
      "aside"
      "footer";
    grid-template-columns: 1fr;
  }
  .page-nav { display: none; }  /* moved to mobile drawer */
}

/* Common column span utilities */
.col-full    { grid-column: 1 / -1; }
.col-two-thirds { grid-column: span 8; }
.col-half    { grid-column: span 6; }
.col-third   { grid-column: span 4; }
```

## Sidebar: Intrinsic Layouts

CSS Grid and Flexbox enable intrinsic layouts that respond to content rather than breakpoints:

```css
/* Auto-fitting card grid: as many columns as fit, minimum 280px */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-6);
}

/* Sidebar that stacks when sidebar can't fit at 200px minimum */
.with-sidebar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-8);
}
.sidebar { flex-basis: 240px; flex-grow: 1; }
.main    { flex-basis: 0; flex-grow: 999; min-width: 50%; }

/* Stack/switch pattern: horizontal when space allows, vertical when it doesn't */
.cluster {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  align-items: center;
}
```

## Checklist

- [ ] Grid system defined: column count, gutter, margin values
- [ ] Spacing scale documented in design tokens (multiples of 4 or 8)
- [ ] Named layout areas in CSS Grid for complex multi-region layouts
- [ ] Reading pattern considered: primary content placed where eyes go first (F-pattern: top + left; Z-pattern: diagonal)
- [ ] Visual balance checked: no single region dominates unintentionally
- [ ] Intrinsic layouts used where content density varies (auto-fill card grids)
- [ ] Page gutter responsive: smaller on mobile, larger on desktop

## Common mistakes

**Spacing that ignores the grid unit** — `margin: 18px` and `padding: 10px` when the grid unit is 8px. Nothing aligns. Commit to multiples of 4 or 8 for every spacing value without exception.

**Named grid areas without a responsive strategy** — a three-column named area grid that collapses to a single column at mobile needs an explicit `@media` redeclaration of `grid-template-areas`. Without it, the named areas may not collapse gracefully.

**Ignoring the reading pattern for primary content placement** — placing the primary CTA at the top-right in a text-heavy F-pattern layout where the fallow area receives no eye movement. Run eye-tracking or simply follow the heatmap guidelines: left and top for text-heavy; bottom-right terminal area for visual/sparse layouts.

**Using `vw` for spacing without a minimum** — `gap: 3vw` is 9px at 300px viewport and 48px at 1600px. Use `clamp()` or a fixed spacing token instead of pure viewport units.
