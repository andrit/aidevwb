---
name: typography-system
description: Typography theory — anatomy, categories, pairing, scale, optical sizing, readability — and building a type system with fluid scale; for designer discussion and implementation
domain: design
type: cross-cutting
triggers:
  - "typography"
  - "type system"
  - "font pairing"
  - "type scale"
  - "font selection"
  - "readability"
  - "leading"
  - "tracking"
  - "fluid typography"
  - "choosing fonts"
---

# Typography System

## When to use

When selecting typefaces, building a type scale, reviewing a designer's typographic choices, or discussing readability issues. Typography is the most time-consuming design decision to undo — a font embedded in a codebase affects every text element. Getting it right (or at least defensible) before implementation matters.

## Type Anatomy

Understanding anatomy lets you discuss fonts precisely with a designer.

**Baseline** — the invisible line that capital letters sit on. The reference point for all vertical measurements.

**Cap height** — the height of a capital letter from baseline to top. Varies across fonts even at the same `font-size` (see: x-height).

**X-height** — the height of a lowercase "x." High x-height fonts (like Roboto, Inter) feel larger at the same `font-size` and are more readable at small sizes. Low x-height fonts (like Garamond) feel elegant but can become illegible at small sizes.

**Ascender** — the part of lowercase letters that rises above the x-height (b, d, f, h, k, l, t).

**Descender** — the part of lowercase letters that drops below the baseline (g, j, p, q, y).

**Serif** — the small strokes finishing the main strokes of letters. The horizontal feet on letters like "I" in Times New Roman. The detail that aids letter recognition at small sizes in print (contested for screens — see below).

**Stem** — the main vertical stroke of a letter.

**Counter** — the enclosed or partially enclosed space within a letter (the hole in "o," the bowl of "d").

**Designer discussion vocabulary:** "The x-height on this sans-serif is high — it'll read larger than the cap height suggests. We may need to go one step smaller in the scale than expected." / "The ascenders are clipped — the line-height is too tight for this typeface."

## Typeface Categories

**Serif** — have finishing strokes. Subcategories:
- *Old Style* (Garamond, Palatino) — angled stress, low contrast, organic. Traditional, literary, academic.
- *Transitional* (Times New Roman, Baskerville) — more vertical stress, higher contrast. Classic editorial.
- *Modern/Didone* (Bodoni, Didot) — very high contrast, hairline serifs. Fashion, luxury, high drama.
- *Slab/Egyptian* (Rockwell, Clarendon) — thick, block-like serifs. Bold, industrial, approachable.

**Sans-serif** — no finishing strokes. Subcategories:
- *Grotesque* (Helvetica, Franklin Gothic) — humanist irregularities, feels neutral. Swiss design, modernist.
- *Humanist* (Gill Sans, Frutiger) — based on calligraphic proportions, most readable sans-serif for long text.
- *Geometric* (Futura, Circular, Avenir) — based on geometric shapes. Modern, technical, clean. Inter and the Google UI fonts are geometric-influenced humanists.
- *Neo-grotesque* (Univers, Neue Haas Grotesk) — more uniform, mechanical. Very clean, system-like.

**Monospace** — all characters same width. Code, terminals, tabular data. Never for body copy.

**Display** — designed for large sizes only. Decorative details that add character at 48px+ become mud at 16px. Headlines only.

**Script/Cursive** — simulate handwriting. Logos, occasional accent headlines only. Never for more than 5–6 words at a time.

**Designer discussion vocabulary:** "This geometric sans will look excellent in the dashboard but the humanist quality of a typeface like Inter reads better for long-form content like the documentation section." / "If we're committing to display at this size, the optical adjustments at 12px will need manual override — display fonts don't scale gracefully."

## Font Pairing

The goal is contrast without conflict. The best pairs share a historical connection or are designed by the same foundry.

**Pairing principles:**
1. **Contrast** — combine a serif with a sans-serif, or a humanist sans with a geometric sans. Similar typefaces compete; contrasting ones cooperate.
2. **Shared proportions** — compatible x-heights and weights prevent pairs from feeling out of scale with each other.
3. **Historical relationship** — Garamond + Gill Sans (both humanist tradition, different eras), Georgia + Verdana (both designed for screens), Playfair Display + Source Sans.
4. **Same foundry or superfamily** — Freight Display + Freight Text (Darden), Publico + Atlas Grotesk (Commercial Type). Superfamily pairs are safe by design.
5. **Avoid same category, different brand** — Helvetica + Avenir look too similar to form a clear hierarchy but differ enough to seem inconsistent.

**Common effective pairings:**
- Display: Playfair Display + Body: Source Sans 3 (editorial, magazine)
- Display: Merriweather + Body: Open Sans (content-focused web apps)
- Display/UI: Inter throughout (SaaS, developer tools — the "no pair needed" approach)
- Display: Sohne + Body: Sohne Buch (premium SaaS, modern brand)

**The one-typeface system:** Using a single typeface family with multiple weights and italics (e.g., Inter, Lato) avoids pairing entirely. Appropriate for products where consistent, neutral typography is a feature.

**Designer discussion vocabulary:** "The headline and body don't have enough contrast to create hierarchy — they're too similar in category. Would you consider a serif display for the headers?" / "These two have incompatible x-heights — the body looks outsized against the headline at equivalent weights."

## Type Scale and Hierarchy

**Modular scale** — a mathematical ratio applied to a base size. Every size in the scale is the previous multiplied by the ratio.

