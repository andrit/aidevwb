---
name: vr-react-vr
description: Build WebXR / VR experiences in the browser with @react-three/xr and @react-three/fiber — immersive sessions, controller input, spatial UI panels, and workbench RAG results displayed in 3D space
domain: platform
type: cross-cutting
triggers:
  - "VR"
  - "WebXR"
  - "React VR"
  - "immersive"
  - "XR"
  - "virtual reality"
  - "react-three"
  - "3D scene"
  - "spatial UI"
---

# WebXR / VR with React Three Fiber

## When to use

Activate when the user wants to build an immersive VR experience in the browser, create a 3D spatial interface, or embed workbench RAG query results inside a virtual environment. This skill uses `@react-three/fiber` (React renderer for Three.js), `@react-three/xr` (WebXR integration), and `@react-three/drei` (helpers). The result runs in any WebXR-capable browser — Chrome on Quest, Chrome on desktop with a VR headset, or a flat-screen "desktop XR" mode for development.

## Prerequisites

- Node 20+ and a React project (Vite or Next.js; Next.js requires `"use client"` on XR components)
- For real VR: a WebXR-capable browser (Chrome 95+ on Meta Quest, or desktop Chrome with a headset)
- For development without a headset: install the [WebXR API Emulator](https://chrome.google.com/webstore/detail/webxr-api-emulator/) Chrome extension — it emulates a VR headset in DevTools
- Workbench running (`make up`) — the mcp-server API is at `http://localhost:3100`

## Install

```bash
npm install three @react-three/fiber @react-three/xr @react-three/drei
npm install -D @types/three
```

## XR Canvas Setup

This is the root component. Every VR scene starts here.

```tsx
// src/components/XRApp.tsx
import { Canvas } from "@react-three/fiber";
import { XR, createXRStore } from "@react-three/xr";
import { Sky, Stars } from "@react-three/drei";
import { FloatingResultsPanel } from "./FloatingResultsPanel";
import { VRControllers } from "./VRControllers";

// createXRStore manages XR session lifecycle (enter/exit, session type)
const xrStore = createXRStore();

export function XRApp() {
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      {/* Enter VR button — only shown when WebXR is available */}
      <button
        onClick={() => xrStore.enterVR()}
        style={{
          position: "absolute",
          bottom: 24,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 10,
          padding: "12px 24px",
          fontSize: 16,
          background: "#6200ea",
          color: "white",
          border: "none",
          borderRadius: 8,
          cursor: "pointer",
        }}
      >
        Enter VR
      </button>

      <Canvas camera={{ position: [0, 1.6, 3], fov: 70 }}>
        {/* XR wraps the scene and provides session context to all children */}
        <XR store={xrStore}>
          {/* Lighting */}
          <ambientLight intensity={0.4} />
          <directionalLight position={[5, 10, 5]} intensity={1} />

          {/* Environment */}
          <Sky sunPosition={[100, 20, 100]} />
          <Stars radius={100} depth={50} count={3000} factor={4} />

          {/* Floor */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
            <planeGeometry args={[20, 20]} />
            <meshStandardMaterial color="#1a1a2e" />
          </mesh>

          {/* Controllers */}
          <VRControllers />

          {/* Content: floating panel showing RAG results */}
          <FloatingResultsPanel position={[0, 1.6, -2]} />
        </XR>
      </Canvas>
    </div>
  );
}
```

## Immersive VR Session Configuration

For full immersive-vr mode with room-scale tracking:

```tsx
// src/components/ImmersiveScene.tsx
import { useXR } from "@react-three/xr";
import { useEffect } from "react";

// Hook that reacts to XR session state
export function ImmersiveScene() {
  const { isPresenting, session } = useXR();

  useEffect(() => {
    if (isPresenting) {
      console.log("Entered VR — session type:", session?.visibilityState);
    }
  }, [isPresenting, session]);

  return null;
}

// In createXRStore, request specific optional features:
const xrStore = createXRStore({
  // Request hand tracking and bounded floor reference space
  hand: { right: true, left: true },
  // controller: true,   // enable if you want controller meshes
});

// Enter immersive-vr with specific feature hints:
async function enterImmersiveVR() {
  await xrStore.enterVR();
  // The XR session will request: ["local-floor", "bounded-floor"]
  // and optional: ["hand-tracking", "layers"]
}
```

## Controller Input Handler

```tsx
// src/components/VRControllers.tsx
import { useXRInputSourceEvent, XROrigin } from "@react-three/xr";
import { useRef, useState } from "react";
import { Mesh } from "three";
import { useFrame } from "@react-three/fiber";

export function VRControllers() {
  const [triggerPressed, setTriggerPressed] = useState(false);
  const pointerRef = useRef<Mesh>(null);

  // Listen for controller button events
  useXRInputSourceEvent(
    "all",           // "left" | "right" | "all"
    "selectstart",   // WebXR event: "selectstart" = trigger pressed
    (event) => {
      setTriggerPressed(true);
      console.log("Trigger pressed on:", event.inputSource.handedness);
    },
    []
  );

  useXRInputSourceEvent(
    "all",
    "selectend",
    () => setTriggerPressed(false),
    []
  );

  return (
    // XROrigin offsets the player's position in the scene
    <XROrigin position={[0, 0, 0]}>
      {/* Visual pointer ray from controller */}
      <mesh ref={pointerRef}>
        <boxGeometry args={[0.01, 0.01, 0.5]} />
        <meshStandardMaterial
          color={triggerPressed ? "#ff4081" : "#ffffff"}
          emissive={triggerPressed ? "#ff4081" : "#444444"}
        />
      </mesh>
    </XROrigin>
  );
}
```

## Floating Panel — RAG Results in 3D Space

This is the key integration: query the workbench API and display results as a 3D floating UI panel.

```tsx
// src/components/FloatingResultsPanel.tsx
import { Text, RoundedBox } from "@react-three/drei";
import { useState, useCallback } from "react";
import { Vector3 } from "three";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Group } from "three";

interface RagResult {
  id: string;
  content: string;
  score: number;
}

interface Props {
  position: [number, number, number];
}

async function queryWorkbench(query: string): Promise<RagResult[]> {
  const response = await fetch("http://localhost:3100/api/projects/default/rag/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, top_k: 3 }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return data.results ?? [];
}

export function FloatingResultsPanel({ position }: Props) {
  const [results, setResults] = useState<RagResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [query] = useState("What is this project about?");
  const groupRef = useRef<Group>(null);

  // Gently bob the panel
  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.position.y = position[1] + Math.sin(clock.elapsedTime * 0.5) * 0.02;
    }
  });

  const fetchResults = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await queryWorkbench(query);
      setResults(data);
    } catch (err) {
      console.error("Workbench query failed:", err);
    } finally {
      setIsLoading(false);
    }
  }, [query]);

  // Auto-fetch on mount
  useState(() => { fetchResults(); });

  const panelWidth = 1.4;
  const panelHeight = 0.9;
  const lineHeight = 0.08;

  return (
    <group ref={groupRef} position={position}>
      {/* Panel background */}
      <RoundedBox args={[panelWidth, panelHeight, 0.02]} radius={0.04} smoothness={4}>
        <meshStandardMaterial color="#0d1b2a" opacity={0.92} transparent />
      </RoundedBox>

      {/* Title */}
      <Text
        position={[0, panelHeight / 2 - 0.08, 0.02]}
        fontSize={0.055}
        color="#90caf9"
        anchorX="center"
        anchorY="middle"
        font="/fonts/Inter-Medium.woff"  // place a WOFF font in /public/fonts/
      >
        Workbench Knowledge
      </Text>

      {/* Results */}
      {isLoading ? (
        <Text position={[0, 0, 0.02]} fontSize={0.05} color="#ffffff" anchorX="center">
          Loading…
        </Text>
      ) : (
        results.map((result, index) => (
          <group key={result.id} position={[0, 0.25 - index * 0.24, 0.02]}>
            <Text
              position={[0, lineHeight / 2, 0]}
              fontSize={0.038}
              color="#e0e0e0"
              maxWidth={1.2}
              textAlign="left"
              anchorX="center"
              anchorY="top"
              lineHeight={1.3}
            >
              {result.content.slice(0, 140)}
            </Text>
            <Text
              position={[0.55, -lineHeight, 0]}
              fontSize={0.028}
              color="#66bb6a"
              anchorX="right"
              anchorY="middle"
            >
              {`${(result.score * 100).toFixed(0)}%`}
            </Text>
          </group>
        ))
      )}

      {/* Refresh button mesh */}
      <mesh
        position={[0, -(panelHeight / 2) + 0.06, 0.03]}
        onClick={fetchResults}
      >
        <planeGeometry args={[0.3, 0.07]} />
        <meshStandardMaterial color="#6200ea" />
      </mesh>
      <Text
        position={[0, -(panelHeight / 2) + 0.06, 0.04]}
        fontSize={0.035}
        color="#ffffff"
        anchorX="center"
        anchorY="middle"
      >
        Refresh
      </Text>
    </group>
  );
}
```

## Vite Config (if using Vite)

```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    https: true,     // WebXR immersive-vr REQUIRES https (or localhost)
    port: 5173,
  },
});
```

WebXR's `immersive-vr` session type is only available on `https://` origins or `localhost`. During development on `localhost`, plain HTTP works fine. For LAN testing on a headset, you need a self-signed certificate or use a tunnel like `ngrok`.

## Checklist

- [ ] `@react-three/xr`, `@react-three/fiber`, `@react-three/drei`, `three` all installed
- [ ] `createXRStore()` created at module level (not inside a component)
- [ ] `<XR store={xrStore}>` wraps the entire scene inside `<Canvas>`
- [ ] Dev server runs on `localhost` or HTTPS (WebXR requirement)
- [ ] WebXR API Emulator Chrome extension installed for headset-free development
- [ ] Font `.woff` file placed in `/public/fonts/` for `<Text>` component
- [ ] CORS: workbench responds to requests from `http://localhost:5173`
- [ ] Floating panel Z-position is negative (in front of the camera, which looks down -Z)

## Files involved

| File | Action |
|------|--------|
| `src/components/XRApp.tsx` | Create: root Canvas + XR session setup |
| `src/components/VRControllers.tsx` | Create: controller input event handlers |
| `src/components/FloatingResultsPanel.tsx` | Create: 3D floating RAG results panel |
| `src/components/ImmersiveScene.tsx` | Create: session state hooks |
| `vite.config.ts` | Modify: enable HTTPS for LAN headset testing |
| `public/fonts/Inter-Medium.woff` | Add: font file for `<Text>` component |

## Common mistakes

**Missing HTTPS for a real headset** — `immersive-vr` sessions are blocked on insecure origins. `localhost` is the only exception. Testing on a Quest over Wi-Fi requires HTTPS. Use `vite --https` or set `server.https: true` in `vite.config.ts` with a self-signed cert, or tunnel via `ngrok http 5173`.

**Placing `createXRStore()` inside a component** — `createXRStore()` creates a new store on every render if placed inside a component function. Define it at the module level (outside the component) so it persists across re-renders.

**Negative Z confusion** — Three.js uses a right-handed coordinate system: the camera looks down the negative Z axis. A panel placed at `position={[0, 1.6, 2]}` is behind the user. Use negative Z (e.g., `[0, 1.6, -2]`) to put it in front.

**`<Text>` rendering white boxes** — the `@react-three/drei` `<Text>` component requires a font file. Without a `font` prop pointing to a valid `.woff` URL, it renders as white rectangles. Place the font in `/public/fonts/` and reference it as `/fonts/Inter-Medium.woff`.

**Fetching `localhost` from a Meta Quest browser** — the Quest's browser is not on the same machine, so `localhost:3100` doesn't reach the workbench. Use your host machine's LAN IP or set up `adb reverse tcp:3100 tcp:3100` via the Oculus Developer Hub to forward the port over USB.
