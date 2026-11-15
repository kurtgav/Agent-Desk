# Quality bar

"Polished and established" is a list of things that are checked on every change, not a feeling. A change is not done until its gates are green. Gates marked *planned* are the work of milestone M8 or M9 in `ROADMAP.md`.

## Gates on every pull request (CI, Windows runner)

| Gate | Rule | State |
|---|---|---|
| Typecheck, lint | zero errors, zero warnings | shipped |
| Unit and integration tests | all pass; at least 80% of new lines covered, with a coverage report in the run | tests shipped, coverage report planned |
| Electron smoke | every page renders in demo data, light and dark; axe finds no WCAG 2.x A/AA violation; keyboard path works | shipped (light), dark planned in CI |
| Packaged-app smoke | the unpacked app starts its collector from inside `app.asar`; Tasks, Report, Settings open | shipped |
| Uninstall integrity | `--uninstall-integration` removes only AgentDeck's entries and leaves everything else byte for byte | shipped |
| **No network** | a smoke run with all outbound traffic blocked finds zero attempted connections other than loopback | planned |
| Performance budgets | idle memory <= 300 MB (five processes, real-size data); time to interactive <= 2 s on the CI runner; hook ingest p95 < 20 ms; event to screen p95 < 1 s; renderer script <= 300 KB gzipped | hook and screen budgets shipped, memory (R52) and size planned |
| Parser fuzzing | the hook, OTLP, stream-json, frontmatter and markdown parsers survive property-based and hostile inputs without throwing or hanging | partly shipped, fuzz suite planned |
| Dependencies | no high or critical advisory in what ships; licences all permissive; lockfile consistent | audit and licence list shipped |
| Visual regression | key screens compared against stored screenshots, light and dark, 1200 and 1440 wide | planned |

## Reliability rules in the code

- Every page sits under an error boundary with a recovery card and a "Copy diagnostics" button; a crash in one page never takes the window down.
- The main process logs unhandled errors to the local log folder and tells the user once, in plain words.
- The collector restarts itself with backoff and the UI says so (shipped, D-059).
- Every IPC input is validated at the boundary; every file read has a size cap; every spawn is an argument array with a timeout (shipped).
- No action fails silently: each returns a result the UI shows.

## Release rules

- Semantic versioning, one `CHANGELOG.md` entry per release, a tag per release.
- The release workflow builds from the tag, publishes the installer with `SHA256SUMS.txt`, and (planned) a build-provenance attestation and an SBOM.
- The installer is code-signed (planned: the SignPath Foundation's free signing for open-source projects, or Azure Trusted Signing). Until then SmartScreen warns, and the README says why and how to verify.
- No auto-update in v1: AgentDeck makes no network requests. "Check for updates" opens the Releases page in the browser, which is the user's action.

## Community rules

`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue and PR templates exist. Planned: `GOVERNANCE.md` (who decides, how), labelled starter issues, GitHub Discussions on, a response-time promise in `SUPPORT.md`, and a docs site built from `docs/`.
