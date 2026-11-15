## What and why

<!-- One change per PR. What does it do, and what problem does it solve? Link the issue if there is one. -->

## How I checked it

<!-- Commands you ran, screens you opened, a real Claude Code session you tried. Paste the result of `npm run check` or say what you could not run. -->

## Checklist

- [ ] `npm run check` passes (typecheck, lint, unit tests, smoke tests)
- [ ] A bug fix has a test that fails without it
- [ ] No network call, telemetry, model call, or automatic approval was added ([the three rules](https://github.com/kurtgav/Agent-Desk/blob/main/CONTRIBUTING.md#the-invariants-do-not-break-these))
- [ ] Anything captured from a real session is redacted (no tokens, user names or private paths)
- [ ] A new default or choice has a row in `docs/DECISIONS.md`; a new risk is in `docs/RISKS.md`; a new Claude Code dependency is in `docs/COMPATIBILITY.md`
- [ ] User-visible changes are in `CHANGELOG.md` under Unreleased
- [ ] UI changes: screenshots attached, and no control that does nothing
