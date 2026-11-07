@echo off
REM Todo Panel Extension Installer
REM This batch file invokes the PowerShell install script

echo ============================================
echo   Todo Panel Extension Installer
echo ============================================
echo.

REM Get the directory of this batch file
set "SCRIPT_DIR=%~dp0"

REM Run PowerShell script
powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%install.ps1"

echo.
if %ERRORLEVEL% EQU 0 (
    echo Installation completed!
) else (
    echo Installation failed with error code %ERRORLEVEL%
)

pause
