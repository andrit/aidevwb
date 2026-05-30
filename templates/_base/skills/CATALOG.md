# Skills Catalog

This file is Claude's discovery index for all cross-cutting skills. When a user request doesn't match a project-type skill, read this file first to find the right `_base` skill before searching the filesystem.

Two sections: **Index** (what exists and when to use it) and **Graph** (how skills relate to each other).

---

## Part 1 — Index

### Foundation / DDD

| Skill | Path | Use when |
|-------|------|----------|
| Event Storming | `event-storming` | "starting a new project", "domain discovery", "what should we build", "workshop", "big picture" |
| Define Bounded Contexts | `define-bounded-contexts` | "bounded contexts", "context map", "service boundaries", "domain boundaries" |
| Design Aggregates | `design-aggregates` | "aggregate", "domain model", "entity vs value object", "consistency boundary" |
| Model Domain Events | `model-domain-events` | "domain events", "event sourcing", "what happened", "event-driven" |
| Ubiquitous Language | `ubiquitous-language` | "ubiquitous language", "shared vocabulary", "naming", "glossary", "domain terms" |
| UX Research Methods | `ux-research-methods` | "user research", "user interviews", "usability", "personas", "journey map", "jobs to be done" |
| Design System Setup | `design-system-setup` | "design system", "design tokens", "component library", "Storybook", "shadcn", "Radix UI" |

### Design & Visual

| Skill | Path | Use when |
|-------|------|----------|
| Visual Design Principles | `visual-design-principles` | "visual design", "hierarchy", "contrast", "gestalt", "visual weight" |
| Color Theory & Systems | `color-theory-and-systems` | "color palette", "color tokens", "dark mode", "accessible colors", "HSL" |
| Typography System | `typography-system` | "typography", "font scale", "type system", "variable fonts", "line height" |
| Layout & Composition | `layout-and-composition` | "layout", "grid", "spacing scale", "whitespace", "CSS Grid", "flexbox layout" |
| Responsive Layout Patterns | `responsive-layout-patterns` | "responsive", "mobile layout", "breakpoints", "fluid layout", "container queries" |
| UX Principles & Patterns | `ux-principles-and-patterns` | "UX patterns", "interaction design", "affordances", "feedback", "error states", "empty states" |
| Accessibility | `accessibility-implementation` | "accessibility", "a11y", "WCAG", "screen reader", "ARIA", "keyboard navigation" |
| Animation & Motion | `animation-and-motion` | "motion design", "animation principles", "reduced motion", "easing", "choreography" |

### Programming Languages

| Skill | Path | Use when |
|-------|------|----------|
| JavaScript | `lang-javascript` | "javascript", "JS", "node.js", "ESM", "async await", "fetch API" |
| TypeScript | `lang-typescript` | "typescript", "TS", "Zod", "strict types", "tsconfig", "generics" |
| Elixir / OTP | `lang-elixir-otp` | "elixir", "OTP", "GenServer", "supervisor tree", "Phoenix Channels", "actor model", "BEAM" |
| Go | `lang-go-cloud` | "golang", "Go language", "goroutines", "gRPC", "Go microservice", "slog" |
| Rust | `lang-rust-embedded` | "rust", "embedded rust", "no_std", "Embassy", "IoT firmware", "ownership", "WASM" |
| Haskell | `lang-haskell` | "haskell", "functional pipeline", "Aeson", "Conduit", "monads", "pure functions", "type classes" |
| Python | `lang-python` | "python", "asyncio", "pydantic", "httpx", "extend rag worker", "python agent", "ML script" |

### Infrastructure & Services

| Skill | Path | Use when |
|-------|------|----------|
| nginx | `infra-nginx` | "nginx", "reverse proxy", "SSL termination", "load balancing", "Let's Encrypt", "certbot" |
| Kafka | `infra-kafka` | "kafka", "event streaming", "producer consumer", "exactly once", "high throughput events" |
| ELK Stack | `infra-elk` | "ELK", "Elasticsearch", "Logstash", "Kibana", "log aggregation", "centralized logging" |
| Cloud Services | `infra-cloud-services` | "AWS", "GCP", "Azure", "S3", "cloud storage", "Secrets Manager", "IAM", "SQS", "Pub/Sub" |
| Chrome V8 | `engine-chrome-v8` | "V8", "Chrome V8", "embed javascript", "JS isolate", "run JS from C++", "sandboxed scripts" |

