---
name: anim-threejs
description: Build 3D scenes with Three.js — scene setup, geometries, lighting, animation loop, GLTF model loading, and post-processing with EffectComposer
domain: animation
type: cross-cutting
triggers:
  - "Three.js"
  - "ThreeJS"
  - "WebGL"
  - "3D scene"
  - "GLTF"
  - "3D web"
  - "WebGL animation"
  - "post-processing"
  - "OrbitControls"
---

# Three.js 3D Animation

## When to use

When a project requires interactive 3D scenes, WebGL-powered visualizations, product viewers, or immersive backgrounds in the browser. Three.js is the standard abstraction over raw WebGL. Use it for: product configurators, 3D hero sections, data visualization in 3D, game-like experiences, and GLTF model viewers.

For React-first projects where the scene is deeply integrated into a React component tree, prefer React Three Fiber (see `anim-react-three-fiber` skill) which wraps Three.js declaratively. Use vanilla Three.js when working outside React or when you need direct access to the Three.js API without the R3F abstraction layer.

## Prerequisites

- Any web project with a `<canvas>` element or a container div
- Node.js project with npm

## Installation

```bash
npm install three
npm install -D @types/three   # TypeScript types
```

For controls and loaders (included in the `three/addons` path):

```typescript
// All addons come with three — no separate install needed
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
```

## Core Patterns

### Minimal Three.js scene — scene, camera, renderer, mesh

```typescript
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// 1. Scene — the container for all objects, lights, cameras
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a1a);

// 2. Camera — perspective (FOV, aspect, near clip, far clip)
const camera = new THREE.PerspectiveCamera(
  60,                                    // vertical FOV in degrees
  window.innerWidth / window.innerHeight, // aspect ratio
  0.1,                                   // near clipping plane
  1000                                   // far clipping plane
);
camera.position.set(0, 1.5, 5);

// 3. Renderer — outputs to canvas
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,              // true = transparent canvas background
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // cap at 2x for perf
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
document.getElementById("canvas-container")!.appendChild(renderer.domElement);

// 4. Geometry + Material + Mesh
const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshStandardMaterial({
  color: 0x3b82f6,
  metalness: 0.3,
  roughness: 0.4,
});
const cube = new THREE.Mesh(geometry, material);
cube.castShadow = true;
scene.add(cube);

// 5. Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 2);
dirLight.position.set(5, 8, 5);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 30;
scene.add(dirLight);

// 6. OrbitControls — mouse pan/zoom/rotate
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;     // smooth inertia
controls.dampingFactor = 0.05;
controls.minDistance = 2;
controls.maxDistance = 20;
controls.maxPolarAngle = Math.PI / 2; // prevent going below ground

// 7. Animation loop
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();  // seconds since last frame

  // Rotate cube
  cube.rotation.y += delta * 0.8;

  controls.update();               // required if damping is enabled
  renderer.render(scene, camera);
}
animate();

// 8. Responsive resize
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});
```

### Common geometries and materials

```typescript
import * as THREE from "three";

// Geometries
const sphere   = new THREE.SphereGeometry(1, 32, 32);     // radius, widthSegs, heightSegs
const plane    = new THREE.PlaneGeometry(10, 10, 1, 1);   // width, height, wSegs, hSegs
const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 2, 32); // rTop, rBottom, height, segs
const torus    = new THREE.TorusGeometry(1, 0.3, 16, 100); // radius, tube, rSegs, tSegs

// Materials
const standard = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  map: null,              // texture map
  normalMap: null,        // bump detail
  roughnessMap: null,
  metalnessMap: null,
  metalness: 0,
  roughness: 1,
  envMap: null,           // environment reflection
});

const phys = new THREE.MeshPhysicalMaterial({
  ...standard.parameters,
  clearcoat: 1.0,         // lacquer layer
  transmission: 0.95,     // glass-like
  thickness: 0.5,
  ior: 1.5,               // index of refraction
});

const basic = new THREE.MeshBasicMaterial({ color: 0xff0000 }); // unaffected by light (UI, wireframe)
const line  = new THREE.LineBasicMaterial({ color: 0x00ff00 });
```

### GLTF model loading

```typescript
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

const gltfLoader = new GLTFLoader();

// Optional: Draco compression decoder (dramatically reduces file size)
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.6/");
gltfLoader.setDRACOLoader(dracoLoader);

// Load model
gltfLoader.load(
  "/models/robot.glb",
  (gltf) => {
    const model = gltf.scene;

    // Scale and center the model
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    model.scale.setScalar(2 / maxDim);                   // normalize to 2 units tall
    model.position.sub(center.multiplyScalar(2 / maxDim)); // center at origin

    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // Access and modify materials
        if (mesh.material instanceof THREE.MeshStandardMaterial) {
          mesh.material.envMapIntensity = 1.5;
        }
      }
    });

    scene.add(model);

    // Play animations if the model has them
    if (gltf.animations.length > 0) {
      const mixer = new THREE.AnimationMixer(model);
      const action = mixer.clipAction(gltf.animations[0]);
      action.play();

      // Update mixer in the animation loop:
      // mixer.update(delta);
    }
  },
  (progress) => {
    const pct = (progress.loaded / progress.total) * 100;
    console.log(`Loading: ${pct.toFixed(0)}%`);
  },
  (error) => {
    console.error("GLTF load error:", error);
  }
);
```

### Post-processing with EffectComposer

