@echo off
rem Fix "Could not register service worker" in QoderCN webviews.
rem Run with QoderCN fully closed (Ctrl+Q), from a normal terminal.
rem Prefer pwsh (PowerShell 7); fall back to the built-in Windows PowerShell 5.1.
set "PS=powershell"
where pwsh >nul 2>&1 && set "PS=pwsh"
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0fix-webview-cache.ps1"
echo.
pause
