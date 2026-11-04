# ADR-0001: Application stack

- Status: Accepted, 2026-11-05 (decided in the brief)

## Context
AgentDeck is a local Windows desktop app with a tray icon, toasts, autostart and a native installer. It has a rich dashboard UI, and the code should stay portable to macOS and Linux later.

## Decision
- **Electron + electron-vite**, with three entry points: main, preload, renderer. The collector is a fourth entry bundled for `utilityProcess` (ADR-0002).
- **React + TypeScript with `strict`** in every package (`noUncheckedIndexedAccess` on).
- **Tailwind + shadcn/ui (Radix)** for accessible primitives. Tokens are CSS variables (UI_MAP § Layout tokens).
- **Zustand** for renderer state. One store fed by SSE patches.
- **zod** at every boundary: hook body, OTLP body, Reporter body, poll output, IPC, settings.json.
- **npm** with a lockfile. Vitest for unit and integration tests, Playwright-Electron for the smoke test.
- Fonts and icons are bundled locally: Inter and lucide-react. No remote content.

## Consequences
- Electron's footprint (~150 MB RAM baseline) leaves about 150 MB headroom under the 300 MB budget. The renderer must virtualize long lists.
- Native modules (better-sqlite3) need an Electron rebuild (R15).
