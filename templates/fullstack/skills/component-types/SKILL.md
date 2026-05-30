---
name: component-types
description: Choose the right React component pattern for a given situation — presentational, container, HOC, custom hook, render props, or compound components
domain: frontend
type: fullstack
triggers:
  - "which component pattern"
  - "when to use HOC"
  - "presentational vs container"
  - "custom hook vs component"
  - "render props"
  - "compound component"
  - "component patterns"
  - "how to share logic between components"
---

# React Component Patterns

## When to use

When deciding how to structure a new component or refactor an existing one. Activate when the user asks "how should I structure this component?", "when do I use a HOC vs a hook?", "should this be a container component?", or "how do I share logic between two components?"

## Prerequisites

- React 16.8+ (hooks available)
- Basic understanding of props and state
- A concrete problem to solve (the pattern choice depends on the use case)

## Pattern Decision Flowchart

```
Does this component fetch data or manage global state?
├── YES → Does it render UI?
│         ├── YES → Split it: Container component calls a Presentational component
│         └── NO  → It IS the container; render children or a named component
└── NO  → Does it need to share stateful logic with other components?
          ├── YES → Custom Hook (always try this first)
          └── NO  → Does it need to wrap/enhance existing components?
                    ├── YES → HOC (if it wraps many component types)
                    │         Render Props (if the consumer controls rendering)
                    └── NO  → Is it a complex multi-part UI (Tabs, Select, Accordion)?
                              ├── YES → Compound Components
                              └── NO  → Simple Presentational Component
```

## Steps

### 1. Identify the problem

Before picking a pattern, answer these questions:
- What data does this component need, and where does it come from?
- Does any logic need to be reused in another component?
- Who controls the rendering — the component itself, or its parent?
- Is this a leaf (renders DOM) or a coordinator (manages others)?

### 2. Presentational Components

**Use when:** The component receives all its data via props and renders UI. No direct API calls, no state management libraries. Maximally reusable.

```tsx
// Pure presentational — all data via props
interface UserCardProps {
  name: string;
  avatarUrl: string;
  role: string;
  onEdit?: () => void;
}

export function UserCard({ name, avatarUrl, role, onEdit }: UserCardProps) {
  return (
    <div className="user-card">
      <img src={avatarUrl} alt={name} />
      <h3>{name}</h3>
      <p>{role}</p>
      {onEdit && <button onClick={onEdit}>Edit</button>}
    </div>
  );
}
```

**Signs you've done it right:** The component has no `useEffect`, no `fetch`, no `useSelector`. It's easy to test with just prop values.

### 3. Container Components

**Use when:** A component needs to fetch data, connect to a store, or own complex state — but you want to keep the rendering logic reusable.

```tsx
// Container — owns data fetching and state
function UserCardContainer({ userId }: { userId: string }) {
  const { data: user, isLoading } = useQuery(["user", userId], () => fetchUser(userId));
  const { mutate: updateUser } = useMutation(saveUser);

  if (isLoading) return <Skeleton />;

  return (
    <UserCard
      name={user.name}
      avatarUrl={user.avatarUrl}
      role={user.role}
      onEdit={() => updateUser({ id: userId, ...editValues })}
    />
  );
}
```

**Signs you've done it right:** The container has no `className`, no inline styles, no JSX beyond `<PresentationalComponent />`. The presentational component works independently in Storybook with fake props.

### 4. Custom Hooks

**Use when:** Two or more components share stateful logic. Custom hooks replaced most cases where people previously used HOCs or render props.

```tsx
// Custom hook — reusable stateful logic
function useUserProfile(userId: string) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setIsLoading(true);
    fetchUser(userId)
      .then(setUser)
      .catch(setError)
      .finally(() => setIsLoading(false));
  }, [userId]);

  const refresh = useCallback(() => {
    setUser(null);
    setIsLoading(true);
    fetchUser(userId).then(setUser).catch(setError).finally(() => setIsLoading(false));
  }, [userId]);

  return { user, isLoading, error, refresh };
}

// Usage in any component
function ProfilePage({ userId }: { userId: string }) {
  const { user, isLoading } = useUserProfile(userId);
  // ...
}
```

**Signs you've done it right:** The hook starts with `use`, it returns values and/or functions, and it contains no JSX.

### 5. Higher-Order Components (HOC)

**Use when:** You need to add cross-cutting behavior (auth check, error boundary, logging) to many different component types, AND a custom hook isn't sufficient because you need to intercept rendering.

```tsx
// HOC — wraps a component to add behavior
function withAuthGuard<P extends object>(
  WrappedComponent: React.ComponentType<P>
) {
  return function AuthGuardedComponent(props: P) {
    const { isAuthenticated, isLoading } = useAuth();

    if (isLoading) return <LoadingSpinner />;
    if (!isAuthenticated) return <Navigate to="/login" />;

    return <WrappedComponent {...props} />;
  };
}

// Usage
const ProtectedDashboard = withAuthGuard(Dashboard);
const ProtectedSettings = withAuthGuard(Settings);
```

**Signs you've done it right:** The HOC is used in 3+ places. It adds behavior without knowing or caring about what the wrapped component does.

