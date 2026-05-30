---
name: color-theory-and-systems
description: Color theory — models, harmonies, psychology, temperature, WCAG contrast — and building a production color system with semantic tokens; optimized for designer discussion and implementation
domain: design
type: cross-cutting
triggers:
  - "color theory"
  - "color system"
  - "color palette"
  - "color harmony"
  - "color psychology"
  - "WCAG contrast"
  - "semantic color tokens"
  - "color accessible"
  - "choosing colors"
---

# Color Theory and Systems

## When to use

When choosing colors for a project, reviewing a designer's palette, building a design system's color layer, or discussing color decisions with a designer. Theory sections give you vocabulary for the discussion; implementation sections give you the CSS and token structure.

## Color Models

**RGB** (Red, Green, Blue) — additive color model for screens. All three at max = white; all at zero = black. Values 0–255 per channel. The browser's native model.

**HSL** (Hue, Saturation, Lightness) — the designer-friendly model. Hue is the color's angle on the wheel (0°=red, 120°=green, 240°=blue). Saturation is the intensity (0%=gray, 100%=vivid). Lightness is the brightness (0%=black, 100%=white). Preferred for building color scales because you can vary one dimension at a time.

**HSB/HSV** (Hue, Saturation, Brightness/Value) — similar to HSL but Brightness=100 + Saturation=100 = the purest hue (not white). Used in Figma and most design tools. Confusingly different from HSL — a color at HSB Brightness=100 is NOT HSL Lightness=100.

**CMYK** (Cyan, Magenta, Yellow, Key/Black) — subtractive model for print. Irrelevant to screen design except when a brand has defined CMYK swatches that need a screen equivalent.

**Designer discussion vocabulary:** "Can you share the HSL values? The hex doesn't tell me the relationship between these colors." / "The Figma file is in HSB — let me convert to HSL for the CSS variables."

## The Color Wheel and Relationships

The traditional color wheel (RYB: red, yellow, blue) is used in art education. Digital design uses the RGB/HSL wheel. Understanding the positions enables principled color selection.

**Primary (RGB):** Red (0°), Green (120°), Blue (240°)  
**Secondary:** Yellow (60°), Cyan (180°), Magenta (300°)  
**Tertiary:** every 30° between primary and secondary

**Color harmonies** — combinations that feel visually cohesive:

| Harmony | Structure | Character |
|---------|-----------|-----------|
| **Monochromatic** | One hue, varying saturation and lightness | Cohesive, minimal, elegant |
| **Analogous** | 2–4 adjacent hues (within 30–60°) | Natural, comfortable, low-contrast |
| **Complementary** | Two hues 180° apart | High contrast, energetic, can feel harsh |
| **Split-complementary** | A hue + two colors 150° from its complement | High contrast, more balanced than complementary |
| **Triadic** | Three hues 120° apart | Vibrant, balanced, complex |
| **Tetradic/Square** | Four hues 90° apart | Very complex, needs one dominant color |

**In practice:** most UI color systems use analogous or complementary structures for their primary-accent relationship, then add semantic colors (danger red, success green) outside the harmony. The harmony informs brand colors; semantic colors follow convention.

**Designer discussion vocabulary:** "The primary and accent are split-complementary — they'll create energy without clashing. Does that match the brand tone?" / "A triadic system here risks too many competing voices. Would you consider collapsing to analogous with one high-contrast accent?"

## Color Psychology

Color associations are culturally relative, contextually dependent, and have genuine physiological effects. These are tendencies, not rules.

**Red** — urgency, danger, passion, appetite (food brands). Error states, destructive actions, sale badges. High physiological arousal.

**Orange** — warmth, enthusiasm, affordability, creativity. Often used for CTAs where red feels too alarming. Caution states.

**Yellow** — attention, warning, optimism, caution. High visibility (construction, hazard). Warning states. Can feel anxiety-inducing in large areas.

**Green** — success, safety, nature, growth, health, money (Western). Confirmation states, success banners, financial services.

**Blue** — trust, stability, authority, technology, coolness. The most universally liked color. Default for links, banking, healthcare, B2B SaaS.

**Purple** — luxury, creativity, mystery, royalty. Premium features, creative tools.

**Black** — sophistication, luxury, power, formality. Dark mode, premium, fashion, high-end.

**White** — cleanliness, simplicity, space, clinical. Negative space dominant designs.

**Cultural notes:** White = mourning in some East Asian cultures; green = luck (Western) but death (some Middle Eastern contexts); red = good luck in China. Always validate cultural assumptions with target market research.

**Designer discussion vocabulary:** "Blue is doing a lot of trust-signaling work here, which fits the fintech context. Is there a risk it's reading as cold rather than trustworthy?" / "The success state green is analogous to the brand green — is that intentional, or will they bleed together in the UI?"

## Color Temperature

**Warm colors** (reds, oranges, yellows) — advance visually (appear closer), energize, attract attention. Overuse causes visual fatigue.

**Cool colors** (blues, greens, purples) — recede visually (appear further away), calm, feel more trustworthy. Safe for large background areas.

**Neutral colors** (grays, tans, whites) — carry the temperature of their undertone. A "gray" with a blue undertone reads cool; one with a yellow undertone reads warm.

**Mixing temperature in a system:** background in cool neutral → content in neutral → accents in warm (CTAs attract) is a common effective pattern. It gives the interface a calm, stable feeling with energetic entry points.

