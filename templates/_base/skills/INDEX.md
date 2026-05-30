# Skills Index

All 119 skills across the workbench. Paths are relative to `templates/`.

**How to use:** When the user asks for something, scan the "Use when" column for matching phrases. Load the SKILL.md at the listed path and follow its steps.

**Capability contracts:** Each project-type section links to `<type>/capability.json` — the single source of truth for what that capability provides, consumes, and which tools/skills it adds. Used by `make add-capability` and the coordinator skill.

---

## Foundation / DDD
Run these before any new project. `event-storming` is the mandatory first step.

| Skill | Path | Use when |
|-------|------|----------|
| event-storming | `_base/skills/event-storming` | "starting a new project", "domain discovery", "what should we build", "workshop" |
| define-bounded-contexts | `_base/skills/define-bounded-contexts` | "bounded contexts", "service boundaries", "separate domains" |
| design-aggregates | `_base/skills/design-aggregates` | "aggregates", "domain model", "consistency boundary", "root entity" |
| model-domain-events | `_base/skills/model-domain-events` | "domain events", "event modeling", "what happened", "state changes" |
| ubiquitous-language | `_base/skills/ubiquitous-language` | "ubiquitous language", "glossary", "shared vocabulary", "naming" |
| ux-research-methods | `_base/skills/ux-research-methods` | "user research", "user interviews", "usability testing", "discovery" |
| design-system-setup | `_base/skills/design-system-setup` | "design system", "design tokens", "component library", "style guide" |

---

## Architecture
| Skill | Path | Use when |
|-------|------|----------|
| coordinator | `_base/skills/coordinator` | "wire projects together", "connect two projects", "add RAG to my app", "project composition", "provides/consumes" |

---

## Fullstack
Contract: `fullstack/capability.json` · provides: `rest_api`, `web_interface`, `user_auth`, `relational_store`

| Skill | Path | Use when |
|-------|------|----------|
| add-api-endpoint | `fullstack/skills/add-api-endpoint` | "new API route", "add endpoint", "REST endpoint", "HTTP handler" |
| add-database-table | `fullstack/skills/add-database-table` | "new table", "database migration", "add column", "schema change" |
| add-authentication | `fullstack/skills/add-authentication` | "add auth", "JWT", "login", "protected routes", "sessions" |
| write-integration-tests | `fullstack/skills/write-integration-tests` | "integration tests", "API tests", "test endpoints", "test database" |
| error-handling-middleware | `fullstack/skills/error-handling-middleware` | "error handling", "error middleware", "structured errors", "error response format" |
| production-config-and-secrets | `fullstack/skills/production-config-and-secrets` | "production config", "secrets management", "env vars in prod", "12-factor config" |
| setup-health-and-observability | `fullstack/skills/setup-health-and-observability` | "health check", "metrics", "observability", "monitoring", "readiness probe" |
| security-hardening | `fullstack/skills/security-hardening` | "security", "hardening", "OWASP", "input validation", "XSS", "CSRF" |
| storybook-setup | `fullstack/skills/storybook-setup` | "Storybook", "component stories", "UI library", "component catalog" |
| component-types | `fullstack/skills/component-types` | "React component patterns", "HOC", "compound component", "render props", "custom hooks" |
| state-solutions | `fullstack/skills/state-solutions` | "state management", "useState", "Zustand", "Redux", "Jotai", "global state" |
| component-testing | `fullstack/skills/component-testing` | "React Testing Library", "component tests", "test user interactions", "RTL" |

---

## PWA
Contract: `pwa/capability.json` · provides: `offline_support`, `push_notifications`, `installable_web` · consumes: `web_interface`

| Skill | Path | Use when |
|-------|------|----------|
| add-cache-strategy | `pwa/skills/add-cache-strategy` | "cache strategy", "service worker cache", "offline cache", "cache-first", "network-first" |
| setup-push-notifications | `pwa/skills/setup-push-notifications` | "push notifications", "VAPID", "web push", "notification subscription" |
| add-offline-fallback | `pwa/skills/add-offline-fallback` | "offline support", "offline page", "app shell", "queue failed requests" |
| lighthouse-audit-fix | `pwa/skills/lighthouse-audit-fix` | "Lighthouse", "PWA audit", "performance score", "a11y score", "best practices score" |
| production-pwa-deployment | `pwa/skills/production-pwa-deployment` | "deploy PWA", "PWA in production", "service worker in prod", "HTTPS requirements" |

