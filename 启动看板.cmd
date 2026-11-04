@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1"
if errorlevel 1 (
    pause
    exit /b 1
)
start "" "http://127.0.0.1:5173"
