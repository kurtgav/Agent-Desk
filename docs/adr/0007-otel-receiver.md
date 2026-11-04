# ADR-0007: Built-in OTLP/HTTP-JSON receiver for usage (opt-in, consent-gated)

- Status: Accepted, 2026-11-05 (verified by the OTel spike)

## Context
- Tokens, estimated cost, active time and API errors are only available through Claude Code's OpenTelemetry export (monitoring-usage).
- The spike confirmed:
  - `http/json` works with per-signal endpoints;
  - metrics arrive with DELTA temporality;
  - a receiver that is down is silent (debug log only, no stderr, no delay).
- The docs say the exporter vars are ignored in repo and local settings, are read at startup only, and that "Cost metrics are approximations".

## Decision
- The collector accepts `POST /v1/metrics` and `POST /v1/logs` as `application/json`, requires the token header, and answers 415 for protobuf.
- **Ingest:**
  - The metrics `claude_code.token.usage`, `cost.usage` and `active_time.total` are summed into `usage(day, session, model, type)`.
  - The logs `api_request`, `api_error` and `tool_decision` become events (EVENT_SCHEMA). `tool_decision` also confirms permission outcomes.
  - `user.email`, `user.account_uuid`, `user.account_id`, `organization.id` and `user.id` are **dropped before storage**.
- **Enable flow** (Usage card → "Enable usage"):
  1. Show the exact `env` additions as a diff against the **user** settings file, with the note "applies to Claude sessions started after this".
  2. After your OK, write them through the ADR-0005 writer: backup, atomic write, validate.
  3. The additions are:
     - `CLAUDE_CODE_ENABLE_TELEMETRY=1`
     - `OTEL_METRICS_EXPORTER=otlp`, `OTEL_LOGS_EXPORTER=otlp`
     - `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`
     - `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://127.0.0.1:<port>/v1/metrics`
     - `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://127.0.0.1:<port>/v1/logs`
     - `OTEL_EXPORTER_OTLP_HEADERS=X-AgentDeck-Token=<token>`
     - `OTEL_METRIC_EXPORT_INTERVAL=10000`, `OTEL_LOGS_EXPORT_INTERVAL=2000`
- **These stay installed when AgentDeck quits**, unlike hooks. The spike showed a down receiver is silent, and removing env vars does not reach running sessions anyway.
- If any `OTEL_*` or `CLAUDE_CODE_ENABLE_TELEMETRY` value already exists in a non-AgentDeck form (user env, shell, managed settings), **do not override it**. The Usage card says "Telemetry configured elsewhere" (R21).
- "Disable usage" removes exactly these keys, and only if they still hold our values.
- Every cost figure is labelled **"estimated"** in the UI. The budget bar compares estimated weekly cost against the budget you set.

## Consequences
- Usage figures start from the moment of consent and cover new sessions only.
- Without consent, the Usage card shows the enable prompt and nothing else. No numbers are invented.