---

## CLI
Contract: `cli/capability.json` · provides: `cli_interface`

| Skill | Path | Use when |
|-------|------|----------|
| add-subcommand | `cli/skills/add-subcommand` | "new subcommand", "add command", "CLI flag", "command handler" |
| add-config-file | `cli/skills/add-config-file` | "config file", "user config", ".rc file", "config discovery", "config hierarchy" |
| publish-package | `cli/skills/publish-package` | "publish npm", "release package", "npm publish", "PyPI", "version bump" |
| cli-production-ux | `cli/skills/cli-production-ux` | "CLI UX", "help text", "error messages", "exit codes", "spinner", "progress bar" |

---

## RAG
Contract: `rag/capability.json` · provides: `hybrid_search`, `document_ingestion`, `search_eval`, `knowledgebase` · consumes: `embedding_service`

| Skill | Path | Use when |
|-------|------|----------|
| ingest-and-validate | `rag/skills/ingest-and-validate` | "ingest documents", "load corpus", "check ingestion", "validate RAG", "/ingest" |
| tune-search-quality | `rag/skills/tune-search-quality` | "search quality", "tune retrieval", "vector weight", "chunk size", "MRR", "improve results" |
| add-data-source | `rag/skills/add-data-source` | "new data source", "ingest API", "ingest database", "new file type", "custom extractor" |
| export-rag-stack | `rag/skills/export-rag-stack` | "export RAG", "deploy RAG", "RAG to production", "export knowledgebase" |
| query-rewriting | `rag/skills/query-rewriting` | "query rewriting", "HyDE", "expand query", "better search queries" |
| source-citation | `rag/skills/source-citation` | "citations", "source attribution", "cite documents", "show sources", "grounded answers" |
| rag-with-conversation-context | `rag/skills/rag-with-conversation-context` | "conversational RAG", "multi-turn search", "chat with docs", "conversation context in search" |
| production-rag-operations | `rag/skills/production-rag-operations` | "RAG in production", "RAG monitoring", "embedding drift", "reindex strategy" |

---

## Agent
Contract: `agent/capability.json` · provides: `agent_reasoning`, `tool_use`, `agent_memory`, `agent_eval` · consumes: `llm_api`, `hybrid_search`

| Skill | Path | Use when |
|-------|------|----------|
| add-agent-tool | `agent/skills/add-agent-tool` | "add tool", "new agent tool", "tool schema", "function calling" |
| write-agent-eval | `agent/skills/write-agent-eval` | "agent eval", "test agent behavior", "behavioral test", "agent_eval", "eval scenarios" |
| add-guardrails | `agent/skills/add-guardrails` | "guardrails", "agent boundaries", "scope limits", "output validation", "safe agent" |
| debug-agent-loop | `agent/skills/debug-agent-loop` | "debug agent", "step through", "agent loop", "hold tool call", "approve reject" |
| connect-external-api | `agent/skills/connect-external-api` | "external API", "HTTP client", "API integration", "REST from agent", "rate limiting" |
| zero-trust-identity | `agent/skills/zero-trust-identity` | "zero trust", "agent identity", "verify agent", "signed requests", "agent auth" |
| design-hitl-checkpoints | `agent/skills/design-hitl-checkpoints` | "human in the loop", "HITL", "approval step", "checkpoint", "human review" |
| setup-circuit-breakers | `agent/skills/setup-circuit-breakers` | "circuit breaker", "agent safety", "halt on failure", "failure threshold", "fallback" |
| production-agent-deployment | `agent/skills/production-agent-deployment` | "deploy agent", "agent in production", "agent ops", "agent lifecycle" |
| llm-cost-and-rate-management | `agent/skills/llm-cost-and-rate-management` | "LLM costs", "token budget", "rate limits", "cost tracking", "prompt caching" |

---

## Multi-Agent
Contract: `multi-agent/capability.json` · provides: `multi_agent_coord`, `message_bus`, `agent_reasoning`, `agent_eval` · consumes: `llm_api`, `hybrid_search`

