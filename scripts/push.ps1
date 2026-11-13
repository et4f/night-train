# 用 .token.txt 里的令牌推送（定时任务里没有交互界面，不能靠弹窗登录）
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$tokenFile = Join-Path $root '.token.txt'

if (-not (Test-Path $tokenFile)) {
  Write-Output '  [push] 找不到 .token.txt，跳过推送'
  exit 1
}

$tok = (Get-Content $tokenFile -Raw).Trim()
if (-not $tok) {
  Write-Output '  [push] .token.txt 是空的，跳过推送'
  exit 1
}

$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("et4f:$tok"))
Set-Location $root

& git -c credential.helper= -c "http.extraHeader=Authorization: Basic $b64" push origin main 2>&1 | Out-String | Write-Output
exit $LASTEXITCODE
