# ADR-0011: Demo mode with seeded fixtures, never mixed with live data

- Status: Accepted, 2026-11-05

## Context
M1 needs the Home screen built and matched against the reference before live data exists. Demos and screenshots must never show fabricated numbers as if they were real.

## Decision
- Demo mode is a toggle in the switcher menu. It is persisted, and off by default in packaged builds.
- When it is on, the collector opens `%APPDATA%\AgentDeck\demo.db` instead of `agentdeck.db`.
- Demo mode seeds that database by replaying event fixtures through the **same reducers**: the real S1 payloads, plus hand-written docs-derived ones, with timestamps shifted to "now".
- Demo mode serves **no** hook, OTLP or poll traffic. It never touches `settings.json`.
- The UI shows a persistent amber "Demo data" banner. The window title and tray tooltip carry "(Demo)", and toasts are suppressed.
- Switching modes restarts the collector against the other file, so there is no shared in-memory state.

## Consequences
- The demo exercises the real pipeline, so the M1 screenshots also smoke-test the reducers.
- There is no path by which demo rows can enter the live database.