| Skill | Path | Use when |
|-------|------|----------|
| add-agent-role | `multi-agent/skills/add-agent-role` | "add agent", "new role", "agent team", "specialist agent" |
| switch-orchestration-pattern | `multi-agent/skills/switch-orchestration-pattern` | "orchestration pattern", "sequential to parallel", "hierarchical", "change coordination" |
| debug-inter-agent-comms | `multi-agent/skills/debug-inter-agent-comms` | "debug agent communication", "bus messages", "stuck agent", "message flow" |
| run-multi-agent-eval | `multi-agent/skills/run-multi-agent-eval` | "team eval", "multi-agent test", "team output quality", "coordination test" |
| inter-agent-trust-policy | `multi-agent/skills/inter-agent-trust-policy` | "agent trust", "inter-agent auth", "agent policy", "trust boundaries" |
| multi-agent-failure-handling | `multi-agent/skills/multi-agent-failure-handling` | "agent failure", "team resilience", "agent crash", "retry agent", "fallback agent" |
| production-multi-agent-deployment | `multi-agent/skills/production-multi-agent-deployment` | "deploy multi-agent", "multi-agent ops", "scale agents" |

---

## Microservices
Contract: `microservices/capability.json` · provides: `rest_api`, `service_mesh`, `distributed_tracing`, `infrastructure_as_code`

| Skill | Path | Use when |
|-------|------|----------|
| add-new-service | `microservices/skills/add-new-service` | "new service", "new microservice", "add service", "service Dockerfile" |
| setup-inter-service-comms | `microservices/skills/setup-inter-service-comms` | "service communication", "gRPC", "service mesh", "sync vs async", "inter-service" |
| add-service-observability | `microservices/skills/add-service-observability` | "service metrics", "distributed tracing", "service dashboard", "Prometheus", "OpenTelemetry" |
| production-readiness-review | `microservices/skills/production-readiness-review` | "production readiness", "Susan Fowler checklist", "service standards", "readiness review" |
| add-terraform-module | `microservices/skills/add-terraform-module` | "Terraform module", "infrastructure as code", "new IaC module", "cloud resource" |
| deploy-new-environment | `microservices/skills/deploy-new-environment` | "new environment", "staging environment", "clone environment", "Terraform apply" |
| implement-outbox-pattern | `microservices/skills/implement-outbox-pattern` | "outbox pattern", "transactional outbox", "at-least-once delivery", "dual write" |
| cqrs-read-model | `microservices/skills/cqrs-read-model` | "CQRS", "read model", "projection", "separate read write", "query model" |
| single-writer-principle | `microservices/skills/single-writer-principle` | "single writer", "ownership", "who writes this table", "write authority" |

---

## Data Pipeline
Contract: `data-pipeline/capability.json` · provides: `data_transform`, `stream_processing`, `incremental_load`

| Skill | Path | Use when |
|-------|------|----------|
| add-pipeline-stage | `data-pipeline/skills/add-pipeline-stage` | "new pipeline stage", "add transform", "ETL step", "pipeline node" |
| idempotency-and-incremental-loads | `data-pipeline/skills/idempotency-and-incremental-loads` | "idempotent pipeline", "incremental load", "upsert", "delta load", "dedup" |
| pipeline-failure-recovery | `data-pipeline/skills/pipeline-failure-recovery` | "pipeline failure", "retry pipeline", "dead letter", "error recovery", "backfill" |
| evolve-pipeline-schema | `data-pipeline/skills/evolve-pipeline-schema` | "schema migration", "evolve schema", "change column", "backwards compatible schema" |
| setup-cdc-source | `data-pipeline/skills/setup-cdc-source` | "CDC", "change data capture", "Debezium", "database replication", "WAL" |
| stream-vs-batch-decision | `data-pipeline/skills/stream-vs-batch-decision` | "stream or batch", "real-time vs batch", "streaming pipeline", "batch pipeline decision" |

---

## IoT / ROS2
Contract: `iot/capability.json` · provides: `sensor_data`, `ros2_nodes`, `mqtt_messaging`, `edge_deployment` · consumes: `message_bus`

