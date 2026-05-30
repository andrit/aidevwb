---
name: anim-react-three-fiber
description: Build 3D React scenes with React Three Fiber — Canvas, declarative Three.js objects, useFrame animation loop, drei helpers, GLTF loading, and pointer events
domain: animation
type: cross-cutting
triggers:
  - "React Three Fiber"
  - "R3F"
  - "@react-three/fiber"
  - "drei"
  - "3D React"
  - "react 3D"
  - "useFrame"
  - "react-three"
---

# React Three Fiber (R3F)

## When to use

When building 3D scenes that live inside a React component tree — product viewers, interactive 3D UIs, animated backgrounds, or data visualizations integrated with React state and routing. React Three Fiber (R3F) maps every Three.js object to a JSX element, enabling familiar React patterns (props, state, hooks, context) in 3D space.

Use vanilla Three.js (see `anim-threejs` skill) when working outside React, when you need to escape the R3F abstraction for maximum control, or when migrating an existing Three.js codebase. Use R3F for greenfield React projects where 3D is one part of a larger UI.

## Prerequisites

- React 18+ project (Vite recommended; Next.js needs `"use client"` and dynamic import)
- TypeScript recommended (full types included)

## Installation

```bash
npm install @react-three/fiber three
npm install -D @types/three

# Highly recommended helpers library
npm install @react-three/drei

# Optional: physics
npm install @react-three/rapier

# Optional: post-processing
npm install @react-three/postprocessing
```

## Core Patterns

### Canvas + basic mesh

The `<Canvas>` component creates the renderer and scene. Every Three.js class is available as a JSX element by lowercasing the class name and adding a `<` prefix — `THREE.BoxGeometry` → `<boxGeometry>`, `THREE.MeshStandardMaterial` → `<meshStandardMaterial>`.

```tsx
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";

function Scene() {
  return (
    <Canvas
      camera={{ position: [0, 1.5, 5], fov: 60 }}
      shadows
      dpr={[1, 2]}               // pixel ratio: min 1, max 2
      gl={{ antialias: true }}
    >
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[5, 8, 5]}
        intensity={2}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />

      <mesh castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#3b82f6" metalness={0.3} roughness={0.4} />
      </mesh>

      {/* Ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color="#1a1a2e" />
      </mesh>

      <OrbitControls enableDamping dampingFactor={0.05} maxPolarAngle={Math.PI / 2} />
      <Environment preset="city" />   {/* HDR lighting environment */}
    </Canvas>
  );
}

export default Scene;
```

### useFrame — per-frame animation hook

`useFrame` runs inside the render loop. Its callback receives the R3F state object and the frame delta (seconds since last frame).

```tsx
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

function RotatingCube() {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state, delta) => {
    if (!meshRef.current) return;

    // delta = seconds since last frame → frame-rate independent
    meshRef.current.rotation.y += delta * 0.8;
    meshRef.current.rotation.x += delta * 0.3;

    // Access the clock for time-based animation
    const t = state.clock.getElapsedTime();
    meshRef.current.position.y = Math.sin(t * 2) * 0.3;
  });

  return (
    <mesh ref={meshRef} castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#8b5cf6" roughness={0.2} metalness={0.8} />
    </mesh>
  );
}
```

### Loading a GLTF model — useGLTF from drei

```tsx
import { useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// Preload at module level (starts fetching before component mounts)
useGLTF.preload("/models/robot.glb");

interface RobotProps {
  scale?: number;
}

function Robot({ scale = 1 }: RobotProps) {
  const groupRef = useRef<THREE.Group>(null);

  // useGLTF returns { scene, nodes, materials, animations }
  const { scene, animations } = useGLTF("/models/robot.glb");

  // Play GLTF animations with useAnimations from drei
  // (import { useAnimations } from "@react-three/drei")
  // const { actions } = useAnimations(animations, groupRef);
  // useEffect(() => { actions["Idle"]?.play(); }, [actions]);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    // Gentle float animation
    groupRef.current.position.y = Math.sin(state.clock.getElapsedTime()) * 0.1;
  });

  return (
    <group ref={groupRef} scale={scale}>
      <primitive object={scene} castShadow receiveShadow />
    </group>
  );
}

export { Robot };
```

