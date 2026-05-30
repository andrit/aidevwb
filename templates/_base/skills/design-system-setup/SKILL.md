---
name: design-system-setup
description: Build a design system — token hierarchy (global → semantic → component), CSS custom properties, component library strategy (build vs buy), Storybook integration, and token documentation
domain: design
type: cross-cutting
triggers:
  - "design system"
  - "design tokens"
  - "component library"
  - "Storybook"
  - "token hierarchy"
  - "CSS variables system"
  - "design system setup"
  - "shadcn"
  - "Radix UI"
  - "build vs buy components"
---

# Design System Setup

## When to use

When a UI project grows beyond a few components and visual consistency becomes a maintenance problem, or when starting a project where multiple surfaces will share the same design language. A design system is the contract between design and engineering: design writes tokens, engineering implements components, both reference the same source of truth.

## Prerequisites

- `color-theory-and-systems` complete — base and semantic color tokens ready
- `typography-system` complete — type scale and font tokens ready
- `layout-and-composition` complete — spacing scale tokens ready
- Component library strategy decision (see Step 1)

## Token Hierarchy

Design tokens have three layers. Each layer is more specific than the one above it. Components consume the lowest appropriate layer.

```
Global tokens (raw values)
  └── Semantic tokens (intent-named, reference global tokens)
        └── Component tokens (component-specific, reference semantic tokens)
```

**Global tokens** — the complete vocabulary of possible values. Named for what they are.

```css
/* Global: color */
--blue-500: #3b82f6;
--blue-600: #2563eb;

/* Global: size */
--size-4: 16px;
--size-6: 24px;

/* Global: font-weight */
--weight-normal: 400;
--weight-semibold: 600;
```

**Semantic tokens** — named for what they *mean*. Components reference only semantic tokens.

```css
/* Semantic: color intent */
--color-primary: var(--blue-600);
--color-text: var(--neutral-900);
--color-surface: #ffffff;
--color-border: var(--neutral-200);
--color-danger: var(--red-600);

/* Semantic: spacing intent */
--space-component-sm: var(--size-2);   /* 8px */
--space-component-md: var(--size-4);   /* 16px */
--space-component-lg: var(--size-6);   /* 24px */
--space-section: var(--size-16);       /* 64px */

/* Semantic: typography intent */
--text-body: var(--text-base);          /* 16px */
--text-heading: var(--text-2xl);        /* 30px */
--font-body: var(--font-sans);
--font-mono: var(--font-mono);
```

**Component tokens** — component-specific aliases. Use when a component has styling properties that semantically differ from the global intent, or when components need to be individually themeable.

```css
/* Button component tokens */
--btn-primary-bg:      var(--color-primary);
--btn-primary-text:    var(--color-text-inverse);
--btn-primary-border:  transparent;
--btn-primary-hover-bg: var(--color-primary-hover);
--btn-radius:          var(--radius-md);
--btn-height-md:       var(--size-10);   /* 40px */
--btn-padding-md:      0 var(--space-component-lg);
```

## Step 1 — Component Library Strategy

**The fundamental choice: build, buy (headless), or buy (styled).**

| Option | Examples | When to use |
|--------|---------|-------------|
| **Styled library** | Ant Design, Chakra UI, MUI | Rapid internal tooling; brand doesn't matter; accept the library's visual constraints |
| **Headless library** | Radix UI, Headless UI, Ariakit | Custom design that requires accessibility primitives; don't want to fight another library's styles |
| **shadcn/ui** | shadcn/ui | Headless (Radix) primitives + pre-styled components you own in your codebase (not a dependency) |
| **Build from scratch** | — | Highly specialized interaction patterns or design that can't be adapted from any library; very expensive |

**Recommendation for most projects:** shadcn/ui with Radix primitives. You own the component code, can style freely, get accessibility for free (Radix handles ARIA, keyboard navigation, focus management), and can adopt components incrementally.

## Step 2 — Install and Configure

```bash
# shadcn/ui setup (Vite + React + TypeScript)
npx shadcn@latest init

# Choose: TypeScript, CSS Variables for colors, components.json at root
# This creates: components.json, src/lib/utils.ts (cn() helper), CSS variables in globals.css

# Add individual components as needed:
npx shadcn@latest add button
npx shadcn@latest add input
npx shadcn@latest add dialog
```

```typescript
// src/lib/utils.ts — tailwind class merging utility (created by shadcn init)
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

**Extend with your tokens** — shadcn/ui generates CSS variables you can override:

```css
/* globals.css — override shadcn's default tokens with your design system */
:root {
  --background:   0 0% 100%;        /* HSL for Tailwind compatibility */
  --foreground:   222.2 84% 4.9%;
  --primary:      221.2 83.2% 53.3%;
  --primary-foreground: 210 40% 98%;
  --destructive:  0 84.2% 60.2%;

  --radius: 0.5rem;  /* Base border radius; components use this */
}
```

## Step 3 — Storybook Integration

Storybook is the living documentation and development environment for the design system. Every component gets a Story.

```bash
npx storybook@latest init
npm run storybook  # http://localhost:6006
```

```typescript
// src/stories/Button.stories.tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "@/components/ui/button";