| Skill | Path | Use when |
|-------|------|----------|
| scaffold-ros2-workspace | `iot/skills/scaffold-ros2-workspace` | "ROS2 workspace", "colcon", "ros2 package", "ament_python", "new ROS2 project" |
| create-ros2-node | `iot/skills/create-ros2-node` | "ROS2 node", "publisher", "subscriber", "ROS2 service", "ROS2 action" |
| ros2-simulation | `iot/skills/ros2-simulation` | "mock hardware", "hardware abstraction", "test without hardware", "mock sensor", "CI for robots" |
| connect-mqtt-broker | `iot/skills/connect-mqtt-broker` | "MQTT", "IoT messaging", "sensor telemetry", "MQTT broker", "paho-mqtt" |
| add-sensor-interface | `iot/skills/add-sensor-interface` | "sensor", "read sensor", "IMU", "lidar", "temperature sensor", "sensor publisher" |
| write-robot-controller | `iot/skills/write-robot-controller` | "robot controller", "cmd_vel", "differential drive", "motor control", "e-stop", "safety layer" |
| add-network-device-interface | `iot/skills/add-network-device-interface` | "SNMP", "netmiko", "network device", "SSH automation", "gNMI", "network monitoring" |
| deploy-to-edge | `iot/skills/deploy-to-edge` | "edge deployment", "Raspberry Pi", "Jetson", "ARM Docker", "systemd", "OTA update" |

---

## Custom / General
| Skill | Path | Use when |
|-------|------|----------|
| setup-project-structure | `custom/skills/setup-project-structure` | "project structure", "new project from scratch", "organize files", "init project" |
| add-mcp-tool-integration | `custom/skills/add-mcp-tool-integration` | "MCP tool", "use workbench tool", "integrate MCP", "call MCP from project" |

---

## Mobile
| Skill | Path | Use when |
|-------|------|----------|
| react-native | `mobile/skills/react-native` | "React Native", "mobile app", "cross-platform mobile", "Expo" |
| mobile-swift-ios | `_base/skills/mobile-swift-ios` | "Swift", "SwiftUI", "iOS app", "Xcode", "iOS development" |
| mobile-kotlin-android | `_base/skills/mobile-kotlin-android` | "Kotlin", "Android", "Jetpack Compose", "Android Studio" |

---

## Language
| Skill | Path | Use when |
|-------|------|----------|
| lang-javascript | `_base/skills/lang-javascript` | "JavaScript", "Node.js", "ESM", "async await", "fetch" |
| lang-typescript | `_base/skills/lang-typescript` | "TypeScript", "Zod", "strict types", "tsconfig", "runtime validation" |
| lang-python | `_base/skills/lang-python` | "Python", "pip", "virtual env", "type hints", "dataclasses" |
| lang-go-cloud | `_base/skills/lang-go-cloud` | "Go", "Golang", "goroutines", "Go modules", "Go for cloud" |
| lang-rust-embedded | `_base/skills/lang-rust-embedded` | "Rust", "embedded Rust", "no_std", "Cargo", "memory safety" |
| lang-elixir-otp | `_base/skills/lang-elixir-otp` | "Elixir", "OTP", "GenServer", "Phoenix", "BEAM" |
| lang-haskell | `_base/skills/lang-haskell` | "Haskell", "functional", "Cabal", "Stack", "typeclasses" |

---

## Animation
| Skill | Path | Use when |
|-------|------|----------|
| anim-css3 | `_base/skills/anim-css3` | "CSS animation", "CSS transition", "keyframes", "CSS transform" |
| anim-gsap | `_base/skills/anim-gsap` | "GSAP", "GreenSock", "ScrollTrigger", "timeline animation", "scroll animation" |
| anim-framer-motion | `_base/skills/anim-framer-motion` | "Framer Motion", "React animation", "AnimatePresence", "motion component" |
| anim-threejs | `_base/skills/anim-threejs` | "Three.js", "WebGL", "3D animation", "3D scene", "canvas 3D" |
| anim-react-three-fiber | `_base/skills/anim-react-three-fiber` | "React Three Fiber", "R3F", "3D in React", "@react-three/fiber" |
| anim-processingjs | `_base/skills/anim-processingjs` | "Processing", "p5.js", "generative art", "creative coding", "canvas sketch" |
| animation-and-motion | `_base/skills/animation-and-motion` | "animation principles", "motion design", "easing", "transition design" |
| vr-react-vr | `_base/skills/vr-react-vr` | "VR", "virtual reality", "React VR", "A-Frame", "WebXR" |