### Pointer events on 3D objects

R3F maps browser pointer events to raycasted 3D hits. Any mesh can receive `onClick`, `onPointerEnter`, `onPointerLeave`, etc.

```tsx
import { useState, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

function InteractiveSphere() {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const [active, setActive] = useState(false);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    // Animate toward target scale
    const targetScale = active ? 1.3 : hovered ? 1.1 : 1;
    meshRef.current.scale.lerp(
      new THREE.Vector3(targetScale, targetScale, targetScale),
      delta * 8
    );
  });

  return (
    <mesh
      ref={meshRef}
      onClick={() => setActive((a) => !a)}
      onPointerEnter={() => {
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerLeave={() => {
        setHovered(false);
        document.body.style.cursor = "auto";
      }}
    >
      <sphereGeometry args={[1, 32, 32]} />
      <meshStandardMaterial
        color={active ? "#ec4899" : hovered ? "#8b5cf6" : "#3b82f6"}
        roughness={0.2}
        metalness={0.7}
      />
    </mesh>
  );
}
```

### drei helpers — Environment, Text, Html overlay

```tsx
import { Canvas } from "@react-three/fiber";
import {
  Environment,
  OrbitControls,
  Text,
  Html,
  ContactShadows,
  Float,
  Sparkles,
} from "@react-three/drei";

function EnhancedScene() {
  return (
    <Canvas camera={{ position: [0, 2, 8], fov: 50 }} shadows>
      {/* HDR environment map for realistic reflections */}
      <Environment preset="sunset" background blur={0.5} />

      {/* Floating mesh with gentle bobbing motion */}
      <Float speed={1.5} rotationIntensity={0.4} floatIntensity={0.6}>
        <mesh castShadow>
          <torusKnotGeometry args={[0.8, 0.3, 100, 16]} />
          <meshStandardMaterial color="#3b82f6" metalness={0.9} roughness={0.1} />
        </mesh>
      </Float>

      {/* 3D text rendered with SDF */}
      <Text
        position={[0, -2.5, 0]}
        fontSize={0.5}
        color="#ffffff"
        anchorX="center"
        font="/fonts/Inter-Bold.woff"
      >
        React Three Fiber
      </Text>

      {/* HTML overlay that lives in 3D space (perspective billboarding) */}
      <Html position={[2, 1, 0]} distanceFactor={4} occlude>
        <div
          style={{
            background: "rgba(0,0,0,0.7)",
            color: "#fff",
            padding: "8px 12px",
            borderRadius: 8,
            fontSize: 14,
            whiteSpace: "nowrap",
          }}
        >
          Hover me
        </div>
      </Html>

      {/* Particle sparkles */}
      <Sparkles count={100} size={3} scale={[10, 5, 10]} color="#8b5cf6" />

      {/* Soft shadow on ground */}
      <ContactShadows position={[0, -1.5, 0]} opacity={0.5} scale={10} blur={2} />

      <OrbitControls />
    </Canvas>
  );
}
```

### Next.js integration — avoiding SSR errors

```tsx
// app/page.tsx (Next.js App Router)
import dynamic from "next/dynamic";

// Dynamic import with ssr: false — Canvas requires window/WebGL
const Scene = dynamic(() => import("@/components/Scene"), { ssr: false });

export default function Page() {
  return (
    <main style={{ width: "100vw", height: "100vh" }}>
      <Scene />
    </main>
  );
}
```

```tsx
// components/Scene.tsx — must be a client component
"use client";

import { Canvas } from "@react-three/fiber";
// ... rest of the scene
```

### useAnimations — playing GLTF animations

