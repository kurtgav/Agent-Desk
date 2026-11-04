# ADR-0002: Collector in an Electron utilityProcess, Fastify on 127.0.0.1

- Status: Accepted, 2026-11-05

## Context
Hook ingest must answer quickly: a slow reply costs the Claude session up to `timeout` per event (spike S3: a held hook was cancelled at 2018 ms). Ingest must also keep running when the renderer is busy, and the main process must stay responsive for the tray and toasts.

## Decision
- The collector runs in `utilityProcess.fork()`. It hosts Fastify bound to **127.0.0.1:47821** (D-001), the OTLP receiver, the Reporter API, the agents poller, the reducers, the attention engine and SQLite.
- Main supervises it: on `exit`, main restarts with backoff (0.5 s, 1 s, 2 s … max 30 s) and shows "Collector restarting" in the Live chip. Status flows over a `MessagePort` (port, health, counters).
- Hook routes reply `200` with an empty body **before** any processing (D-029). Work is queued with `setImmediate`. PermissionRequest is held only when remote approvals are on (ADR-0006).
- **Port conflicts:** at start, the collector probes `GET /health` with the token. If the port is taken by something else, it binds the next free port in 47822–47831 and main rewrites our hook URLs (ADR-0005).

## Consequences
- A crashed collector means refused connections, which Claude Code treats as non-blocking errors costing 4–57 ms per hook (S2). There is no data loss for Claude, only a gap in AgentDeck's history; the poll fills in the state after the restart.
- Fastify adds about 1 ms per request; the ingest p95 target is < 20 ms (ARCHITECTURE § 9).
