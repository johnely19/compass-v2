# OpenClaw Gateway HTTP API — Chat→OpenClaw Integration

## The Problem

When calling `/v1/chat/completions` with just a bearer token, the gateway returns:

```json
{"ok":false,"error":{"type":"forbidden","message":"missing scope: operator.write"}}
```

## Root Cause

The gateway's OpenAI-compatible HTTP surface resolves operator scopes from the
`x-openclaw-scopes` request header — **not** from the bearer token alone.

When no `x-openclaw-scopes` header is sent, the scopes array is empty and the
method-level scope check fails (chat completions requires `operator.write`,
models listing requires `operator.read`).

## The Fix

Include the `x-openclaw-scopes` header in every HTTP API request:

```
x-openclaw-scopes: operator.read,operator.write
```

## Working Examples

### List models

```bash
curl -sS http://127.0.0.1:18789/v1/models \
  -H 'Authorization: Bearer <GATEWAY_TOKEN>' \
  -H 'x-openclaw-scopes: operator.read,operator.write'
```

### Chat completion (non-streaming)

```bash
curl -sS http://127.0.0.1:18789/v1/chat/completions \
  -H 'Authorization: Bearer <GATEWAY_TOKEN>' \
  -H 'x-openclaw-scopes: operator.read,operator.write' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "openclaw/default",
    "messages": [{"role":"user","content":"hello"}]
  }'
```

### Chat completion (streaming)

```bash
curl -N http://127.0.0.1:18789/v1/chat/completions \
  -H 'Authorization: Bearer <GATEWAY_TOKEN>' \
  -H 'x-openclaw-scopes: operator.read,operator.write' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "openclaw/default",
    "stream": true,
    "messages": [{"role":"user","content":"hello"}]
  }'
```

### Via Tailscale Funnel

Same requests, but use the Tailscale hostname:

```bash
curl -sS https://johns-mac-mini.tail7b8c49.ts.net/v1/chat/completions \
  -H 'Authorization: Bearer <GATEWAY_TOKEN>' \
  -H 'x-openclaw-scopes: operator.read,operator.write' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "openclaw/default",
    "messages": [{"role":"user","content":"hello"}]
  }'
```

## Agent Routing

The `model` field routes to OpenClaw agents, not raw provider models:

- `openclaw` or `openclaw/default` → default agent
- `openclaw/main` → the "main" agent
- `openclaw/<agentId>` → specific agent

To override the backend LLM model, use the `x-openclaw-model` header:

```
x-openclaw-model: anthropic/claude-sonnet-4-6
```

## Gateway Config (already set)

```json
{
  "gateway": {
    "http": {
      "endpoints": {
        "chatCompletions": { "enabled": true }
      }
    }
  }
}
```

## Verified

- ✅ `GET /v1/models` returns agent list (openclaw, openclaw/default, openclaw/main)
- ✅ `POST /v1/chat/completions` returns valid completions locally
- ⚠️ Tailscale Funnel has a TLS handshake issue (pre-existing, unrelated to this fix)
