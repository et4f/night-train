@echo off
chcp 936 >nul
cd /d "%~dp0"
echo.
echo   正在注册计划任务「夜宿火车每日更新」——每天 06:30 自动抓取并推送
echo.
schtasks /Create /TN "夜宿火车每日更新" /TR "\"%~dp0scripts\daily-refresh.bat\"" /SC DAILY /ST 06:30 /F
if errorlevel 1 goto fail
echo.
echo   注册成功，现在试跑一次（结果写进 data\last-refresh.log）...
schtasks /Run /TN "夜宿火车每日更新"
timeout /t 3 >nul
echo.
echo   以后想删除这个任务，运行：
echo     schtasks /Delete /TN "夜宿火车每日更新" /F
echo.
pause
exit /b 0
:fail
echo   注册失败。可以右键「以管理员身份运行」再试一次。
pause
exit /b 1