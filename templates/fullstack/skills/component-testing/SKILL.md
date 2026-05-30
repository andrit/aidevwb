---
name: component-testing
description: Set up React Testing Library + Vitest, test user interactions and async behavior, mock API calls, and understand when to use snapshot testing
domain: frontend
type: fullstack
triggers:
  - "test react components"
  - "react testing library"
  - "component tests"
  - "test user interactions"
  - "mock api in tests"
  - "test async components"
  - "snapshot testing"
  - "vitest react setup"
  - "how to test hooks"
---

# React Component Testing

## When to use

When adding tests to React components, setting up a testing environment from scratch, or deciding what and how to test. Activate when the user asks "how do I test this component?", "set up React Testing Library", "how do I mock a fetch call in tests?", or "should I use snapshot tests?".

## Prerequisites

- React project with Vite or Next.js (these steps focus on Vite + Vitest; Next.js notes included)
- `package.json` exists
- For existing projects: check whether Jest or Vitest is already installed before adding the other

## Steps

### 1. Install dependencies

```bash
npm install --save-dev vitest @vitest/coverage-v8 \
  @testing-library/react @testing-library/user-event @testing-library/jest-dom \
  jsdom msw
```

| Package | Purpose |
|---------|---------|
| `vitest` | Test runner (Jest-compatible API, Vite-native) |
| `@vitest/coverage-v8` | Coverage reports |
| `@testing-library/react` | `render`, `screen`, `within` utilities |
| `@testing-library/user-event` | Realistic user interaction simulation |
| `@testing-library/jest-dom` | Custom matchers (`toBeInTheDocument`, `toHaveValue`, etc.) |
| `jsdom` | Browser DOM simulation |
| `msw` | Mock Service Worker — intercepts `fetch` at the network level |

### 2. Configure Vitest

```ts
// vite.config.ts (or vitest.config.ts)
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,                          // no need to import describe/it/expect
    setupFiles: ["./src/test/setup.ts"],    // runs before each test file
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      exclude: ["src/test/**", "**/*.stories.tsx"],
    },
  },
});
```

```ts
// src/test/setup.ts
import "@testing-library/jest-dom";         // extends expect() with DOM matchers
```

### 3. Add test scripts

```json
// package.json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

### 4. Test file naming and location

Co-locate tests with the component they test:

```
src/
  components/
    Button/
      Button.tsx
      Button.test.tsx    ← unit test
  pages/
    LoginPage/
      LoginPage.tsx
      LoginPage.test.tsx ← integration test (form + API mock)
```

### 5. Testing user interactions — the core skill

**Principle:** Test what the user can see and do, not implementation details. Query by accessible role, label, or text. Interact with `userEvent`, not `fireEvent`.

```tsx
// src/components/LoginForm/LoginForm.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginForm } from "./LoginForm";

describe("LoginForm", () => {
  it("calls onSubmit with email and password when form is submitted", async () => {
    const user = userEvent.setup();          // always setup() first
    const onSubmit = vi.fn();

    render(<LoginForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/email/i), "alice@example.com");
    await user.type(screen.getByLabelText(/password/i), "secret123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      email: "alice@example.com",
      password: "secret123",
    });
  });

  it("shows validation error when email is empty", async () => {
    const user = userEvent.setup();
    render(<LoginForm onSubmit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(screen.getByText(/email is required/i)).toBeInTheDocument();
  });
});
```

**Query priority (highest to lowest):**

1. `getByRole` — most accessible and reliable
2. `getByLabelText` — form inputs
3. `getByPlaceholderText` — only if no label exists
4. `getByText` — static text
5. `getByTestId` — last resort; add `data-testid` only when nothing else works

### 6. Testing async behavior

Use `findBy*` queries (they await the DOM update) or wrap assertions in `waitFor`.

```tsx
// Component that fetches data on mount
it("displays user name after loading", async () => {
  render(<UserProfile userId="123" />);

  // findBy* = getBy* + waitFor
  expect(await screen.findByText("Alice")).toBeInTheDocument();

  // Alternative: explicit waitFor
  await waitFor(() => {
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });
});

// Component with loading state
it("shows a spinner while loading", () => {
  render(<UserProfile userId="123" />);
  expect(screen.getByRole("status")).toBeInTheDocument();  // spinner
});
```

### 7. Mocking API calls with MSW

MSW intercepts real `fetch`/`axios` calls at the network level — the component makes its real request, MSW responds with controlled data. This tests more of the stack than mocking `fetch` directly.

```ts
// src/test/handlers.ts
import { http, HttpResponse } from "msw";

export const handlers = [
  http.get("/api/users/:id", ({ params }) => {
    return HttpResponse.json({
      id: params.id,
      name: "Alice",
      email: "alice@example.com",
    });
  }),

  http.post("/api/auth/login", async ({ request }) => {
    const body = await request.json() as { email: string; password: string };
    if (body.password === "wrong") {
      return HttpResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }
    return HttpResponse.json({ token: "fake-jwt-token" });
  }),
];
```

```ts
// src/test/server.ts
import { setupServer } from "msw/node";
import { handlers } from "./handlers";

export const server = setupServer(...handlers);
```

```ts
// src/test/setup.ts — add MSW lifecycle
import "@testing-library/jest-dom";
import { server } from "./server";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());     // clean per-test overrides
afterAll(() => server.close());
```

```tsx
// Test with per-test handler override
import { http, HttpResponse } from "msw";
import { server } from "../test/server";