```typescript
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// Replace renderer.render(scene, camera) with composer.render()
const composer = new EffectComposer(renderer);

// 1. Base render pass — renders the scene normally
composer.addPass(new RenderPass(scene, camera));

// 2. Bloom pass — glowing highlights
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  1.5,   // strength: 0–3 (how intense the glow is)
  0.4,   // radius: blur radius
  0.85   // threshold: luminance above which glow is applied (0–1)
);
composer.addPass(bloomPass);

// 3. Output pass — applies tone mapping + color space conversion (replaces renderer settings)
composer.addPass(new OutputPass());

// In the animation loop, replace renderer.render(scene, camera):
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  controls.update();
  composer.render(delta);  // <-- use composer instead of renderer
}

// On resize, also resize the composer:
window.addEventListener("resize", () => {
  // ... camera and renderer updates ...
  composer.setSize(window.innerWidth, window.innerHeight);
});
```

### Animation loop with clock — multiple animated objects

```typescript
import * as THREE from "three";

const clock = new THREE.Clock();
const mixers: THREE.AnimationMixer[] = [];

// Collect multiple animated objects
const meshes: THREE.Mesh[] = [];
for (let i = 0; i < 5; i++) {
  const mesh = new THREE.Mesh(
    new THREE.TorusGeometry(0.5 + i * 0.3, 0.05, 8, 64),
    new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(i / 5, 0.8, 0.6) })
  );
  scene.add(mesh);
  meshes.push(mesh);
}

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();    // seconds since last frame (frame-rate independent)
  const elapsed = clock.getElapsedTime(); // total elapsed seconds

  // Animate each mesh
  meshes.forEach((mesh, i) => {
    mesh.rotation.x = elapsed * 0.5 + i * 0.3;
    mesh.rotation.y = elapsed * 0.8 + i * 0.5;
    mesh.position.y = Math.sin(elapsed * 2 + i) * 0.3;
  });

  // Update all animation mixers (GLTF animations)
  mixers.forEach((mixer) => mixer.update(delta));

  controls.update();
  renderer.render(scene, camera);
}
animate();
```

## Performance Notes

- **Draw calls:** Each `Mesh` in the scene is a draw call. Reduce by merging static geometry with `BufferGeometryUtils.mergeGeometries()` or using `InstancedMesh` for many identical objects.
- **Texture sizes:** Use power-of-two textures (512, 1024, 2048). Compress with KTX2/Basis using `gltf-transform` CLI. Non-POT textures cannot be mipmapped.
- **Pixel ratio:** Cap at `Math.min(devicePixelRatio, 2)` — 4K retina displays would render 4× the fragments without the cap, destroying performance.
- **Shadow maps:** `PCFSoftShadowMap` is expensive. Only enable shadows for the key directional light. Use baked shadow textures for static scenes.
- **`dispose()` everything on cleanup:** Geometries, materials, and textures are uploaded to the GPU and must be explicitly freed. Call `geometry.dispose()`, `material.dispose()`, `texture.dispose()`, and `renderer.dispose()` when tearing down a Three.js scene.

## Checklist

- [ ] `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))` — capped pixel ratio
- [ ] `clock.getDelta()` used for frame-rate-independent animation (not a fixed increment)
- [ ] `controls.update()` called every frame if `enableDamping = true`
- [ ] Window resize handler updates `camera.aspect`, `camera.updateProjectionMatrix()`, and `renderer.setSize()`
- [ ] All geometries, materials, and textures disposed on teardown
- [ ] GLTF models use Draco compression and are served from the same origin (CORS)
- [ ] `OutputPass` added last in EffectComposer chain when using post-processing

## Files involved

| File | Action |
|------|--------|
| `src/three/scene.ts` | Create: scene, camera, renderer initialization |
| `src/three/controls.ts` | Create: OrbitControls + resize handler |
| `src/three/loader.ts` | Create: GLTFLoader with Draco setup |
| `src/three/postprocessing.ts` | Create: EffectComposer + passes |
| `public/models/` | Create: GLTF/GLB model files |

## Common mistakes

**Not updating `camera.updateProjectionMatrix()` after resizing** — `camera.aspect` is a plain property; changing it has no effect until `updateProjectionMatrix()` is called. Forgetting this causes the scene to stretch or squash on window resize.

**Using `renderer.render()` alongside an EffectComposer** — once EffectComposer is set up, you must call `composer.render()` in the animation loop instead of `renderer.render()`. Calling both causes double rendering and breaks tone mapping applied by `OutputPass`.

**Not calling `mixer.update(delta)` in the animation loop** — `AnimationMixer` does not advance automatically. If `mixer.update(delta)` is not called every frame with the frame delta (from `clock.getDelta()`), GLTF animations are frozen.

**Forgetting to dispose GPU resources** — Three.js does not garbage collect GPU resources. When a component or route unmounts, call `geometry.dispose()`, `material.dispose()`, `texture.dispose()`, and `renderer.dispose()`. The Chrome GPU Memory panel will show steadily increasing usage in a SPA if disposals are skipped.

**GLTF models with non-normalized scale/rotation** — many exported GLTF files have scale `(0.01, 0.01, 0.01)` (from DCC tools like Blender using cm units). Always call `box.setFromObject(model)` and normalize to a known size after loading rather than hard-coding `model.scale.setScalar(0.01)`, which breaks if the source model changes.
