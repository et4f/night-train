# Push with the token stored in .token.txt
# (ASCII only: Windows PowerShell 5.1 reads BOM-less files as ANSI and chokes on non-ASCII)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$tokenFile = Join-Path $root '.token.txt'

if (-not (Test-Path $tokenFile)) {
  Write-Output '  [push] .token.txt not found, skip push'
  exit 1
}

$tok = (Get-Content $tokenFile -Raw).Trim()
if (-not $tok) {
  Write-Output '  [push] .token.txt is empty, skip push'
  exit 1
}

$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("et4f:$tok"))

$env:GIT_TERMINAL_PROMPT = '0'
$env:GIT_ASKPASS = ''
$env:GIT_CONFIG_COUNT = '2'
$env:GIT_CONFIG_KEY_0 = 'http.extraHeader'
$env:GIT_CONFIG_VALUE_0 = "Authorization: Basic $b64"
$env:GIT_CONFIG_KEY_1 = 'http.lowSpeedLimit'
$env:GIT_CONFIG_VALUE_1 = '1000'

Set-Location $root

$ok = $false
for ($i = 1; $i -le 3; $i++) {
  Write-Output "  [push] attempt $i"
  # credential.helper= must be cleared, otherwise GCM overrides the auth header
  git -c credential.helper= -c http.lowSpeedTime=30 push origin main 2>&1 | ForEach-Object { Write-Output $_ }
  if ($LASTEXITCODE -eq 0) { $ok = $true; break }
  Start-Sleep -Seconds 8
}

Remove-Item Env:GIT_CONFIG_COUNT, Env:GIT_CONFIG_KEY_0, Env:GIT_CONFIG_VALUE_0, Env:GIT_CONFIG_KEY_1, Env:GIT_CONFIG_VALUE_1 -ErrorAction SilentlyContinue

if ($ok) {
  Write-Output '  [push] PUSHED'
  exit 0
} else {
  Write-Output '  [push] PUSH FAILED (local commit kept, next run will retry)'
  exit 1
}