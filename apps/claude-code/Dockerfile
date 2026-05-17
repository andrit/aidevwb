# ═══════════════════════════════════════════════════════════
# Claude Code container with Python toolchain + MCP bridge
# Base: official Anthropic image (Node.js + Claude Code CLI)
# Added: Python 3.12, MCP bridge for workbench tools
# ═══════════════════════════════════════════════════════════
FROM ghcr.io/anthropics/claude-code:latest

USER root

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.12 \
    python3.12-venv \
    python3-pip \
    curl \
    wget \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Minimal Python packages for direct script execution
RUN pip install --no-cache-dir --break-system-packages \
    httpx \
    python-dotenv

# Install MCP bridge (stdio ↔ HTTP proxy to mcp-server)
COPY configs/mcp/bridge/package.json configs/mcp/bridge/index.js /opt/mcp-bridge/
RUN cd /opt/mcp-bridge && npm install --omit=dev 2>/dev/null && chown -R user:user /opt/mcp-bridge

USER user

WORKDIR /workspace

ENTRYPOINT ["claude"]
