# M0 spike helper: one cheap `claude -p` run in spikes/scratch with a clean env and OTel pointed at 47822.
# Usage: pwsh spikes/run-p.ps1 -Label s4-allow -Prompt "..." [-DebugLog]
param([string]$Label, [string]$Prompt, [switch]$DebugLog)
Get-ChildItem Env: | Where-Object Name -like 'CLAUDE*' | ForEach-Object { Remove-Item -LiteralPath "Env:$($_.Name)" }
$env:CLAUDE_CODE_ENABLE_TELEMETRY = '1'
$env:OTEL_METRICS_EXPORTER = 'otlp'
$env:OTEL_LOGS_EXPORTER = 'otlp'
$env:OTEL_EXPORTER_OTLP_PROTOCOL = 'http/json'
$env:OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = 'http://127.0.0.1:47822/v1/metrics'
$env:OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = 'http://127.0.0.1:47822/v1/logs'
$env:OTEL_LOGS_EXPORT_INTERVAL = '1000'
$env:OTEL_METRIC_EXPORT_INTERVAL = '2000'
$out = "D:\personal\agentdeck\spikes\out"
New-Item -ItemType Directory -Force $out | Out-Null
Set-Location D:\personal\agentdeck\spikes\scratch
$cliArgs = @('-p', '--model', 'haiku', '--no-session-persistence', '--permission-mode', 'default',
  '--setting-sources', 'local', '--output-format', 'json')
if ($DebugLog) { $cliArgs += @('--debug-file', "$out\$Label.debug.log") }
$sw = [Diagnostics.Stopwatch]::StartNew()
$result = & claude @cliArgs $Prompt 2>"$out\$Label.stderr.txt"
$sw.Stop()
$result | Out-File -Encoding utf8 "$out\$Label.stdout.json"
"label=$Label elapsed_ms=$($sw.ElapsedMilliseconds)"
try {
  $j = $result | ConvertFrom-Json
  "result: " + $j.result
  "permission_denials: " + ($j.permission_denials | ConvertTo-Json -Compress -Depth 5)
  "cost_usd: " + $j.total_cost_usd
} catch { "raw: $result" }
"stderr: " + (Get-Content "$out\$Label.stderr.txt" -Raw)
