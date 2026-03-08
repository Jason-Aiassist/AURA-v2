# AURA Memory Deployment Configuration

**Date:** 2026-03-06  
**Version:** 2.0.0-hello-world  
**Status:** All services healthy ✅

---

## Quick Start

```bash
# Build the Docker image
cd /home/kraythorne/.openclaw/workspace/aura-v2
docker build -f Dockerfile.aura -t aura:super-agent-v2-health .

# Run with correct network configuration
docker run -d \
  --name super-agent \
  --restart unless-stopped \
  --user root \
  -p 18800:18800 \
  -v /home/kraythorne/.openclaw/workspace/aura-v2/agent-config.json:/home/node/.openclaw/agents/main/agent/openclaw.json \
  -v /home/kraythorne/.openclaw/workspace/aura-v2/auth-profiles.json:/home/node/.openclaw/agents/main/agent/auth-profiles.json \
  -v aura-v2-full_super-agent-config:/home/node/.openclaw \
  -v /home/kraythorne/.openclaw/workspace/aura-v2/openclaw-config.json:/home/node/.openclaw/openclaw.json:ro \
  -e GATEWAY_TOKEN=Aura-Super-Agent-2026 \
  -e OPENCLAW_GATEWAY_TOKEN=Aura-Super-Agent-2026 \
  -e OPENCLAW_ALLOW_UNCONFIGURED=1 \
  -e NODE_ENV=production \
  -e MOONSHOT_API_KEY=sk-C3ogviZaBROF6FYatSBwB2TzOtwy7zSXWCgZEjY2bT0dCON2 \
  -e PRIMARY_LLM_MODEL=moonshot/kimi-k2.5 \
  -e PRIMARY_LLM_BASE_URL=https://api.moonshot.ai/v1 \
  -e PRIMARY_LLM_API_KEY=sk-C3ogviZaBROF6FYatSBwB2TzOtwy7zSXWCgZEjY2bT0dCON2 \
  --network openclaw-stable_openclaw-net \
  aura:super-agent-v2-health \
  node openclaw.mjs gateway --allow-unconfigured --bind lan --port 18800
```

---

## ⚠️ CRITICAL: Network Configuration

**The container MUST be connected to the `openclaw-stable_openclaw-net` network to access Neo4j and Ollama services.**

### Verify Network Configuration

```bash
# Check container network
docker inspect super-agent --format='{{range .NetworkSettings.Networks}}{{.NetworkID}} {{.IPAddress}}{{println}}{{end}}'

# Expected output should include:
# openclaw-stable_openclaw-net (or similar ID) with an IP like 172.21.0.x
```

### Health Check Command

```bash
# Run health check from inside the container
docker exec super-agent node openclaw.mjs aura-memory:health
```

**Expected Result:**
```
╔══════════════════════════════════════════════════════════════╗
║           AURA Memory Service Health Checks                  ║
╚══════════════════════════════════════════════════════════════╝

✅ Neo4j Knowledge Graph
   Endpoint: bolt://neo4j-memory:7687
   Status: HEALTHY
   username: neo4j
   database: neo4j

✅ SQLite/sqlite-vec
   Endpoint: /home/node/.openclaw/state/aura/hot/memories.db
   Status: HEALTHY
   sqlite: working
   sqliteVec: not loaded
   path: /home/node/.openclaw/state/aura/hot/memories.db

✅ Ollama Embeddings (nomic-embed-text)
   Endpoint: http://ollama-embed-gpu0:11434
   Status: HEALTHY
   availableModels: 2
   nomicEmbedTextAvailable: true
   model: nomic-embed-text
   dimensions: 768

✅ Code-Weaver LLM (coder_fast)
   Endpoint: https://llm.code-weaver.co.uk/v1
   Status: HEALTHY
   availableModels: 4
   coderFastAvailable: true
   model: coder_fast

──────────────────────────────────────────────────────────────
Summary: 4/4 services healthy
```

### Troubleshooting Network Issues

If services show as **UNHEALTHY**:

1. **Check container network:**
   ```bash
   docker inspect super-agent --format='{{json .NetworkSettings.Networks}}' | jq
   ```

