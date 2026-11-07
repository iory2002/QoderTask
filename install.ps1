#!/usr/bin/env pwsh
# Jira Board Extension Installer
# Builds, packages, and installs the Jira Board extension

$ErrorActionPreference = "Stop"

# Colors for output
function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Success($msg) { Write-Host "==> $msg" -ForegroundColor Green }
function Write-Err($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red }

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $scriptDir

try {
    # Step 1: Find CLI (try PATH first, then common install locations)
    Write-Step "Looking for QoderCN / VS Code CLI..."
    $qoderCli = $null

    # 优先从 PATH 中查找 qoder-cn
    $found = Get-Command qoder-cn -ErrorAction SilentlyContinue
    if ($found) {
        $qoderCli = $found.Source
    }

    # 其次从 PATH 中查找 code（标准 VS Code CLI）
    if (-not $qoderCli) {
        $found = Get-Command code -ErrorAction SilentlyContinue
        if ($found) {
            $qoderCli = $found.Source
        }
    }

    # 最后尝试常见安装路径
    if (-not $qoderCli) {
        $candidates = @(
            "$env:ProgramFiles\QoderCN\bin\qoder-cn.cmd",
            "${env:ProgramFiles(x86)}\QoderCN\bin\qoder-cn.cmd",
            "$env:LOCALAPPDATA\Programs\QoderCN\bin\qoder-cn.cmd",
            "$env:ProgramFiles\Microsoft VS Code\bin\code.cmd",
            "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd"
        )
        foreach ($c in $candidates) {
            if (Test-Path $c) {
                $qoderCli = $c
                break
            }
        }
    }

    if (-not $qoderCli) {
        Write-Err "QoderCN / VS Code CLI not found"
        Write-Host "    Please ensure QoderCN or VS Code is installed and in PATH." -ForegroundColor Yellow
        exit 1
    }
    Write-Host "    Found: $qoderCli"

    # Step 2: Install npm dependencies
    Write-Step "Installing dependencies..."
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Err "npm install failed"
        exit 1
    }

    # Step 3: Compile TypeScript
    Write-Step "Compiling TypeScript..."
    npx tsc -p ./
    if ($LASTEXITCODE -ne 0) {
        Write-Err "TypeScript compilation failed"
        exit 1
    }

    # Step 4: Clean old VSIX files
    Write-Step "Cleaning old VSIX files..."
    Get-ChildItem -Filter "*.vsix" -ErrorAction SilentlyContinue | Remove-Item -Force

    # Step 5: Package VSIX
    Write-Step "Packaging VSIX..."
    npx vsce package --allow-missing-repository
    if ($LASTEXITCODE -ne 0) {
        Write-Err "VSIX packaging failed"
        exit 1
    }

    # Step 6: Find generated VSIX
    $vsix = Get-ChildItem -Filter "*.vsix" | Select-Object -First 1
    if (-not $vsix) {
        Write-Err "VSIX file not found after packaging"
        exit 1
    }
    Write-Host "    Packaged: $($vsix.Name)"

    # Step 7: Install via QoderCN CLI
    Write-Step "Installing via QoderCN CLI..."
    & $qoderCli --install-extension $vsix.FullName
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Extension installation failed"
        exit 1
    }

    Write-Success "Jira Board extension installed successfully!"
    Write-Host ""
    Write-Host "Please reload your editor to activate the extension:" -ForegroundColor Yellow
    Write-Host "    Press Ctrl+Shift+P and type 'Reload Window'" -ForegroundColor Yellow

} finally {
    Pop-Location
}
