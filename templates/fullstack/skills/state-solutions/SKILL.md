---
name: state-solutions
description: Choose and implement the right React state management solution — useState, useReducer, Zustand, Redux Toolkit, or Jotai — with decision flowchart and migration paths
domain: frontend
type: fullstack
triggers:
  - "state management"
  - "global state"
  - "when to use redux"
  - "zustand vs redux"
  - "useState vs useReducer"
  - "jotai"
  - "context api"
  - "how to share state"
  - "state is getting complex"
---

# React State Management

## When to use

When a project needs to decide how to manage application state, or when the current solution is causing pain (prop drilling, stale data, complex update logic). Activate when the user asks "how should I manage state?", "should I add Redux?", "my state updates are getting complicated", or "I need global state".

## Prerequisites

- React project with existing components
- At least a rough sense of: how much state exists, how many components share it, and whether state needs to persist
- For Zustand/Redux/Jotai: `package.json` with React 18+ (or 16.8+ for hooks)

## Decision Flowchart

```
Is the state only needed by one component (or one small subtree)?
├── YES → Is the state logic simple (1-2 values, straightforward updates)?
│         ├── YES → useState
│         └── NO  → Does the next state depend on the previous in complex ways?
│                   ├── YES → useReducer
│                   └── NO  → useState (multiple variables)
└── NO  → How many top-level "slices" of global state exist?
          ├── 1-3 → Is the update logic simple?
          │         ├── YES → Zustand
          │         └── NO  → Zustand with immer middleware
          ├── 4+  → Do you need DevTools, time-travel, or strict action history?
          │         ├── YES → Redux Toolkit
          │         └── NO  → Zustand (slice pattern)
          └── Is the state highly granular / independent atoms?
                    └── YES → Jotai
```

## Steps

### 1. useState — local, simple

**Use when:** One component owns the state and the logic is straightforward.

```tsx
// Simple: single value
const [isOpen, setIsOpen] = useState(false);

// Simple: related values as an object
const [form, setForm] = useState({ email: "", password: "" });
const updateField = (field: keyof typeof form, value: string) =>
  setForm((prev) => ({ ...prev, [field]: value }));

// With lazy initialization (expensive default)
const [data, setData] = useState(() => JSON.parse(localStorage.getItem("data") ?? "null"));
```

**Limit:** When you have 3+ `useState` calls that always change together, or when the update logic requires knowing the previous state in non-trivial ways, move to `useReducer`.

### 2. useReducer — local, complex logic

**Use when:** State updates are conditional, depend on previous state in multiple ways, or you want to centralize all update logic for a component.

```tsx
type State = {
  count: number;
  step: number;
  history: number[];
};

type Action =
  | { type: "increment" }
  | { type: "decrement" }
  | { type: "set-step"; payload: number }
  | { type: "reset" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "increment":
      return { ...state, count: state.count + state.step, history: [...state.history, state.count] };
    case "decrement":
      return { ...state, count: state.count - state.step, history: [...state.history, state.count] };
    case "set-step":
      return { ...state, step: action.payload };
    case "reset":
      return { count: 0, step: 1, history: [] };
  }
}

function Counter() {
  const [state, dispatch] = useReducer(reducer, { count: 0, step: 1, history: [] });
  return (
    <div>
      <button onClick={() => dispatch({ type: "decrement" })}>-</button>
      <span>{state.count}</span>
      <button onClick={() => dispatch({ type: "increment" })}>+</button>
    </div>
  );
}
```

**Limit:** Still local. If other components need the same state, promote it.

### 3. Zustand — global, simple to moderate

**Use when:** Multiple components need shared state and the logic is straightforward enough that you don't need structured slices or strict action history.

```bash
npm install zustand
```

```tsx
// src/stores/useUserStore.ts
import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

interface UserState {
  user: User | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  logout: () => void;
}

export const useUserStore = create<UserState>()(
  devtools(
    persist(
      (set) => ({
        user: null,
        isLoading: false,
        setUser: (user) => set({ user }),
        logout: () => set({ user: null }),
      }),
      { name: "user-storage" }     // persists to localStorage
    ),
    { name: "UserStore" }          // DevTools label
  )
);

// Usage in any component — no Provider needed
function ProfileButton() {
  const { user, logout } = useUserStore();
  if (!user) return null;
  return <button onClick={logout}>{user.name}</button>;
}
```

**With immer for complex updates:**

```bash
npm install immer
```

```tsx
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

interface CartState {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
}

export const useCartStore = create<CartState>()(
  immer((set) => ({
    items: [],
    addItem: (item) =>
      set((state) => {
        const existing = state.items.find((i) => i.id === item.id);
        if (existing) existing.quantity += 1;
        else state.items.push(item);
      }),
    removeItem: (id) =>
      set((state) => {
        state.items = state.items.filter((i) => i.id !== id);
      }),
    updateQuantity: (id, quantity) =>
      set((state) => {
        const item = state.items.find((i) => i.id === id);
        if (item) item.quantity = quantity;
      }),
  }))
);
```

### 4. Redux Toolkit — global, complex or team-scale

**Use when:** The app has many interconnected slices, needs time-travel debugging, or has strict requirements around action traceability (auditing, replay).

```bash
npm install @reduxjs/toolkit react-redux
```