| Ratio | Name | Use case |
|-------|------|----------|
| 1.067 | Minor Second | Dense UI, data-heavy |
| 1.125 | Major Second | Compact application UI |
| 1.200 | Minor Third | General web application |
| 1.250 | Major Third | Most UI frameworks (Tailwind) |
| 1.333 | Perfect Fourth | Editorial, landing pages |
| 1.500 | Perfect Fifth | Display-heavy, minimal text |
| 1.618 | Golden Ratio | High-drama, minimal body text |

**A practical type scale (1.25 ratio, base 16px):**

| Token | Size | Use |
|-------|------|-----|
| `--text-xs` | 12px | Legal, captions, metadata |
| `--text-sm` | 14px | Secondary body, UI labels |
| `--text-base` | 16px | Primary body copy |
| `--text-lg` | 20px | Lead paragraphs, feature text |
| `--text-xl` | 24px | H3 / section headings |
| `--text-2xl` | 30px | H2 / page subheadings |
| `--text-3xl` | 36px | H1 / page headings |
| `--text-4xl` | 48px | Display / hero headings |
| `--text-5xl` | 60px | Large display |

## Readability Metrics

**Measure (line length)** — 45–75 characters per line for body text. Below 40: eye jumps too frequently. Above 85: eye loses the next line. Enforced with `max-width` in `ch` units.

```css
.prose { max-width: 65ch; }
```

**Leading (line-height)** — for body text: 1.4–1.6×. For headings: 1.1–1.2× (tight). For very large display: 0.9–1.0× (below the ascender height). Never unitless 1.5 for headings — use `1.1` for H1, `1.4` for body.

**Tracking (letter-spacing)** — body text: -0.01em to +0.01em (near zero). Headings at large sizes: -0.02em to -0.05em (optical adjustment, larger letters need tighter tracking). ALL CAPS: +0.05em to +0.15em (caps need opening up to be readable).

**Optical sizing** — some variable fonts support `font-optical-sizing: auto`, which automatically adjusts weight, contrast, and spacing based on the rendered size. Use it when available.

**Designer discussion vocabulary:** "The measure on the body text is running to 90 characters — that's the primary readability issue, not the typeface choice." / "The heading tracking hasn't been adjusted for this display size — at 72px the tracking needs to come in by about 3–4%."

## Fluid Typography Implementation

Static breakpoint-based type scales jump abruptly. Fluid type scales interpolate continuously.

```css
/* Fluid typography with clamp()
   Formula: clamp(min-size, preferred, max-size)
   preferred = vw units that grow with viewport
*/

:root {
  /* Base: scales from 16px (320px viewport) to 18px (1200px viewport) */
  --text-base: clamp(1rem, 0.875rem + 0.625vw, 1.125rem);

  /* H1: scales from 30px (320px) to 48px (1200px) */
  --text-3xl: clamp(1.875rem, 1.25rem + 3.125vw, 3rem);

  /* H2: scales from 24px to 36px */
  --text-2xl: clamp(1.5rem, 1rem + 2.5vw, 2.25rem);
}

body {
  font-size: var(--text-base);
  line-height: 1.5;
}

h1 {
  font-size: var(--text-3xl);
  line-height: 1.1;
  letter-spacing: -0.03em;  /* Optical tracking at display size */
}
```

**Generating the clamp formula:**
```
min-size: size at minimum viewport (e.g., 320px)
max-size: size at maximum viewport (e.g., 1200px)

slope = (max-size - min-size) / (max-vp - min-vp)
intercept = min-size - slope * min-vp

preferred = slope * 100vw + intercept

clamp(min-size, preferred, max-size)
```

Use [Utopia.fyi](https://utopia.fyi) to generate the full scale automatically.

## Loading Strategy

```html
<!-- Critical: load only the weights you use -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<!-- Specify exact weights; avoid "wght@100..900" which loads the full variable font -->
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

```css
/* For self-hosted fonts — preload the most critical weight */
@font-face {
  font-family: "Inter";
  src: url("/fonts/inter-var.woff2") format("woff2");
  font-display: swap;  /* Show system font until Inter loads; swap immediately */
  font-weight: 100 900;
}
```

## Checklist

- [ ] Typeface category chosen and rationale documented (humanist sans for readability, geometric for precision, etc.)
- [ ] Font pairing creates clear hierarchy contrast (not same-category competition)
- [ ] Type scale uses consistent ratio (1.2–1.333 for most UI)
- [ ] Measure constrained: body text max-width 65–75ch
- [ ] Line-height: body 1.5, headings 1.1–1.2, not "1.5 for everything"
- [ ] Tracking adjusted for large sizes: -0.02em to -0.05em on display headings
- [ ] Only used weights loaded (avoid full variable font range if 3 weights suffice)
- [ ] `font-display: swap` on all `@font-face` declarations

## Common mistakes

**Loading all 9 weights of Inter** — each weight is a separate file. Load only the weights you use. The `wght@100..900` syntax for variable fonts loads the entire weight axis.

**Line-height 1.5 on all elements** — 1.5 is correct for body copy. Applied to a 72px heading, it creates a gap between lines larger than the cap height itself. Set heading line-height to 1.0–1.2.

**Not adjusting tracking at display sizes** — optical sizing: as letters get physically larger, their strokes appear relatively thicker. Reducing tracking (letter-spacing) compensates and makes large text feel professional, not amateurish.

**Choosing a typeface purely aesthetically without considering function** — a beautiful high-contrast modern serif (Bodoni style) is illegible for body copy and catastrophic for UI labels. Validate every choice against its rendering size and reading context.