const meta: Meta<typeof Button> = {
  title: "Design System/Button",
  component: Button,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component: "Primary interaction element. Follows Radix Slot pattern — use `asChild` to render as any element.",
      },
    },
  },
  argTypes: {
    variant: { control: "select", options: ["default", "secondary", "outline", "ghost", "destructive", "link"] },
    size:    { control: "select", options: ["default", "sm", "lg", "icon"] },
    disabled: { control: "boolean" },
  },
};
export default meta;
type Story = StoryObj<typeof Button>;

export const Default: Story = {
  args: { children: "Button", variant: "default", size: "default" },
};

export const Destructive: Story = {
  args: { children: "Delete account", variant: "destructive" },
};

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
      {(["default", "secondary", "outline", "ghost", "destructive", "link"] as const).map((v) => (
        <Button key={v} variant={v}>{v}</Button>
      ))}
    </div>
  ),
};
```

**Storybook add-ons for a design system:**
```bash
npm install -D @storybook/addon-a11y         # Accessibility panel — runs axe on every story
npm install -D @storybook/addon-themes       # Theme switching (light/dark mode testing)
npm install -D @storybook/addon-measure      # Visualize spacing/layout
npm install -D @chromatic-com/storybook      # Visual regression testing via Chromatic
```

## Step 4 — Token Documentation

Document the token layer for both designers (who use Figma variables) and engineers (who use CSS variables). The source of truth must be one file, not split between Figma and code.

```typescript
// src/design-system/tokens.ts — canonical token registry (TypeScript-first)
export const tokens = {
  color: {
    primary:     "hsl(221.2, 83.2%, 53.3%)",
    text:        "hsl(222.2, 84%, 4.9%)",
    surface:     "hsl(0, 0%, 100%)",
    danger:      "hsl(0, 84.2%, 60.2%)",
  },
  spacing: {
    componentSm: "8px",
    componentMd: "16px",
    componentLg: "24px",
    section:     "64px",
  },
  radius: {
    sm:  "4px",
    md:  "6px",
    lg:  "8px",
    full: "9999px",
  },
} as const;

// Exported as CSS custom property names for use in style guides
export type ColorToken = keyof typeof tokens.color;
```

**Figma Variables sync:** Use [Token Studio](https://tokens.studio/) Figma plugin to sync Figma variables to `tokens.json`. Then run `style-dictionary` to generate CSS from `tokens.json`. Design and engineering share one source file.

```bash
npm install -D style-dictionary
```

```js
// style-dictionary.config.js
module.exports = {
  source: ["tokens.json"],
  platforms: {
    css: {
      transformGroup: "css",
      prefix: "ds",
      buildPath: "src/",
      files: [{ destination: "design-system/tokens.css", format: "css/variables" }],
    },
  },
};
```

## Checklist

- [ ] Token hierarchy established: global → semantic → component
- [ ] No hex codes or raw values in component files — only semantic tokens
- [ ] Component library strategy chosen and documented (build/headless/styled)
- [ ] `cn()` utility available for conditional class merging
- [ ] Storybook running with all base components documented
- [ ] `@storybook/addon-a11y` installed — accessibility checked on every story
- [ ] Dark mode: semantic token overrides in `prefers-color-scheme` media query
- [ ] Token documentation shared with designer (Figma variables or Token Studio sync)

## Files involved

| File | Action |
|------|--------|
| `src/design-system/tokens.css` | Create: CSS custom properties, all three token layers |
| `src/design-system/tokens.ts` | Create: TypeScript token registry |
| `src/lib/utils.ts` | Create/update: `cn()` helper |
| `src/components/ui/` | Create: shadcn components (owned, not a dependency) |
| `src/stories/*.stories.tsx` | Create: one story file per component |
| `.storybook/main.ts` | Update: add accessibility, theme, measure add-ons |
| `style-dictionary.config.js` | Create: if using Token Studio sync |

## Common mistakes

**Semantic tokens that are too specific** — `--btn-default-background-color` is a component token, not semantic. Semantic tokens describe intent: `--color-primary`. Component tokens (optional) can be specific but should only exist when a component genuinely needs to differ from the semantic layer.

**Design tokens in Figma that don't match CSS** — the Figma designer uses "Primary/500" but the CSS uses `--color-primary`. They're the same color but different names create confusion in handoff. Align naming between Figma and CSS before component work begins.

**Storybook as afterthought** — stories written after components are finished are harder to write because the component was designed without story-first in mind. Write the story (or at least the interface) first; it's the clearest way to think about component API.

**One story per component showing one state** — the value of Storybook is seeing all variants, states, and edge cases. A Button with one story for the default state misses: disabled, loading, icon-only, all variants, all sizes, destructive, with tooltip. Write stories for every meaningful variant.
