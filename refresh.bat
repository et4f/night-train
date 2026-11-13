@echo off
chcp 936 >nul
cd /d "%~dp0"
echo ============================================
echo   更新 12306 时刻表数据（约 3-5 分钟）
echo ============================================
echo.
echo [1/4] 抓取车次索引...
node scripts\01-fetch-index.mjs
echo.
echo [2/4] 抓取每趟车经停时刻（可断点续传，中断后重跑本脚本即可）...
node scripts\02-fetch-schedules.mjs
echo.
echo [3/4] 生成前端数据集...
node scripts\03-build.mjs
echo.
echo [4/4] 重建 docs（GitHub Pages 用的目录）...
node scripts\07-build-docs.mjs
echo.
echo 完成。要发给别人请再运行 package.bat。
pause