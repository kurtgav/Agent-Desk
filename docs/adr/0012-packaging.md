# ADR-0012: electron-builder NSIS installer, per-user, no admin

- Status: Accepted, 2026-11-05

## Decision
- electron-builder `nsis` target: `oneClick: true`, `perMachine: false`, `allowElevation: false`. It installs to `%LOCALAPPDATA%\Programs\AgentDeck`, with Start menu and desktop shortcuts.
- `appId` / AppUserModelID is `com.thirdcode.agentdeck`. It is set in main via `app.setAppUserModelId` so toasts work (R19).
- **Autostart:** `app.setLoginItemSettings({openAtLogin: true})` on the first run, toggled from Settings. "Start minimized" is off by default and passes `--hidden`.
- **Uninstaller:** a `customUnInstall` NSIS macro runs `"$INSTDIR\AgentDeck.exe" --uninstall-integration` and waits up to 10 s. That command removes only our hook and OTel entries (ADR-0005, ADR-0007) and exits without opening a window. App data stays unless you tick "Delete AgentDeck data".
- No code-signing certificate in v1. SmartScreen will warn, and the README says so. Auto-update is off (ADR-0009).
- CI on `windows-latest`:
  1. `npm ci`
  2. typecheck, lint, Vitest
  3. `electron-builder --dir`
  4. Playwright-Electron smoke test against the unpacked build

## Consequences
- No admin rights at any point.
- Uninstalling leaves `settings.json` exactly as it would be without AgentDeck.