**Prefer a custom hook first.** Only reach for a HOC when the logic requires intercepting render (redirects, conditional rendering based on async state, error boundaries).

### 6. Render Props

**Use when:** A component manages some state or behavior and needs to let its consumer decide what to render with that state. More flexible than HOCs for cases where the consumer needs fine-grained control.

```tsx
// Render prop — passes state to a child function
interface MouseTrackerProps {
  children: (position: { x: number; y: number }) => React.ReactNode;
}

function MouseTracker({ children }: MouseTrackerProps) {
  const [position, setPosition] = useState({ x: 0, y: 0 });

  return (
    <div onMouseMove={(e) => setPosition({ x: e.clientX, y: e.clientY })}>
      {children(position)}
    </div>
  );
}

// Consumer controls rendering
<MouseTracker>
  {({ x, y }) => <Tooltip>Mouse at {x}, {y}</Tooltip>}
</MouseTracker>
```

**Note:** Most render-prop use cases are better served by custom hooks today. Use render props when the state is inherently tied to a DOM element (mouse events, intersection observer, resize) and a custom hook alone can't manage the DOM relationship.

### 7. Compound Components

**Use when:** Building a complex multi-part UI component (Tabs, Accordion, Select, Modal, Form) where sub-components need to share implicit state through context.

```tsx
// Compound component — sub-components share context
interface TabsContextValue {
  activeTab: string;
  setActiveTab: (id: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("useTabs must be used within <Tabs>");
  return ctx;
}

function Tabs({ children, defaultTab }: { children: ReactNode; defaultTab: string }) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      <div className="tabs">{children}</div>
    </TabsContext.Provider>
  );
}

function TabList({ children }: { children: ReactNode }) {
  return <div role="tablist">{children}</div>;
}

function Tab({ id, children }: { id: string; children: ReactNode }) {
  const { activeTab, setActiveTab } = useTabs();
  return (
    <button
      role="tab"
      aria-selected={activeTab === id}
      onClick={() => setActiveTab(id)}
    >
      {children}
    </button>
  );
}

function TabPanel({ id, children }: { id: string; children: ReactNode }) {
  const { activeTab } = useTabs();
  if (activeTab !== id) return null;
  return <div role="tabpanel">{children}</div>;
}

// Attach sub-components
Tabs.List = TabList;
Tabs.Tab = Tab;
Tabs.Panel = TabPanel;

// Usage — consumer controls structure
<Tabs defaultTab="overview">
  <Tabs.List>
    <Tabs.Tab id="overview">Overview</Tabs.Tab>
    <Tabs.Tab id="details">Details</Tabs.Tab>
  </Tabs.List>
  <Tabs.Panel id="overview"><OverviewContent /></Tabs.Panel>
  <Tabs.Panel id="details"><DetailsContent /></Tabs.Panel>
</Tabs>
```

**Signs you've done it right:** Sub-components throw a clear error if used outside their parent. The parent owns all state. Consumers arrange sub-components however they want.

## Quick-Reference Table

| Pattern | Use for | Avoid when |
|---------|---------|------------|
| Presentational | Pure rendering, max reusability | Component needs its own data |
| Container | Data fetching, store connection | There's no reusable rendering layer |
| Custom Hook | Shared stateful logic | Logic needs to intercept rendering |
| HOC | Cross-cutting render concerns (auth, logging) | A custom hook would work instead |
| Render Props | Consumer controls rendering of managed state | A custom hook would work instead |
| Compound | Multi-part UI sharing implicit state | Simple components with 1-2 variants |

## Checklist

- [ ] Presentational components have no `useEffect`, `fetch`, or store connections
- [ ] Custom hooks start with `use` and contain no JSX
- [ ] HOCs forward all props with `{...props}` (no prop leaking)
- [ ] Compound sub-components throw a descriptive error when used outside their parent
- [ ] Container components have no `className` or style props
- [ ] Context in compound components is not exported — only the `use*` hook is
- [ ] Each pattern is tested at the appropriate level (presentational = prop-driven unit tests, hook = `renderHook`, HOC = wrapping a mock component)

## Files involved

| File | Pattern |
|------|---------|
| `src/components/<Name>/<Name>.tsx` | Presentational component |
| `src/containers/<Name>Container.tsx` | Container component |
| `src/hooks/use<Name>.ts` | Custom hook |
| `src/hocs/with<Behavior>.tsx` | HOC |
| `src/components/<Name>/index.tsx` | Compound component root + sub-component exports |

## Common mistakes

**Putting data fetching in presentational components** — the moment you add `useEffect` + `fetch` to a presentational component, you've lost the ability to test it in isolation or reuse it with different data sources.

**Writing a HOC when a custom hook would work** — hooks are almost always simpler. Only reach for HOCs when you need to intercept rendering (redirects, conditional returns).

**Context without a guard hook** — always create a `use<Name>` hook that throws if used outside the provider. Without it, sub-component errors are cryptic ("cannot read property X of null").

**Render props instead of hooks** — render props add JSX nesting. In React 16.8+, almost every render-prop pattern is cleaner as a custom hook.

**Compound components with exported Context** — if consumers can access the context directly, they bypass your API. Export only the `use<Name>` hook; keep the Context object private to the module.