**Designer discussion vocabulary:** "The warm neutral (tan undertone) is fighting the cool brand blue. The interface feels inconsistent in temperature." / "Pushing the CTA to a warm orange would make it advance against the cool background rather than competing with it."

## WCAG Contrast Requirements

Contrast ratio is calculated between the luminance of two colors. The formula is deterministic — use a tool (browser DevTools color picker, Figma plugins, `axe`).

| Content | Minimum (AA) | Enhanced (AAA) |
|---------|-------------|----------------|
| Normal text (< 18pt regular, < 14pt bold) | 4.5:1 | 7:1 |
| Large text (≥ 18pt regular, ≥ 14pt bold) | 3:1 | 4.5:1 |
| UI components (borders, icons, form inputs) | 3:1 | — |
| Decorative elements, logos | None | None |

**AA is the legal and professional standard.** AAA is aspirational and often impractical for colored text.

**The contrast trap:** A color that passes contrast on a white background fails on a light gray background. Check every combination in context, not just against white.

**Designer discussion vocabulary:** "The secondary text color needs to hit 4.5:1 on all its backgrounds — it passes on white but fails on the card background. Can we darken it?" / "We should add contrast checks to Storybook so we catch failures before review."

## Building a Color System

A well-structured color system has three layers: base palette → semantic tokens → component tokens.

**Layer 1: Base palette (numeric scale)**
Generate a full range of each hue from 50 (near-white) to 900 (near-black). These are raw values with no meaning attached.

```css
:root {
  /* Base palette: blue scale */
  --blue-50:  #eff6ff;
  --blue-100: #dbeafe;
  --blue-200: #bfdbfe;
  --blue-300: #93c5fd;
  --blue-400: #60a5fa;
  --blue-500: #3b82f6;  /* the "main" blue */
  --blue-600: #2563eb;
  --blue-700: #1d4ed8;
  --blue-800: #1e40af;
  --blue-900: #1e3a8a;

  /* Base palette: neutral scale (with cool undertone) */
  --neutral-50:  #f8fafc;
  --neutral-100: #f1f5f9;
  --neutral-200: #e2e8f0;
  --neutral-300: #cbd5e1;
  --neutral-400: #94a3b8;
  --neutral-500: #64748b;
  --neutral-600: #475569;
  --neutral-700: #334155;
  --neutral-800: #1e293b;
  --neutral-900: #0f172a;
}
```

**Layer 2: Semantic tokens (intent-named)**
Map base palette values to intent. Components consume only semantic tokens, never base palette directly.

```css
:root {
  /* Brand */
  --color-primary:        var(--blue-600);
  --color-primary-hover:  var(--blue-700);
  --color-primary-light:  var(--blue-50);

  /* Text */
  --color-text:           var(--neutral-900);
  --color-text-secondary: var(--neutral-600);
  --color-text-disabled:  var(--neutral-400);
  --color-text-inverse:   #ffffff;

  /* Surfaces */
  --color-surface:        #ffffff;
  --color-surface-raised: var(--neutral-50);
  --color-surface-sunken: var(--neutral-100);

  /* Borders */
  --color-border:         var(--neutral-200);
  --color-border-strong:  var(--neutral-400);

  /* Semantic states */
  --color-success:        #16a34a;  /* green-600 */
  --color-warning:        #d97706;  /* amber-600 */
  --color-danger:         #dc2626;  /* red-600 */
  --color-info:           var(--blue-600);
}
```

**Dark mode:** swap semantic token values, not component references. Components that use `--color-text` automatically switch when the semantic token is overridden for dark mode.

```css
@media (prefers-color-scheme: dark) {
  :root {
    --color-text:           var(--neutral-50);
    --color-text-secondary: var(--neutral-400);
    --color-surface:        var(--neutral-900);
    --color-surface-raised: var(--neutral-800);
    --color-border:         var(--neutral-700);
  }
}
```

## Checklist

- [ ] Base palette defined: at least primary hue + neutral, 9-step scale each
- [ ] Semantic tokens mapped: text (primary/secondary/disabled/inverse), surface (base/raised/sunken), border, states (success/warning/danger)
- [ ] Contrast ratios verified: text on all backgrounds ≥ 4.5:1 (AA), UI components ≥ 3:1
- [ ] No component references base palette directly — only semantic tokens
- [ ] Dark mode: semantic tokens override handles it; no component changes needed
- [ ] Color psychology consistent with brand brief and target audience culture
- [ ] Color temperature internally consistent (all neutrals same undertone)

## Common mistakes

**Using hex codes in components** — `color: #2563eb` in a component means dark mode is impossible and rebrand is a search-and-replace across 400 files. Use semantic tokens from day one.

**Generating a scale with equal HSL lightness steps** — a perceptually uniform scale requires non-equal lightness steps because human perception of lightness is non-linear (the HSL model is not perceptually uniform). Use tools like Radix Colors, Tailwind, or Palette by Coolors that compensate for this.

**Semantic tokens that are too specific** — `--color-button-primary-background` is a component token, not a semantic token. Semantic tokens describe intent (`--color-primary`), not location. Component tokens (in a design system's component layer) can be more specific, but don't create them prematurely.

**Assuming contrast passes on all backgrounds** — verify in the actual UI context. The same text color that passes 4.5:1 on white can fail on a light card background. Run contrast checks in Storybook with the actual surface colors.
