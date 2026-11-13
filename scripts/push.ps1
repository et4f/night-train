# 用 .token.txt 里的令牌推送
# 计划任务里没有交互终端，所以：
#   1) 认证头通过 GIT_CONFIG_* 环境变量传给 git（PowerShell 5.1 会拆坏带空格的命令行参数）
#   2) 关掉终端密码提示，并给 HTTP 设低速超时，避免网络卡住时无限挂起
#   3) 最多重试 3 次；失败也不影响本地已生成的提交，下次运行会一起推上去

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
$env:GIT_CONFIG_COUNT = '2'
$env:GIT_CONFIG_KEY_0 = 'http.extraHeader'
$env:GIT_CONFIG_VALUE_0 = "Authorization: Basic $b64"
$env:GIT_CONFIG_KEY_1 = 'http.lowSpeedLimit'
$env:GIT_CONFIG_VALUE_1 = '1000'

Set-Location $root

$ok = $false
for ($i = 1; $i -le 3; $i++) {
  Write-Output "  [push] 第 $i 次尝试…"
  git -c http.lowSpeedTime=30 push origin main 2>&1 | ForEach-Object { Write-Output $_ }
  if ($LASTEXITCODE -eq 0) { $ok = $true; break }
  Start-Sleep -Seconds 8
}

Remove-Item Env:GIT_CONFIG_COUNT, Env:GIT_CONFIG_KEY_0, Env:GIT_CONFIG_VALUE_0, Env:GIT_CONFIG_KEY_1, Env:GIT_CONFIG_VALUE_1 -ErrorAction SilentlyContinue

if ($ok) {
  Write-Output '  [push] 已推送云端'
  exit 0
} else {
  Write-Output '  [push] 推送失败：网络或令牌问题。本地数据已更新，下次运行会重试；'
  Write-Output '  [push] 也可以手动在项目目录执行 git push origin main'
  exit 1
}
