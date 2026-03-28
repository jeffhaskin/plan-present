# Network Filtering Spike نتائج

Date: 2026-03-28

## Environment
- Hostname tailscale IP (from `tailscale ip -4`): `100.67.44.18`
- Public IP (from `hostname -I`): `212.28.191.53`

## Dev Mode (filter bypass)
Command:
```
NODE_ENV=development npx tsx src/server/index.ts
```
Test:
```
curl -s http://127.0.0.1:7979/health
```
Result: **200 OK** (JSON health payload returned)

## Production Mode (filter enforced)
Command:
```
NODE_ENV=production npx tsx src/server/index.ts
```

### Tailscale IP
Test:
```
curl -s http://100.67.44.18:7979/health
```
Result: **200 OK** (JSON health payload returned)

### Non-Tailscale IP
Test:
```
curl -s -o /dev/null -w "%{http_code}\n" http://212.28.191.53:7979/health
```
Result: **403** (blocked as expected)

## Verdict
Filtering works as intended on this VPS: dev mode bypasses, Tailscale CGNAT range is allowed, and non-Tailscale source is rejected with 403.
