@echo off
chcp 936 >nul
cd /d "%~dp0.."
set "LOG=%~dp0..\data\last-refresh.log"
echo. >> "%LOG%"
echo ===== %date% %time% ===== >> "%LOG%"
node scripts\01-fetch-index.mjs >> "%LOG%" 2>&1
if errorlevel 1 goto fail
node scripts\02-fetch-schedules.mjs >> "%LOG%" 2>&1
node scripts\03-build.mjs >> "%LOG%" 2>&1
if errorlevel 1 goto fail
node scripts\07-build-docs.mjs >> "%LOG%" 2>&1
git add data/app.json docs >> "%LOG%" 2>&1
git diff --cached --quiet
if not errorlevel 1 goto nopush
git commit -m "chore: 每日更新时刻表" >> "%LOG%" 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\push.ps1" >> "%LOG%" 2>&1
echo 已推送云端 >> "%LOG%"
goto done
:nopush
echo 数据没有变化，跳过提交 >> "%LOG%"
:done
echo [%time%] 完成 >> "%LOG%"
exit /b 0
:fail
echo [%time%] 抓取失败，详见上方日志 >> "%LOG%"
exit /b 1