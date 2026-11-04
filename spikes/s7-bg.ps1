# M0 spike S7: background session hitting a permission prompt; samples `claude agents --json --all` to time state flips.
param(
  [string]$Prompt = 'Use the shell to run exactly: mkdir spikes\scratch\perm-bg . Then reply OK.',
  [int]$Seconds = 40,
  [string]$Label = 's7',
  [string]$Cwd = 'D:\personal\agentdeck',
  [string]$SettingsFile = 'D:\personal\agentdeck\spikes\bg-hooks.json'
)
Get-ChildItem Env: | Where-Object Name -like 'CLAUDE*' | ForEach-Object { Remove-Item -LiteralPath "Env:$($_.Name)" }
$out = 'D:\personal\agentdeck\spikes\out'
New-Item -ItemType Directory -Force $out | Out-Null
Set-Location -LiteralPath $Cwd
$now = { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
$t0 = & $now
$extra = if ($SettingsFile -and $SettingsFile -ne 'none') { @('--settings', $SettingsFile) } else { @() }
$started = claude --bg --name ad-spike --model haiku --permission-mode default @extra $Prompt 2>&1 | Out-String
if ($started -notmatch 'backgrounded \S+ (\w+)') { "no id: $started"; exit 1 }
$id = $Matches[1]
"id=$id started_at=$t0"
$poll = "$out\$Label-poll.log"
Remove-Item $poll -ErrorAction SilentlyContinue
$deadline = $t0 + $Seconds * 1000
while ((& $now) -lt $deadline) {
  $t = & $now
  $row = (claude agents --json --all | ConvertFrom-Json) | Where-Object { $_.id -eq $id }
  "$t status=$($row.status) state=$($row.state) waitingFor=$($row.waitingFor)" | Add-Content $poll
}
(claude logs $id 2>&1 | Out-String -Width 220) -replace '\x1b\[[0-9;?]*[A-Za-z]', '' | Set-Content "$out\$Label-logs.txt"
$ts = & $now
claude stop $id | Out-Null
for ($i = 0; $i -lt 4; $i++) {
  $t = & $now
  $row = (claude agents --json --all | ConvertFrom-Json) | Where-Object { $_.id -eq $id }
  "$t after-stop status=$($row.status) state=$($row.state) waitingFor=$($row.waitingFor)" | Add-Content $poll
}
"stop_at=$ts"
claude rm $id | Out-Null
Get-Content $poll