2. **Verify Neo4j is on the network:**
   ```bash
   docker network inspect openclaw-stable_openclaw-net | grep neo4j-memory
   ```

3. **Verify Ollama is on the network:**
   ```bash
   docker network inspect openclaw-stable_openclaw-net | grep ollama
   ```

4. **Connect container to network if missing:**
   ```bash
   docker network connect openclaw-stable_openclaw-net super-agent
   ```

5. **Restart container:**
   ```bash
   docker restart super-agent
   ```

---

## Service Endpoints

| Service | Container | Endpoint | Network |
|---------|-----------|----------|---------|
| Neo4j | neo4j-memory | bolt://neo4j-memory:7687 | openclaw-stable_openclaw-net |
| Ollama GPU0 | ollama-embed-gpu0 | http://ollama-embed-gpu0:11434 | openclaw-stable_openclaw-net |
| Ollama GPU1 | ollama-embed-gpu1 | http://ollama-embed-gpu1:11434 | openclaw-stable_openclaw-net |
| SQLite | super-agent (local) | /home/node/.openclaw/state/aura/hot/memories.db | N/A |
| Code-Weaver | Cloudflare | https://llm.code-weaver.co.uk/v1 | Internet |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NEO4J_URL` | bolt://neo4j-memory:7687 | Neo4j Bolt endpoint |
| `NEO4J_USERNAME` | neo4j | Neo4j username |
| `NEO4J_PASSWORD` | poc-password-123 | Neo4j password |
| `OLLAMA_EMBED_URL` | http://ollama-embed-gpu0:11434 | Ollama embedding endpoint |
| `OLLAMA_EMBED_MODEL` | nomic-embed-text | Embedding model |
| `CODE_WEAVER_URL` | https://llm.code-weaver.co.uk/v1 | LLM API endpoint |
| `CODE_WEAVER_API_KEY` | sk-local | API key for code-weaver |

---

## CLI Commands

```bash
# Check service health
docker exec super-agent node openclaw.mjs aura-memory:health

# Check context injection status
docker exec super-agent node openclaw.mjs aura-memory:context-status

# Check general status
docker exec super-agent node openclaw.mjs aura-memory:status

# Clear cache
docker exec super-agent node openclaw.mjs aura-memory:clear-cache
```

---

## Verification Checklist

Before considering deployment complete, verify:

- [ ] Container is running: `docker ps | grep super-agent`
- [ ] Container is on correct network: `docker inspect super-agent | grep openclaw-stable`
- [ ] Health check shows 4/4 services healthy
- [ ] Neo4j responds: bolt://neo4j-memory:7687
- [ ] Ollama responds: http://ollama-embed-gpu0:11434
- [ ] Code-Weaver responds: https://llm.code-weaver.co.uk/v1
- [ ] SQLite database is created: `/home/node/.openclaw/state/aura/hot/memories.db`
- [ ] Gateway is listening on port 18800
- [ ] Web UI is accessible at http://localhost:18800

---

## Network Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Host                              │
│                                                             │
│  ┌──────────────────┐      ┌──────────────────────────┐    │
│  │  super-agent     │      │  openclaw-stable_        │    │
│  │  (AURA Memory)   │◄────►│  openclaw-net            │    │
│  │  Port: 18800     │      │                          │    │
│  └──────────────────┘      │  ┌──────────────────┐    │    │
│                            │  │ neo4j-memory     │    │    │
│                            │  │ Port: 7687       │    │    │
│                            │  └──────────────────┘    │    │
│                            │                          │    │
│                            │  ┌──────────────────┐    │    │
│                            │  │ ollama-embed-gpu0│    │    │
│                            │  │ Port: 11434      │    │    │
│                            │  └──────────────────┘    │    │
│                            │                          │    │
│                            │  ┌──────────────────┐    │    │
│                            │  │ ollama-embed-gpu1│    │    │
│                            │  │ Port: 11434      │    │    │
│                            │  └──────────────────┘    │    │
│                            └──────────────────────────┘    │
│                                                             │
│  External: https://llm.code-weaver.co.uk/v1                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

**Last Updated:** 2026-03-06  
**Verified By:** Health check showing 4/4 services healthy