it("shows error message on login failure", async () => {
  server.use(
    http.post("/api/auth/login", () =>
      HttpResponse.json({ error: "Invalid credentials" }, { status: 401 })
    )
  );

  const user = userEvent.setup();
  render(<LoginPage />);

  await user.type(screen.getByLabelText(/email/i), "alice@example.com");
  await user.type(screen.getByLabelText(/password/i), "wrong");
  await user.click(screen.getByRole("button", { name: /sign in/i }));

  expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument();
});
```

### 8. Testing custom hooks with renderHook

```tsx
import { renderHook, act } from "@testing-library/react";
import { useCounter } from "./useCounter";

describe("useCounter", () => {
  it("increments count", () => {
    const { result } = renderHook(() => useCounter(0));

    act(() => result.current.increment());

    expect(result.current.count).toBe(1);
  });

  it("resets to initial value", () => {
    const { result } = renderHook(() => useCounter(5));

    act(() => result.current.reset());

    expect(result.current.count).toBe(5);
  });
});
```

If the hook uses a context provider (e.g., Zustand, React Query):

```tsx
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    {children}
  </QueryClientProvider>
);

const { result } = renderHook(() => useUserData("123"), { wrapper });
```

### 9. Snapshot testing — when to use and when not to

**Use snapshots for:**
- Stable, intentionally static UI (error pages, legal text, email templates)
- Serialized data structures (API response shapes, configuration objects)

**Do NOT use snapshots for:**
- Components that change often — every UI change breaks snapshots, forcing mindless updates
- Testing behavior — snapshots test structure, not interactions or logic

```tsx
// Acceptable: stable component unlikely to change
it("renders the 404 page", () => {
  const { container } = render(<NotFoundPage />);
  expect(container).toMatchSnapshot();
});

// Better alternative for most components: explicit assertions
it("shows the error message", () => {
  render(<ErrorBanner message="Something went wrong" />);
  expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toBeInTheDocument();
});
```

**When a snapshot breaks and you update it blindly (`-u` flag), you've learned nothing.** Only update a snapshot after verifying visually that the change is intentional.

### 10. Run and verify

```bash
npm test                    # run all tests once
npm run test:watch          # re-run on file change
npm run test:coverage       # coverage report
```

Target: `>80%` coverage on components with business logic. Don't chase 100% — test what users can break.

## Templates

### Standard component test

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { MyComponent } from "./MyComponent";

describe("MyComponent", () => {
  it("renders default state", () => {
    render(<MyComponent />);
    expect(screen.getByRole("heading")).toBeInTheDocument();
  });

  it("handles user interaction", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<MyComponent onAction={onAction} />);

    await user.click(screen.getByRole("button", { name: /action/i }));

    expect(onAction).toHaveBeenCalledOnce();
  });
});
```

### Async data component test

```tsx
it("loads and displays data", async () => {
  render(<DataComponent id="1" />);

  expect(screen.getByRole("status")).toBeInTheDocument();   // loading spinner

  expect(await screen.findByText("Expected content")).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument(); // spinner gone
});
```

## Checklist

- [ ] `npm test` passes with no errors
- [ ] `@testing-library/jest-dom` imported in setup file
- [ ] MSW server started in `beforeAll`, reset in `afterEach`, closed in `afterAll`
- [ ] Tests query by role/label — no `querySelector`, minimal `data-testid`
- [ ] `userEvent.setup()` used (not `fireEvent`) for interactions
- [ ] `findBy*` used for async DOM updates (not `getBy*` + `waitFor`)
- [ ] No `act()` warnings in test output
- [ ] Snapshots used sparingly (only for stable, static UI)
- [ ] Custom hooks tested with `renderHook`
- [ ] Coverage report shows sensible coverage (focus on logic-heavy components)

## Files involved

| File | Purpose |
|------|---------|
| `vite.config.ts` | Add `test` config block |
| `src/test/setup.ts` | jest-dom import + MSW lifecycle |
| `src/test/handlers.ts` | MSW request handlers |
| `src/test/server.ts` | MSW server instance |
| `src/components/**/*.test.tsx` | Component tests |
| `src/hooks/*.test.ts` | Hook tests |
| `package.json` | Test scripts |

## Common mistakes

**Using `fireEvent` instead of `userEvent`** — `fireEvent` dispatches raw DOM events; `userEvent` simulates actual browser behavior (focus, blur, keyboard events, etc.). Always use `userEvent.setup()`.

**`getBy*` for async content** — if the element doesn't exist yet (it's loading), `getBy*` throws immediately. Use `findBy*` which waits up to 1 second.

**Not resetting MSW handlers** — if one test adds a `server.use()` override and doesn't reset, it bleeds into the next test. The `afterEach(() => server.resetHandlers())` in setup.ts prevents this.

**Testing implementation details** — don't test internal state, class names, or prop names directly. Test what the user sees and what they can do. If your test breaks when you refactor the implementation without changing behavior, the test is testing the wrong thing.

**`act()` warnings** — these usually mean an async state update happened after the test ended. Wrap the async operation in `await act(async () => { ... })` or use `findBy*` / `waitFor` to wait for the update.

**Snapshot tests for everything** — snapshots that break constantly train developers to update them without reading. Use explicit assertions instead.

**Mocking modules directly** — `vi.mock("../api/users")` mocks at the module level, which couples tests to your import structure. MSW mocks at the network level, which is more realistic and doesn't break if you change how you import the API function.