```tsx
// src/store/slices/userSlice.ts
import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit";

export const fetchUser = createAsyncThunk("user/fetch", async (id: string) => {
  const res = await fetch(`/api/users/${id}`);
  return res.json() as Promise<User>;
});

interface UserState {
  data: User | null;
  status: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
}

const userSlice = createSlice({
  name: "user",
  initialState: { data: null, status: "idle", error: null } as UserState,
  reducers: {
    logout: (state) => { state.data = null; state.status = "idle"; },
    updateName: (state, action: PayloadAction<string>) => {
      if (state.data) state.data.name = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchUser.pending, (state) => { state.status = "loading"; })
      .addCase(fetchUser.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.data = action.payload;
      })
      .addCase(fetchUser.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.error.message ?? "Unknown error";
      });
  },
});

export const { logout, updateName } = userSlice.actions;
export default userSlice.reducer;

// src/store/index.ts
import { configureStore } from "@reduxjs/toolkit";
import userReducer from "./slices/userSlice";

export const store = configureStore({
  reducer: { user: userReducer },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// src/store/hooks.ts — typed hooks (use these, not raw useSelector/useDispatch)
import { TypedUseSelectorHook, useDispatch, useSelector } from "react-redux";
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

// src/main.tsx — wrap app
import { Provider } from "react-redux";
import { store } from "./store";

<Provider store={store}><App /></Provider>

// In a component
const { data: user, status } = useAppSelector((state) => state.user);
const dispatch = useAppDispatch();
dispatch(fetchUser("123"));
dispatch(logout());
```

### 5. Jotai — atomic, fine-grained

**Use when:** State is highly granular — many independent atoms that different parts of the UI subscribe to independently. Avoids re-rendering the whole tree when one atom changes.

```bash
npm install jotai
```

```tsx
// src/atoms/theme.ts
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export const themeAtom = atomWithStorage<"light" | "dark">("theme", "light");

// Derived atom (computed from other atoms)
export const isDarkAtom = atom((get) => get(themeAtom) === "dark");

// Writable derived atom
export const toggleThemeAtom = atom(
  (get) => get(themeAtom),
  (get, set) => set(themeAtom, get(themeAtom) === "light" ? "dark" : "light")
);

// Usage — no Provider needed for basic use
import { useAtom, useAtomValue, useSetAtom } from "jotai";

function ThemeToggle() {
  const [, toggle] = useAtom(toggleThemeAtom);
  const isDark = useAtomValue(isDarkAtom);
  return <button onClick={toggle}>{isDark ? "Light" : "Dark"} mode</button>;
}
```

## Migration Paths

### useState → useReducer

When to migrate: You have 3+ related `useState` calls that change together, or update logic is getting conditional.

```tsx
// Before
const [count, setCount] = useState(0);
const [step, setStep] = useState(1);
const [history, setHistory] = useState<number[]>([]);

// After — see useReducer section above
```

### Local state → Zustand

When to migrate: A component's state is needed 2+ levels up or in sibling components. Prop drilling appears.

1. Create `src/stores/use<Domain>Store.ts`
2. Move state and update functions from the component into `create()`
3. Replace `useState`/callbacks with `useStore` calls in each component
4. Remove the prop chain

### Zustand → Redux Toolkit

When to migrate: Store has grown to 6+ slices, team needs strict action boundaries, or you want time-travel debugging.

1. Install `@reduxjs/toolkit react-redux`
2. Convert each Zustand store file to a Redux slice (`createSlice`)
3. Create `store/index.ts` with `configureStore`
4. Create typed `useAppSelector` and `useAppDispatch` hooks
5. Replace `useXStore()` calls with `useAppSelector` + `useAppDispatch`
6. Add `<Provider store={store}>` to `main.tsx`

## Checklist

- [ ] State that's only used by one component stays local (`useState`/`useReducer`)
- [ ] No prop drilling deeper than 2 levels (if drilling, promote to global store)
- [ ] Zustand stores live in `src/stores/use<Domain>Store.ts`
- [ ] Redux slices live in `src/store/slices/<domain>Slice.ts`
- [ ] Redux typed hooks (`useAppSelector`, `useAppDispatch`) used — not raw hooks
- [ ] Async Redux actions use `createAsyncThunk`, not hand-rolled thunks
- [ ] Zustand stores use `devtools` middleware (for Redux DevTools support)
- [ ] Jotai atoms with localStorage use `atomWithStorage`
- [ ] Store update functions are tested in isolation (extract reducer/action logic to pure functions)

## Files involved

| File | State solution |
|------|---------------|
| `src/components/<Name>/<Name>.tsx` | `useState` / `useReducer` — stays local |
| `src/stores/use<Domain>Store.ts` | Zustand store |
| `src/store/index.ts` | Redux store configuration |
| `src/store/slices/<domain>Slice.ts` | Redux slice |
| `src/store/hooks.ts` | Typed `useAppSelector` / `useAppDispatch` |
| `src/atoms/<domain>.ts` | Jotai atoms |
| `src/main.tsx` | Redux `<Provider>` wrapper |

## Common mistakes

**Using global state for everything** — most state is and should stay local. Only promote state when it's genuinely shared across unrelated components.

**Not using `devtools` middleware in Zustand** — without it, you lose Redux DevTools support. Always add `devtools()` in development.

**Raw `useSelector`/`useDispatch` in Redux projects** — always use the typed wrappers (`useAppSelector`, `useAppDispatch`) to get type safety. Put them in `src/store/hooks.ts`.

**Mutating state directly in Zustand without immer** — Zustand's `set` requires you to return a new object. Use the `immer` middleware if you need mutation-style updates.

**Zustand `persist` + sensitive data** — `persist` writes to `localStorage` by default. Don't persist tokens, PII, or session data without an appropriate storage adapter.

**Context API as a Redux replacement** — React Context is for low-frequency updates (theme, locale, user session). Using it for high-frequency state (list items, form fields) causes unnecessary re-renders across the entire subtree.
