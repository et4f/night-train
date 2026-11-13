@echo off
chcp 936 >nul
cd /d "%~dp0"
echo.
echo   夜宿火车 · 正在启动本地服务...
echo   浏览器会自动打开；关掉这个黑窗口就退出。
echo.
start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:8787"
node server\server.mjs
if errorlevel 1 goto fail
goto :eof
:fail
echo.
echo   启动失败：请确认已安装 Node.js 18 以上版本。
pause