### Databases

| Skill | Path | Use when |
|-------|------|----------|
| Neo4j | `db-neo4j` | "Neo4j", "graph database", "Cypher", "GraphRAG", "entity relationships", "knowledge graph" |

### Mobile & Platform

| Skill | Path | Use when |
|-------|------|----------|
| Swift / iOS | `mobile-swift-ios` | "swift", "iOS", "SwiftUI", "iPhone app", "Xcode", "CoreData", "Apple" |
| Kotlin / Android | `mobile-kotlin-android` | "kotlin", "android", "Jetpack Compose", "Android app", "ViewModel", "Room" |
| React Native | `templates/mobile/skills/react-native` | "react native", "Expo", "cross-platform mobile", "iOS and Android", "EAS build" |
| WebXR / React VR | `vr-react-vr` | "VR", "WebXR", "React VR", "immersive", "XR", "virtual reality", "spatial UI" |

### IoT & Robotics

| Skill | Path | Use when |
|-------|------|----------|
| ROS2 | `iot-ros2` | "ROS2", "robot", "ROS", "ros2 node", "robotic operating system", "ros2 topic" |
| Raspberry Pi + Arduino | `iot-raspberry-pi-arduino` | "Raspberry Pi", "Arduino", "GPIO", "I2C", "microcontroller", "IoT hardware", "MQTT sensor" |

### CMS & Commerce

| Skill | Path | Use when |
|-------|------|----------|
| Headless WordPress | `cms-wordpress-headless` | "WordPress", "headless WordPress", "WPGraphQL", "ACF", "WordPress API", "wp-json" |
| Headless Shopify | `cms-shopify-headless` | "Shopify", "headless Shopify", "Storefront API", "Hydrogen", "e-commerce", "cart" |
| Saleor | `cms-saleor` | "Saleor", "open source commerce", "saleor API", "self-hosted commerce" |

### Animation & 3D

| Skill | Path | Use when |
|-------|------|----------|
| GSAP | `anim-gsap` | "GSAP", "GreenSock", "ScrollTrigger", "timeline animation", "scroll animation", "tween" |
| Framer Motion | `anim-framer-motion` | "Framer Motion", "motion", "React animation", "AnimatePresence", "layout animation", "variants" |
| p5.js / Processing | `anim-processingjs` | "Processing", "p5.js", "generative art", "canvas animation", "creative coding", "noise field" |
| CSS3 Animation | `anim-css3` | "CSS animation", "keyframes", "CSS transitions", "scroll-driven", "View Transitions", "@property" |
| Three.js | `anim-threejs` | "Three.js", "ThreeJS", "WebGL", "3D scene", "GLTF", "3D web", "shader", "EffectComposer" |
| React Three Fiber | `anim-react-three-fiber` | "React Three Fiber", "R3F", "@react-three/fiber", "drei", "3D React", "useFrame" |

### Marketing

| Skill | Path | Use when |
|-------|------|----------|
| Digital Marketing | `marketing-digital` | "Google Analytics", "GA4", "GTM", "SEO", "digital marketing", "conversion tracking", "A/B test", "structured data", "Core Web Vitals" |

---

## Part 2 — Skill Graph

Skills are not isolated. This graph captures the relationships between them so Claude can surface relevant adjacent skills, ask better disambiguation questions, and recommend coherent combinations.

### Relationship types

| Type | Meaning |
|------|---------|
| **extends** | B builds directly on A — learn A first, B is a layer on top |
| **alternative** | A and B solve the same problem differently — choose one |
| **complements** | A and B are commonly used together and each makes the other more useful |
| **prereq** | A must be in place before B is useful |
| **conflicts** | Using A and B together creates friction or redundancy |

### Edge Table