---

## Design / UX
| Skill | Path | Use when |
|-------|------|----------|
| visual-design-principles | `_base/skills/visual-design-principles` | "visual design", "design principles", "Gestalt", "contrast", "visual hierarchy" |
| color-theory-and-systems | `_base/skills/color-theory-and-systems` | "color theory", "color palette", "color tokens", "accessible color", "dark mode" |
| typography-system | `_base/skills/typography-system` | "typography", "fonts", "type scale", "font pairing", "type system" |
| layout-and-composition | `_base/skills/layout-and-composition` | "layout", "grid", "composition", "whitespace", "page layout" |
| ux-principles-and-patterns | `_base/skills/ux-principles-and-patterns` | "UX patterns", "interaction design", "affordances", "mental models", "heuristics" |
| responsive-layout-patterns | `_base/skills/responsive-layout-patterns` | "responsive", "mobile first", "breakpoints", "fluid layout", "media queries" |
| accessibility-implementation | `_base/skills/accessibility-implementation` | "accessibility", "a11y", "ARIA", "screen reader", "WCAG", "keyboard navigation" |

---

## Deployment / Environments
| Skill | Path | Use when |
|-------|------|----------|
| setup-staging-environment | `_base/skills/setup-staging-environment` | "set up staging", "staging environment", "pre-production", "second environment", "test before production" |
| promote-to-production | `_base/skills/promote-to-production` | "go to production", "promote to prod", "production deploy", "release", "ship it", "cutover" |
| environment-config-management | `_base/skills/environment-config-management` | "manage config", "environment variables", "secrets management", "env drift", "new config key", ".env" |

---

## Infrastructure
| Skill | Path | Use when |
|-------|------|----------|
| infra-kafka | `_base/skills/infra-kafka` | "Kafka", "event streaming", "high throughput events", "consumer group", "exactly once" |
| infra-nginx | `_base/skills/infra-nginx` | "Nginx", "reverse proxy", "load balancer", "Nginx config", "rate limiting proxy" |
| infra-elk | `_base/skills/infra-elk` | "ELK", "Elasticsearch", "Logstash", "Kibana", "log aggregation", "full-text search" |
| infra-cloud-services | `_base/skills/infra-cloud-services` | "cloud services", "AWS", "GCP", "Azure", "managed services", "cloud infrastructure" |

---

## Database
| Skill | Path | Use when |
|-------|------|----------|
| db-neo4j | `_base/skills/db-neo4j` | "Neo4j", "graph database", "Cypher", "GraphRAG", "knowledge graph", "entity relationships" |

---

## IoT Platform (base)
| Skill | Path | Use when |
|-------|------|----------|
| iot-ros2 | `_base/skills/iot-ros2` | "ROS2 with workbench API", "robot + RAG", "sensor data to knowledgebase" |
| iot-raspberry-pi-arduino | `_base/skills/iot-raspberry-pi-arduino` | "Raspberry Pi", "Arduino", "GPIO", "embedded Python", "microcontroller" |

---

## CMS / Marketing
| Skill | Path | Use when |
|-------|------|----------|
| cms-wordpress-headless | `_base/skills/cms-wordpress-headless` | "WordPress", "headless CMS", "WPGraphQL", "WordPress + Next.js" |
| cms-shopify-headless | `_base/skills/cms-shopify-headless` | "Shopify", "headless commerce", "Storefront API", "Hydrogen" |
| cms-saleor | `_base/skills/cms-saleor` | "Saleor", "GraphQL commerce", "open source ecommerce" |
| marketing-digital | `_base/skills/marketing-digital` | "SEO", "analytics", "meta tags", "Open Graph", "GTM", "Google Analytics" |

---

## Engines
| Skill | Path | Use when |
|-------|------|----------|
| engine-chrome-v8 | `_base/skills/engine-chrome-v8` | "V8", "Chrome DevTools Protocol", "headless Chrome", "Puppeteer", "browser automation" |
