---
name: accessibility-implementation
description: WCAG 2.1 AA accessibility implementation — semantic HTML, ARIA patterns, keyboard navigation, focus management, color contrast, screen reader testing, and CI integration
domain: design
type: cross-cutting
triggers:
  - "accessibility"
  - "a11y"
  - "WCAG"
  - "ARIA"
  - "screen reader"
  - "keyboard navigation"
  - "focus management"
  - "accessible design"
  - "axe"
  - "color contrast"
---

# Accessibility Implementation

## When to use

Before any public-facing UI ships. WCAG 2.1 AA is the legal standard in most jurisdictions (US: ADA, Section 508; EU: EN 301 549; UK: Equality Act). Beyond compliance, accessibility features benefit all users: keyboard navigation helps power users, captions help users in noisy environments, clear focus states help users on trackpads. Activate when starting a new project and when reviewing any interactive component.

## WCAG 2.1 AA — The Four Principles (POUR)

**Perceivable** — information can be perceived by all users (visual, auditory, tactile):
- Text alternatives for non-text content (images, icons)
- Captions for audio and video
- Color is not the only means of conveying information
- Minimum contrast: 4.5:1 for normal text, 3:1 for large text and UI components

**Operable** — all functionality accessible via keyboard; no seizure triggers:
- All interactive elements reachable and operable by keyboard
- No keyboard traps (focus can always leave a component)
- Skip navigation links
- No timing requirements (or generous timeouts with extension option)
- No flashing content (< 3 flashes/second)

**Understandable** — information and UI operation is understandable:
- Labels on all form inputs
- Error messages identify the error and suggest correction
- Consistent navigation and component behavior
- Predictable focus behavior

**Robust** — content can be interpreted by assistive technologies:
- Valid HTML (no duplicate IDs, properly nested elements)
- ARIA roles, states, and properties used correctly
- Name, Role, Value pattern for custom widgets

## Semantic HTML First

Semantic HTML provides accessibility for free. Custom ARIA only when HTML's native semantics don't cover the pattern.

```html
<!-- ✗ Inaccessible: no semantics, no keyboard behavior -->
<div class="button" onclick="submit()">Submit</div>

<!-- ✓ Accessible: native button — keyboard, role, activation, focus all built in -->
<button type="submit">Submit</button>

<!-- Navigation landmarks — screen readers can jump between them -->
<header>Site header</header>
<nav aria-label="Primary">Main navigation</nav>
<main>Page content</main>
<aside aria-label="Related">Sidebar</aside>
<footer>Site footer</footer>

<!-- Headings: one h1 per page; logical hierarchy (don't skip levels) -->
<h1>Page Title</h1>
  <h2>Section</h2>
    <h3>Subsection</h3>
  <h2>Another Section</h2>

<!-- Form labels: every input has a label -->
<label for="email">Email address</label>
<input type="email" id="email" name="email" required
  aria-describedby="email-hint">
<p id="email-hint">We'll never share your email.</p>
```

## ARIA — When and How

**First rule of ARIA:** Don't use ARIA if native HTML covers the pattern. A `<button>` is better than `<div role="button">`.

**When ARIA is necessary:** Custom widgets (tabs, accordions, comboboxes, tree views), dynamic content announcements, labeling elements without visible text.

**The three ARIA categories:**

**Roles** — what the element is: `role="dialog"`, `role="tab"`, `role="alert"`, `role="combobox"`.

**Properties** — static characteristics: `aria-label="Close"`, `aria-describedby="hint"`, `aria-required="true"`, `aria-haspopup="listbox"`.

**States** — dynamic characteristics (change with interaction): `aria-expanded="false"`, `aria-checked="true"`, `aria-selected="true"`, `aria-disabled="true"`.

```html
<!-- Disclosure (accordion) -->
<button aria-expanded="false" aria-controls="section-1-content" id="section-1-header">
  Section 1
</button>
<div id="section-1-content" role="region" aria-labelledby="section-1-header" hidden>
  Content here
</div>

<!-- Tab interface -->
<div role="tablist" aria-label="Product information">
  <button role="tab" aria-selected="true"  id="tab-description" aria-controls="panel-description">Description</button>
  <button role="tab" aria-selected="false" id="tab-reviews"     aria-controls="panel-reviews" tabindex="-1">Reviews</button>
</div>
<div role="tabpanel" id="panel-description" aria-labelledby="tab-description">Description content</div>
<div role="tabpanel" id="panel-reviews"     aria-labelledby="tab-reviews" hidden>Reviews content</div>

<!-- Live region for dynamic announcements -->
<div aria-live="polite" aria-atomic="true" class="sr-only" id="status-announcer"></div>
<!-- Set textContent in JS to announce: document.getElementById('status-announcer').textContent = '3 results found' -->

<!-- Icon-only button — must have accessible name -->
<button aria-label="Close dialog">
  <svg aria-hidden="true" focusable="false"><!-- icon --></svg>
</button>
```

## Keyboard Navigation

Every interactive element must be operable by keyboard. The tab order must be logical (matches visual/reading order).

**Tab stop management:**
- `tabindex="0"` — adds element to natural tab order
- `tabindex="-1"` — removes from tab order but allows programmatic focus
- `tabindex="n"` (positive) — avoid; creates unpredictable tab order