| From | Rel | To | Notes |
|------|-----|----|-------|
| `anim-react-three-fiber` | extends | `anim-threejs` | R3F is Three.js as React components; learn Three.js concepts first |
| `anim-threejs` | complements | `vr-react-vr` | Three.js is the rendering engine underlying WebXR scenes |
| `anim-react-three-fiber` | complements | `vr-react-vr` | @react-three/xr wraps R3F for immersive sessions |
| `anim-gsap` | alternative | `anim-framer-motion` | GSAP for timeline/scroll/SVG; Framer Motion for React component state transitions |
| `anim-gsap` | complements | `anim-css3` | CSS handles simple transitions; GSAP takes over for sequencing and ScrollTrigger |
| `anim-processingjs` | alternative | `anim-threejs` | p5 for 2D generative/canvas; Three.js for 3D WebGL scenes |
| `anim-react-three-fiber` | complements | `anim-framer-motion` | R3F owns the 3D canvas; Framer Motion owns the 2D React UI overlay |
| `lang-typescript` | complements | `lang-javascript` | TypeScript is typed JavaScript — same runtime, stronger tooling |
| `lang-typescript` | complements | `anim-react-three-fiber` | R3F is TS-first; typed scene graphs catch errors at compile time |
| `lang-typescript` | complements | `mobile-react-native` | Expo/RN are TS-first; Zod validates API responses from the workbench |
| `lang-elixir-otp` | complements | `infra-kafka` | Both model message-passing; OTP for in-process concurrency, Kafka for cross-service |
| `lang-elixir-otp` | alternative | `infra-kafka` | For intra-service pub/sub, OTP GenServer + PubSub replaces Kafka entirely |
| `lang-go-cloud` | complements | `infra-kafka` | Go is idiomatic for high-throughput Kafka consumers; goroutine per partition |
| `lang-go-cloud` | complements | `infra-cloud-services` | Go cloud SDKs (GCS, SQS, Pub/Sub) are first-class; patterns align with lang-go-cloud |
| `lang-rust-embedded` | complements | `iot-ros2` | Rust for real-time firmware; ROS2 for high-level robot coordination |
| `lang-rust-embedded` | complements | `iot-raspberry-pi-arduino` | Rust on bare metal (Arduino) + Tokio on RPi; the two levels of the same stack |
| `lang-python` | complements | `iot-ros2` | rclpy is the standard ROS2 Python client; most ROS2 nodes are Python |
| `lang-python` | extends | `db-neo4j` | py2neo / neo4j-driver-python used inside the rag-worker for GraphRAG |
| `db-neo4j` | extends | `rag` skills | GraphRAG = pgvector hybrid search + Neo4j entity traversal; Neo4j augments RAG, not replaces it |
| `db-neo4j` | prereq | `lang-typescript` | neo4j-driver is the TS/JS client; TypeScript typing for Cypher results prevents runtime errors |
| `infra-elk` | complements | `infra-kafka` | Standard pipeline: app → Kafka topic → Logstash consumer → Elasticsearch index |
| `infra-elk` | alternative | workbench Grafana/Tempo | ELK for log analytics; Grafana+Tempo for distributed traces — not the same thing, often coexist |
| `infra-nginx` | complements | `infra-cloud-services` | nginx for on-prem or self-hosted; cloud load balancer replaces nginx in pure cloud deploys |
| `infra-kafka` | alternative | workbench Redis bus | Redis bus for dev/moderate load (<10K msg/s); Kafka when volume, durability, or replay matters |
| `mobile-react-native` | alternative | `mobile-swift-ios` + `mobile-kotlin-android` | RN for one codebase cross-platform; native for platform-specific UI or hardware access |
| `mobile-swift-ios` | alternative | `mobile-kotlin-android` | iOS-only vs Android-only |
| `mobile-react-native` | complements | `lang-typescript` | RN projects are TS by default; Zod validates workbench API responses |
| `cms-shopify-headless` | alternative | `cms-saleor` | Shopify = hosted SaaS commerce; Saleor = self-hosted open-source commerce |
| `cms-wordpress-headless` | alternative | `cms-shopify-headless` | WP for content-first sites; Shopify for commerce-first — often combined (WP content + Shopify cart) |
| `cms-wordpress-headless` | complements | `cms-shopify-headless` | Buy button or cart on a WP editorial site — WPGraphQL for content, Storefront API for cart |
| `cms-saleor` | complements | `infra-nginx` | Saleor self-hosted needs nginx reverse proxy for SSL + API routing |
| `design-system-setup` | prereq | `anim-framer-motion` | Design tokens (semantic colors, spacing) should exist before animating component state |
| `design-system-setup` | prereq | `anim-gsap` | Consistent motion tokens (easing curves, durations) should come from the design system |
| `ux-research-methods` | prereq | `design-system-setup` | User research identifies the UI patterns; design system encodes them |
| `event-storming` | prereq | `define-bounded-contexts` | Event storm produces the raw domain events; context mapping organizes them into boundaries |
| `define-bounded-contexts` | prereq | `design-aggregates` | Context boundaries define scope; aggregates live inside a context |
| `lang-elixir-otp` | complements | multi-agent skills | GenServer maps to an agent actor; DynamicSupervisor maps to a multi-agent team |
| `marketing-digital` | complements | `anim-css3` | CSS View Transitions and scroll-driven animations directly affect Core Web Vitals scores |
| `marketing-digital` | prereq | `design-system-setup` | Structured data (JSON-LD) references brand identity; design system tokens should be stable first |
| `engine-chrome-v8` | complements | `lang-javascript` | V8 is the engine that runs JavaScript; understanding V8 explains JS performance behaviour |

