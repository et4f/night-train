@echo off
chcp 936 >nul
cd /d "%~dp0"
echo.
echo   正在重新打包「单文件版」...
echo.
where node >nul 2>nul
if errorlevel 1 goto nonode
node scripts\05-build-portable.mjs
echo.
echo   完成：夜宿火车-便携版.zip
echo.
pause
goto :eof
:nonode
echo   未找到 Node.js，请先安装 Node.js 18 以上版本。
pause