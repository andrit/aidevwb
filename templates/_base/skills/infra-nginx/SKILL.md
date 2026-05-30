---
name: infra-nginx
description: Configure nginx as a reverse proxy for the workbench — upstream to mcp-server, SSL termination with Let's Encrypt, rate limiting, static file serving, and WebSocket proxying for the SSE bus stream
domain: infrastructure
type: cross-cutting
triggers:
  - "nginx"
  - "reverse proxy"
  - "SSL"
  - "load balancing"
  - "nginx config"
  - "Let's Encrypt"
  - "certbot"
  - "HTTPS"
  - "WebSocket proxy"
---

# nginx Reverse Proxy

## When to use

When deploying the workbench beyond localhost and you need:
- HTTPS/SSL termination in front of the mcp-server API (port 3100)
- A stable public domain instead of exposing port 3100 directly
- Rate limiting to protect the API from abuse
- Serving static files (exported frontend builds) alongside the API
- Proxying WebSocket / SSE connections for the bus stream (`/bus/:channel/stream`)

Do **not** add nginx for local development — the Docker network already handles routing between containers on `workbench-network`. nginx is a production-layer concern.

## Prerequisites

- A registered domain name with DNS A record pointing to the host's public IP
- Docker and `docker compose` installed on the host
- The workbench running (`make up`) so mcp-server is healthy on port 3100
- Ports 80 and 443 open on the host firewall

## Step 1 — Add nginx and certbot to docker-compose.yml

Append the following services to `docker-compose.yml`. nginx joins the existing `workbench` network so it can reach `mcp-server` by hostname.

```yaml
# ═══════════════════════════════════════════════════════════
#  NGINX — Reverse proxy, SSL termination
# ═══════════════════════════════════════════════════════════
nginx:
  image: nginx:1.25-alpine
  container_name: nginx
  ports:
    - "80:80"
    - "443:443"
  volumes:
    - ./configs/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    - ./configs/nginx/conf.d:/etc/nginx/conf.d:ro
    - certbot-www:/var/www/certbot:ro
    - certbot-certs:/etc/letsencrypt:ro
    - ./apps/static:/var/www/static:ro   # optional: serve exported frontend
  networks:
    - workbench
  depends_on:
    mcp-server:
      condition: service_healthy
  restart: unless-stopped

certbot:
  image: certbot/certbot:latest
  container_name: certbot
  volumes:
    - certbot-www:/var/www/certbot
    - certbot-certs:/etc/letsencrypt
  entrypoint: /bin/sh -c "trap exit TERM; while :; do certbot renew; sleep 12h & wait $${!}; done"
  restart: unless-stopped
```

Add volumes at the bottom of the `volumes:` block:

```yaml
volumes:
  certbot-www:
  certbot-certs:
```

## Step 2 — Base nginx.conf

Create `configs/nginx/nginx.conf`:

```nginx
# configs/nginx/nginx.conf
user  nginx;
worker_processes  auto;
error_log  /var/log/nginx/error.log notice;
pid        /var/run/nginx.pid;

events {
    worker_connections  1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    # ── Logging ──────────────────────────────────────────────
    log_format  main  '$remote_addr - $remote_user [$time_local] "$request" '
                      '$status $body_bytes_sent "$http_referer" '
                      '"$http_user_agent" "$http_x_forwarded_for"';
    access_log  /var/log/nginx/access.log  main;

    sendfile        on;
    keepalive_timeout  65;

    # ── Rate Limiting ─────────────────────────────────────────
    # 60 req/min per IP for the API; burst allows short spikes
    limit_req_zone  $binary_remote_addr  zone=api:10m  rate=60r/m;
    # Tighter zone for ingest (heavy processing)
    limit_req_zone  $binary_remote_addr  zone=ingest:10m  rate=10r/m;

    # ── Upstream ──────────────────────────────────────────────
    upstream mcp_server {
        server mcp-server:3100;
        keepalive 32;
    }

    # ── Include vhosts ────────────────────────────────────────
    include /etc/nginx/conf.d/*.conf;
}
```

## Step 3 — Virtual host config (HTTP → HTTPS redirect + HTTPS server)

Create `configs/nginx/conf.d/workbench.conf`. Replace `your.domain.com` with your actual domain.