---

## Part 3 — Combination Recipes

Common multi-skill stacks that appear together in real projects. When any one skill in a recipe is mentioned, Claude should ask whether the full combination applies.

| Recipe | Skills involved | Typical use case |
|--------|----------------|-----------------|
| **Immersive 3D web** | `anim-threejs` + `anim-react-three-fiber` + `vr-react-vr` + `lang-typescript` | Interactive 3D site or WebXR experience |
| **Animated React app** | `anim-framer-motion` + `anim-css3` + `design-system-setup` + `lang-typescript` | UI-heavy SPA with polished transitions |
| **GraphRAG pipeline** | `db-neo4j` + `lang-python` + `lang-typescript` | RAG with entity-relationship traversal |
| **IoT sensor stack** | `iot-raspberry-pi-arduino` + `iot-ros2` + `lang-rust-embedded` + `infra-kafka` | Sensor → firmware → robot coordination → event stream |
| **Headless commerce** | `cms-shopify-headless` + `cms-wordpress-headless` + `infra-nginx` + `anim-gsap` | Editorial site with integrated e-commerce |
| **Cloud microservice** | `lang-go-cloud` + `infra-kafka` + `infra-cloud-services` + `infra-nginx` | High-throughput backend service on GCP/AWS |
| **Concurrent agent system** | `lang-elixir-otp` + `infra-kafka` + `db-neo4j` | Multi-agent system with persistent entity memory |
| **Cross-platform mobile** | `mobile-react-native` + `lang-typescript` + `infra-cloud-services` | iOS + Android from one codebase with cloud backend |
| **DDD project foundation** | `event-storming` → `define-bounded-contexts` → `design-aggregates` → `model-domain-events` → `ubiquitous-language` → `ux-research-methods` → `design-system-setup` | Mandatory before any new project |
| **Marketing-ready PWA** | `marketing-digital` + `anim-css3` + `design-system-setup` + `responsive-layout-patterns` + `accessibility-implementation` | SEO + performance + a11y from day one |

---

## How to Use This File

**Finding the right skill:** Search Part 1 by trigger phrase. If you match multiple rows, read Part 2 to understand whether they're alternatives (pick one) or complements (use both).

**Disambiguation pattern:** When a user request matches two or more skills in the same "alternative" relationship, ask: *"For animation — are you looking for scroll/timeline effects (GSAP), React component transitions (Framer Motion), or 3D scenes (Three.js / R3F)?"*

**Recommending combinations:** When a user mentions one skill in a recipe (Part 3), ask whether the full combination applies before reading just the single skill.

**Reading a skill:** Once the right skill is identified, read `templates/_base/skills/<name>/SKILL.md` for the full procedural checklist.
