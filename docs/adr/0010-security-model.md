# ADR-0010: Renderer and endpoint security model

- Status: Accepted, 2026-11-05

## Context
- The collector accepts input that drives approvals.
- The renderer displays untrusted text: commands, model output, file paths.
- A browser on the same machine must not be able to reach the collector (CSRF, DNS rebinding).

## Decision
- **Endpoint**
  - Binds to 127.0.0.1 only.
  - Rejects a request unless its `Host` is exactly `127.0.0.1:<port>`.
  - Rejects any request carrying an `Origin` header. Browsers always send one on cross-origin POSTs; Claude Code's HTTP client sends none (S1). The renderer is served from a custom `app://` protocol, and its fetches are routed via preload, which sets no Origin.
  - Requires `X-AgentDeck-Token` (UI and hooks) and compares it with `timingSafeEqual`.
  - Caps bodies at 1 MB and returns 413 above that.
- **Token:** 32 random bytes in hex, stored in `%APPDATA%\AgentDeck\config.json` (user-only ACL). It is placed in our hook headers and the OTel headers, and rotated by "Repair integration".
- **Renderer**
  - `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`.
  - No `remote` module. Navigation and `window.open` are denied.
  - CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src http://127.0.0.1:<port>; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`.
  - *M1 implementation (2026-11-05):* the app:// handler sends the policy as a `Content-Security-Policy` response header (plus `X-Content-Type-Options: nosniff`); `index.html` repeats it as a `<meta>` for the dev server, which can't carry `frame-ancestors`. `font-src` also allows `data:` because Vite inlines small font files. `connect-src` stays `'self'` until the collector exists (M2 adds the loopback origin). Packaged builds remove the default application menu, so the DevTools and Reload accelerators are gone. `tests/shell.spec.ts` checks the header, blocked inline script and `eval`, denied navigation, popups and permissions.
  - Preload exposes `{port, token, os: {openPath, showItemInFolder}}` through `contextBridge`, plus a typed IPC surface validated with zod in main.
  - *M2 implementation (2026-11-05):* the renderer never talks to the collector (ADR-0002 M2 amendment, D-040), so preload exposes **no port and no token**: only `getAppInfo`, `getSnapshot`, `onSnapshot` and `setDemo` (its argument is zod-checked in main). `connect-src` stays `'self'`. The token lives in `config.json` and in the collector's memory; the M3 installer is its only other reader.
- **Content:** model output and commands render as text. Markdown goes through a sanitizer that allows no raw HTML. Links open only after an explicit click, through `shell.openExternal`, and only for http(s).
- **Actions:** Approve, Reject, Stop and Dispatch need a renderer session nonce issued per window load. Risky approvals and Stop need a confirm step.

## Consequences
- The threat model accepts that a local process running as the same user can read the token. That process could already edit `settings.json`.
- Electron's security checklist is enforced by a unit test over the BrowserWindow options.
