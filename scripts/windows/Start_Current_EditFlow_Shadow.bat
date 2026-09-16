@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start_Current_EditFlow_Shadow.ps1"
exit /b %errorlevel%
