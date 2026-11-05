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

## M1 note (2026-11-05)
M1 has no collector, so the demo snapshot is built in the renderer from a typed module (D-031) and the app always runs in demo mode. "Demo data" shows as a persistent amber status chip in the top bar instead of a banner, so the layout matches the reference; the window title and tray tooltip read "AgentDeck (Demo)". The switcher's "Demo data" item is checked and disabled until M2 adds live mode, at which point this ADR's collector-side design applies unchanged.

## M2 note (2026-11-05)
- **Live is the default (D-043).** The switcher's "Demo data" item is a working checkbox. Main persists `demo` in `config.json`, stops or starts the collector, updates the window title and tray tooltip ("AgentDeck (Demo)" / "AgentDeck") and reloads the window into the other mode.
- Demo data is still the renderer's typed snapshot (D-031). In demo mode **the collector does not run at all**, so no hook, OTLP or poll traffic is accepted and nothing can reach `agentdeck.db`. `tests/live.spec.ts` checks that a live session is still there after a round trip through demo.
- Replaying fixtures into `demo.db` through the reducers moves to M4, when the list pages need demo history beyond the Home snapshot.

## Consequences
- The demo exercises the real pipeline, so the M1 screenshots also smoke-test the reducers.
- There is no path by which demo rows can enter the live database.
