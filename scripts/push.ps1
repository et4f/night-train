# 用 .token.txt 里的令牌推送
# 计划任务里没有交互终端，所以：
#   1) 认证头通过 GIT_CONFIG_* 环境变量传给 git（比命令行传参可靠，PowerShell 5.1 会拆坏带空格的参数）
#   2) 关掉终端密码提示，失败就立刻返回，不会卡住

$ErrorActionPreference = 'Continue'
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

$env:GIT_TERMINAL_PROMPT = '0'
$env:GIT_ASKPASS = ''
$env:GIT_CONFIG_COUNT = '1'
$env:GIT_CONFIG_KEY_0 = 'http.extraHeader'
$env:GIT_CONFIG_VALUE_0 = "Authorization: Basic $b64"

Set-Location $root
git push origin main 2>&1 | ForEach-Object { Write-Output $_ }
$code = $LASTEXITCODE

Remove-Item Env:GIT_CONFIG_COUNT, Env:GIT_CONFIG_KEY_0, Env:GIT_CONFIG_VALUE_0 -ErrorAction SilentlyContinue
exit $code