```tsx
import { useRef, useEffect } from "react";
import { useGLTF, useAnimations } from "@react-three/drei";
import * as THREE from "three";

function AnimatedCharacter() {
  const groupRef = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF("/models/character.glb");
  const { actions, names } = useAnimations(animations, groupRef);

  useEffect(() => {
    // Play the first animation on mount, cross-fade between states
    const idle = actions["Idle"];
    if (idle) {
      idle.reset().fadeIn(0.3).play();
    }
    return () => {
      idle?.fadeOut(0.3);
    };
  }, [actions]);

  return (
    <group ref={groupRef}>
      <primitive object={scene} />
    </group>
  );
}
```

## Performance Notes

- **`useFrame` priority:** Pass a second argument `useFrame(fn, priority)` where lower numbers run first (default 0). Use `-1` for pre-render updates (e.g., physics), `1` for post-render effects.
- **Avoid allocations in `useFrame`:** Never `new THREE.Vector3()` inside the `useFrame` callback — it runs 60× per second. Declare vectors in `useRef` outside the callback and call `.set()` to mutate them.
- **`<Canvas frameloop="demand">`** — set `frameloop="demand"` and call `invalidate()` from `useThree` to only re-render when state changes. Saves battery on static/infrequently updated scenes.
- **`<Instances>` from drei** — for many identical meshes, use `<Instances>` (wraps `InstancedMesh`) instead of rendering many `<mesh>` elements. Reduces draw calls from N to 1.
- **Suspend GLTF loading:** `useGLTF` suspends the component. Wrap in `<Suspense fallback={<LoadingFallback />}>` inside the Canvas so the rest of the UI renders while the model loads.

## Checklist

- [ ] `<Canvas>` has `dpr={[1, 2]}` — pixel ratio capped at 2
- [ ] GLTF models loaded with `useGLTF` and preloaded with `useGLTF.preload()`
- [ ] `<Suspense>` wrapping components that use `useGLTF` / `useTexture`
- [ ] `useFrame` callbacks do not allocate new objects — using refs for vectors
- [ ] Pointer event handlers clean up `document.body.style.cursor` on `onPointerLeave`
- [ ] Next.js: Canvas component uses `"use client"` and is dynamically imported with `ssr: false`
- [ ] `useAnimations` handles `fadeIn/fadeOut` for smooth GLTF animation blending

## Files involved

| File | Action |
|------|--------|
| `src/components/Scene.tsx` | Create: main Canvas + scene setup |
| `src/components/models/Robot.tsx` | Create: GLTF model component with useGLTF |
| `src/components/ui/LoadingFallback.tsx` | Create: 3D loading indicator (Suspense fallback) |
| `public/models/` | Create: GLTF/GLB model files |

## Common mistakes

**Using `new THREE.Vector3()` inside `useFrame`** — R3F's `useFrame` runs every render frame. Creating new objects inside it causes heavy GC pressure. Store mutable vectors in `useRef`: `const vecRef = useRef(new THREE.Vector3())` and call `vecRef.current.set(x, y, z)` inside the callback.

**`<Canvas>` outside the React tree (SSR crash)** — R3F's `<Canvas>` accesses `window` and WebGL APIs on import. In Next.js, the file containing `<Canvas>` must have `"use client"` at the top AND the import must be wrapped in `dynamic(..., { ssr: false })`. Missing either causes `ReferenceError: window is not defined` at build time.

**`useGLTF` without `<Suspense>`** — `useGLTF` uses React Suspense to pause rendering while the model downloads. Without a `<Suspense>` boundary, React throws an error. Wrap model components in `<Suspense fallback={null}>` inside the Canvas.

**Mutating `scene` from `useGLTF` directly** — `useGLTF` caches the result; multiple components that load the same path share the same `scene` object. If you modify it (reparenting, material changes), you mutate the shared cached object and affect all components. Clone it first: `const cloned = useMemo(() => scene.clone(true), [scene])`.

**Forgetting `useGLTF.preload()` at module level** — without preloading, model download starts only when the component mounts, causing a visible pop-in. Call `useGLTF.preload("/models/model.glb")` at the module level (outside all components) in the file that will use the model.
