@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start_All_EditFlow_Connections.ps1" %*
exit /b %errorlevel%