```typescript
// Keyboard event handling for custom widgets
function handleTabKeyInDialog(event: KeyboardEvent, dialogEl: HTMLElement): void {
  const focusable = dialogEl.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex="0"]'
  );
  const first = focusable[0];
  const last  = focusable[focusable.length - 1];

  if (event.key === "Tab") {
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();           // Wrap backward
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();          // Wrap forward
    }
  }
  if (event.key === "Escape") {
    closeDialog();
  }
}

// Tab keyboard pattern (left/right arrow key navigation)
function handleTabListKeydown(event: KeyboardEvent, tabs: NodeListOf<HTMLElement>): void {
  const currentIndex = Array.from(tabs).indexOf(event.target as HTMLElement);
  let newIndex = currentIndex;

  if (event.key === "ArrowRight") newIndex = (currentIndex + 1) % tabs.length;
  if (event.key === "ArrowLeft")  newIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  if (event.key === "Home")       newIndex = 0;
  if (event.key === "End")        newIndex = tabs.length - 1;

  if (newIndex !== currentIndex) {
    tabs[newIndex].focus();
    tabs[newIndex].click();  // Activate the tab
  }
}
```

## Focus Management

**Focus trap in modals** — when a dialog opens, focus must move into the dialog and cannot leave until the dialog closes.

```typescript
// React example using Radix UI Dialog (handles focus trap natively)
import * as Dialog from "@radix-ui/react-dialog";

function ConfirmDialog({ open, onClose, onConfirm }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content"
          onOpenAutoFocus={(e) => e.preventDefault()}  // Control where focus goes
          aria-describedby="dialog-description">
          <Dialog.Title>Confirm deletion</Dialog.Title>
          <Dialog.Description id="dialog-description">
            This action cannot be undone.
          </Dialog.Description>
          <button onClick={onConfirm} className="btn-destructive">Delete</button>
          <Dialog.Close asChild>
            <button className="btn-secondary">Cancel</button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

**Return focus on close** — when a dialog or drawer closes, return focus to the element that triggered it.

```typescript
function useReturnFocus(isOpen: boolean) {
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      triggerRef.current = document.activeElement as HTMLElement;
    } else {
      triggerRef.current?.focus();
    }
  }, [isOpen]);
}
```

## Visible Focus Styles

Browsers have removed default focus rings in some contexts. Always provide visible focus styles.

```css
/* Global focus ring — visible, high-contrast, not distracting for mouse users */
:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
  border-radius: 2px;
}

/* Remove outline for mouse/touch (only show for keyboard) */
:focus:not(:focus-visible) {
  outline: none;
}

/* Never: */
/* * { outline: none; } -- removes all focus visibility */
/* button:focus { outline: none; } -- removes keyboard focus for buttons */
```

## Skip Navigation

```html
<!-- First element in <body> — screen readers and keyboard users can skip to main content -->
<a href="#main-content" class="skip-link">Skip to main content</a>

<!-- ... navigation and header ... -->

<main id="main-content" tabindex="-1">  <!-- tabindex="-1" allows programmatic focus -->
  <!-- Page content -->
</main>
```

```css
.skip-link {
  position: absolute;
  transform: translateY(-100%);   /* Visually hidden */
  padding: 8px 16px;
  background: var(--color-primary);
  color: white;
  font-weight: 600;
}
.skip-link:focus { transform: translateY(0); }  /* Visible when focused */
```

## Screen Reader Only Text

```css
/* Hide visually but keep in accessibility tree */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
```

## Automated Testing Integration

```bash
npm install -D @axe-core/playwright  # or @axe-core/react for unit tests
npm install -D @storybook/addon-a11y
```

```typescript
// Playwright accessibility test — run in CI
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("homepage is accessible", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
```

## Checklist

- [ ] Semantic HTML used for all structural elements (landmark regions, headings, lists, tables)
- [ ] Every `<img>` has `alt` text (or `alt=""` if decorative); every `<svg>` icon has `aria-hidden="true"` or `aria-label`
- [ ] All form inputs have associated `<label>` elements
- [ ] Color contrast: normal text ≥ 4.5:1, large text and UI components ≥ 3:1
- [ ] Color is never the sole means of conveying information
- [ ] Focus visible on all interactive elements (`:focus-visible` styled)
- [ ] Tab order is logical (matches visual reading order)
- [ ] Modal dialogs trap focus; return focus to trigger element on close
- [ ] `aria-live` regions announce dynamic updates (search results count, toast messages)
- [ ] Skip navigation link at top of every page
- [ ] `axe-core` runs in CI — zero violations on WCAG 2.1 AA rules

## Common mistakes

**`aria-label` on elements that already have visible text** — `<button aria-label="Submit">Submit</button>` overrides the button's text for screen readers. Redundant and potentially confusing if the label differs.

**Positive `tabindex`** — `tabindex="5"` creates a tab order that diverges from the DOM order and breaks for keyboard users. Use `tabindex="0"` to add to natural order, `tabindex="-1"` for programmatic-only focus.

**Focus trap without Escape to close** — if a modal traps focus, users must be able to exit with `Escape`. Without it, keyboard users are permanently trapped in the dialog.

**`role="button"` on a `<div>`** — `role="button"` announces the element as a button but does not add keyboard behavior (`Enter` and `Space` activation, `disabled` state). Requires manual `onKeyDown` handling. Use `<button>` instead.

**Testing with only one screen reader** — NVDA (Windows/Chrome), JAWS (Windows/Chrome), VoiceOver (macOS+iOS/Safari), TalkBack (Android) each have quirks. Test with at least VoiceOver + NVDA for coverage.