```nginx
# configs/nginx/conf.d/workbench.conf

# ── ACME challenge (Let's Encrypt) ────────────────────────────
server {
    listen 80;
    server_name your.domain.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# ── HTTPS main server ─────────────────────────────────────────
server {
    listen 443 ssl;
    http2  on;
    server_name your.domain.com;

    ssl_certificate      /etc/letsencrypt/live/your.domain.com/fullchain.pem;
    ssl_certificate_key  /etc/letsencrypt/live/your.domain.com/privkey.pem;
    ssl_protocols        TLSv1.2 TLSv1.3;
    ssl_ciphers          HIGH:!aNULL:!MD5;
    ssl_session_cache    shared:SSL:10m;
    ssl_session_timeout  10m;
    add_header Strict-Transport-Security "max-age=63072000" always;

    # ── Static files (optional exported frontend) ────────────
    root /var/www/static;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # ── MCP Server API ───────────────────────────────────────
    location /api/ {
        limit_req zone=api burst=20 nodelay;

        proxy_pass         http://mcp_server/;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   Connection        "";    # keep-alive to upstream

        proxy_read_timeout 120s;   # long timeout for scaffold/ingest operations
        proxy_send_timeout 30s;
    }

    # ── Ingest endpoint (slower, tighter rate limit) ──────────
    location /api/projects/ {
        limit_req zone=ingest burst=5 nodelay;

        proxy_pass         http://mcp_server/projects/;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   Connection        "";

        proxy_read_timeout 300s;
        proxy_send_timeout 60s;
    }

    # ── Bus SSE stream (WebSocket / Server-Sent Events) ───────
    # /bus/:channel/stream is a long-lived SSE connection
    location ~ ^/api/bus/([^/]+)/stream$ {
        proxy_pass         http://mcp_server/bus/$1/stream;
        proxy_http_version 1.1;

        # SSE-specific headers — disable buffering so events flow immediately
        proxy_buffering    off;
        proxy_cache        off;
        proxy_read_timeout 3600s;   # hold open for up to 1 hour

        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   Connection        "";

        # SSE response headers
        add_header         Cache-Control     no-cache;
        add_header         X-Accel-Buffering no;
    }

    # ── Health check (no rate limit, no logging) ──────────────
    location /health {
        proxy_pass       http://mcp_server/health;
        access_log       off;
        proxy_set_header Host $host;
    }
}
```

## Step 4 — Obtain the initial certificate

Run certbot once in standalone mode **before** starting the nginx container (it needs port 80 free), or use the webroot method after nginx is up.

```bash
# Option A: standalone (stop nginx first if it's running)
docker run --rm -p 80:80 -v certbot-certs:/etc/letsencrypt \
  certbot/certbot certonly --standalone \
  -d your.domain.com \
  --email you@example.com --agree-tos --non-interactive

# Option B: webroot (nginx already running, serving /.well-known)
docker compose run --rm certbot certonly --webroot \
  -w /var/www/certbot \
  -d your.domain.com \
  --email you@example.com --agree-tos --non-interactive
```

Then start (or restart) nginx:

```bash
docker compose up -d nginx
```

## Step 5 — Verify

```bash
# Test nginx config before reloading
docker compose exec nginx nginx -t

# Reload without downtime after config changes
docker compose exec nginx nginx -s reload

# Confirm HTTPS and SSL grade
curl -I https://your.domain.com/health
# Expect: HTTP/2 200

# Confirm SSE stream proxying
curl -N https://your.domain.com/api/bus/test-channel/stream
# Expect: data: ... lines flowing (or empty stream if no events)

# Confirm rate limit is active
for i in $(seq 1 70); do curl -s -o /dev/null -w "%{http_code}\n" https://your.domain.com/api/health; done
# Expect: 200 for first ~60, then 503 for the burst
```

## Checklist

- [ ] `nginx.conf` and `conf.d/workbench.conf` created under `configs/nginx/`
- [ ] Domain's DNS A record points to the host IP
- [ ] certbot volumes added in `docker-compose.yml`
- [ ] Initial certificate obtained before nginx first start
- [ ] `nginx -t` passes with no errors
- [ ] `https://your.domain.com/health` returns 200
- [ ] SSE stream at `/api/bus/:channel/stream` flows without buffering (`X-Accel-Buffering: no` header present)
- [ ] Rate limiting returns 503 after burst is exhausted (not 499 — that would mean nginx crashed)
- [ ] `Strict-Transport-Security` header present in responses
- [ ] Auto-renewal confirmed: `docker compose exec certbot certbot renew --dry-run`

## Files involved

| File | Action |
|------|--------|
| `docker-compose.yml` | Add `nginx` and `certbot` services, add two volumes |
| `configs/nginx/nginx.conf` | Create: worker config, rate limit zones, upstream block |
| `configs/nginx/conf.d/workbench.conf` | Create: HTTP redirect, HTTPS server, SSE proxy location |

## Common mistakes

**Forgetting `proxy_buffering off` on the SSE location** — nginx buffers upstream responses by default. SSE events will not reach the client until the buffer fills (typically 4–32 KB) or the connection closes. Always set `proxy_buffering off` and `X-Accel-Buffering: no` on any SSE or streaming endpoint.

**Setting `proxy_read_timeout` too short for scaffold/ingest** — scaffold and RAG ingest can take 60–120 seconds. The default nginx `proxy_read_timeout` is 60s. Set it to at least 120s on ingest routes or you'll get silent 504 errors that look like application crashes.

**Running certbot before nginx on the first deploy** — the ACME http-01 challenge requires port 80 to be served by certbot (standalone) or by nginx (webroot). If both try to bind port 80 at once, one fails. Use standalone first, then bring nginx up.

**`Connection: close` leaking through to upstream** — always set `proxy_set_header Connection ""` (empty string, not "close") when using `keepalive` in the upstream block. Without this, nginx sends `Connection: close` which disables keep-alive to upstream even though you configured it.

**Forgetting `http2 on` in the server block** — `listen 443 ssl http2` syntax is deprecated in nginx 1.25+. Use `listen 443 ssl;` + `http2 on;` as separate directives or clients will fall back to HTTP/1.1.
