# ═══════════════════════════════════════════════════════════
# MCP Server — TypeScript + Fastify + Zod
# API orchestration layer: REST endpoints + MCP stdio bridge
# ═══════════════════════════════════════════════════════════
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src/ ./src/

RUN npm run build

# ── Production stage ──────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache wget

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 3100

CMD ["node", "dist/index.js"]
