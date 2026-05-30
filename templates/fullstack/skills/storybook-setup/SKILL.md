---
name: storybook-setup
description: Install and configure Storybook in a React project, write component stories, and set up essential addons
domain: frontend
type: fullstack
triggers:
  - "set up storybook"
  - "add storybook"
  - "install storybook"
  - "write stories"
  - "component documentation"
  - "component playground"
---

# Storybook Setup

## When to use

When a React project needs a component development environment, visual documentation, or isolated testing of UI components. Activate when the user says "add Storybook", "set up component stories", "I want a component playground", or "document my components".

## Prerequisites

- React project with a `package.json`
- Node.js 18+
- Components already exist (at least one) or are about to be created
- `npm` or `yarn` available

## Steps

### 1. Initialize Storybook

```bash
cd <project-root>
npx storybook@latest init --skip-install
npm install
```

`init` auto-detects the framework (React, Next.js, Vite, etc.) and writes the correct config. Always run `--skip-install` first, inspect `.storybook/`, then `npm install` to avoid lockfile surprises.

### 2. Verify the generated config

Check `.storybook/main.ts` (or `.js`). It should contain:

```ts
// .storybook/main.ts
import type { StorybookConfig } from "@storybook/react-vite"; // or react-webpack5

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(js|jsx|ts|tsx|mdx)"],
  addons: [
    "@storybook/addon-essentials",    // controls, actions, docs, viewport, backgrounds
    "@storybook/addon-a11y",          // accessibility audit panel
    "@storybook/addon-interactions",  // play function testing
  ],
  framework: {
    name: "@storybook/react-vite",    // matches your bundler
    options: {},
  },
};

export default config;
```

If `addon-a11y` and `addon-interactions` are missing, install them:

```bash
npm install --save-dev @storybook/addon-a11y @storybook/addon-interactions
```

### 3. Configure global decorators and parameters

```ts
// .storybook/preview.ts
import type { Preview } from "@storybook/react";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      element: "#storybook-root",
      config: {},
      options: {},
    },
  },
};

export default preview;
```

If the project uses a global CSS file or theme provider, import it here:

```ts
import "../src/index.css";            // global styles
import { ThemeProvider } from "../src/theme";

const preview: Preview = {
  decorators: [
    (Story) => (
      <ThemeProvider>
        <Story />
      </ThemeProvider>
    ),
  ],
  // ...parameters
};
```

### 4. Write stories — file naming and location

Stories live next to the component they document:

```
src/
  components/
    Button/
      Button.tsx
      Button.stories.tsx   ← stories here
      Button.test.tsx
```

### 5. Write a story file

```tsx
// src/components/Button/Button.stories.tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button";

const meta: Meta<typeof Button> = {
  title: "Components/Button",       // hierarchy: Category/Name
  component: Button,
  tags: ["autodocs"],               // generates a Docs page automatically
  argTypes: {
    variant: {
      control: { type: "select" },
      options: ["primary", "secondary", "danger"],
    },
    onClick: { action: "clicked" }, // logs to Actions panel
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

// Default state
export const Primary: Story = {
  args: {
    variant: "primary",
    children: "Click me",
  },
};

// Disabled state
export const Disabled: Story = {
  args: {
    ...Primary.args,
    disabled: true,
  },
};

// With interaction test
export const ClickTest: Story = {
  args: Primary.args,
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button"));
  },
};
```

### 6. Story hierarchy conventions

Organize `title` strings so the sidebar is navigable:

```
Pages/           — full-page layouts
  LoginPage
  Dashboard
Components/      — reusable UI components
  Forms/
    Input
    Select
  Navigation/
    NavBar
    Breadcrumbs
Primitives/      — atoms (Button, Icon, Badge)
```

### 7. Add `storybook` scripts to package.json

```json
{
  "scripts": {
    "storybook": "storybook dev -p 6006",
    "build-storybook": "storybook build"
  }
}
```

### 8. Run and verify

```bash
npm run storybook
```

Open `http://localhost:6006`. Confirm:
- Component renders in the Canvas
- Controls panel shows props
- Actions panel logs events
- Accessibility panel shows no violations (or expected ones)

## Templates

### Minimal story (no interactions)

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { MyComponent } from "./MyComponent";

const meta: Meta<typeof MyComponent> = {
  title: "Components/MyComponent",
  component: MyComponent,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof MyComponent>;

export const Default: Story = {
  args: {
    // fill in default props
  },
};
```

### Story with async interaction test

```tsx
import { within, userEvent } from "@storybook/test";

export const SubmitForm: Story = {
  args: { onSubmit: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("Email"), "test@example.com");
    await userEvent.click(canvas.getByRole("button", { name: /submit/i }));
    expect(args.onSubmit).toHaveBeenCalled();
  },
};
```

### Global decorator for context providers

```tsx
// .storybook/preview.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

const preview: Preview = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <Story />
      </QueryClientProvider>
    ),
  ],
};
```

## Checklist

- [ ] `npm run storybook` starts without errors
- [ ] At least one story renders in the Canvas
- [ ] Controls panel shows component props
- [ ] Actions panel captures event callbacks
- [ ] Accessibility panel loads (no setup errors)
- [ ] `npm run build-storybook` completes without errors
- [ ] Stories are co-located with their components (`ComponentName.stories.tsx`)
- [ ] `tags: ["autodocs"]` present on at least one component for generated docs
- [ ] Global providers (theme, router, query client) added to `.storybook/preview.tsx` if needed

## Files involved

| File | Action |
|------|--------|
| `.storybook/main.ts` | Created by init — verify addons |
| `.storybook/preview.ts` | Created by init — add decorators and global styles |
| `src/**/*.stories.tsx` | Create alongside each component |
| `package.json` | Add `storybook` and `build-storybook` scripts |
| `package-lock.json` | Updated by npm install |

## Common mistakes

**Wrong framework in main.ts** — `init` usually detects the right one, but if you're using Vite and it picks `react-webpack5`, change `framework.name` to `@storybook/react-vite`.

**Missing global styles** — if the component looks unstyled in Storybook but correct in the app, import `../src/index.css` in `.storybook/preview.ts`.

**Missing context provider** — if a component throws "no QueryClient" or "no Router" errors, wrap it in a decorator in `.storybook/preview.ts` (applies globally) or in the individual story's `decorators` array.

**`autodocs` not generating** — `tags: ["autodocs"]` must be on the `meta` object, not on individual stories.

**Story title hierarchy not matching folders** — the `title` string is independent of file path. Keep them in sync manually (`Components/Button/Button` should be `Components/Button`).

**Controls not appearing** — controls are inferred from TypeScript types. If props are `any` or untyped, add `argTypes` manually in the meta object.
