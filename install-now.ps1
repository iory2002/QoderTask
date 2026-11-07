# Jira Board (todo-panel) installer — run this with QoderCN fully closed.
#
# Why a script instead of `--install-extension` inside the IDE:
# QoderCN locks %USERPROFILE%\.qoder-cn\extensions while it runs, so any attempt
# from its own integrated terminal fails with EPERM. Ctrl+Q first, then run this
# from a normal terminal (or double-click install-now.bat).
$ErrorActionPreference = "Stop"

Write-Host "=== Jira Board installer ===" -ForegroundColor Cyan

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$version = $pkg.version
$vsix = Join-Path $root "todo-panel-$version.vsix"
$extRoot = Join-Path $env:USERPROFILE ".qoder-cn\extensions"
$target = Join-Path $extRoot "your-name.todo-panel-$version"
$cli = "C:\Program Files\QoderCN\bin\code.cmd"

if (-not (Test-Path $vsix)) {
    Write-Host "找不到 $vsix" -ForegroundColor Red
    Write-Host "先在本目录跑：npm install && npm run package" -ForegroundColor Yellow
    exit 1
}

# 1) QoderCN 必须在退出状态，否则扩展目录被锁
$running = Get-Process -Name QoderCN -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "QoderCN 还在运行（$($running.Count) 个进程），扩展目录被锁定。" -ForegroundColor Red
    Write-Host "请先完全退出：在 QoderCN 里按 Ctrl+Q（不是只关窗口）。" -ForegroundColor Yellow
    Write-Host "然后重新运行本脚本。" -ForegroundColor Yellow
    exit 1
}

Write-Host "安装包: $vsix"

# 2) 先试官方 CLI（会正确写入 extensions.json）
if (Test-Path $cli) {
    Write-Host "使用 QoderCN CLI 安装..." -ForegroundColor Cyan
    & $cli --install-extension $vsix --force
    if ($LASTEXITCODE -eq 0) {
        Write-Host "OK - CLI 安装完成（$version）" -ForegroundColor Green
        Write-Host "启动 QoderCN 即可，活动栏会多出 Jira Board 图标。"
        exit 0
    }
    Write-Host "CLI 安装失败（退出码 $LASTEXITCODE），改用解压安装。" -ForegroundColor Yellow
}

# 3) 解压安装（CLI 不可用或失败时的兜底）
Write-Host "清理旧版本..." -ForegroundColor Cyan
Get-ChildItem $extRoot -Filter "your-name.todo-panel*" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "  Removing: $($_.Name)"
    Remove-Item $_.FullName -Recurse -Force
}

Write-Host "解压安装包..." -ForegroundColor Cyan
$temp = Join-Path $env:TEMP ("vsix-" + [guid]::NewGuid().ToString('N'))
Add-Type -Assembly System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory($vsix, $temp)
Copy-Item (Join-Path $temp 'extension') $target -Recurse -Force
Remove-Item $temp -Recurse -Force

# 4) 校验关键产物
$required = @('package.json', 'out\extension.js', 'media\board.js', 'media\board.css')
$missing = $required | Where-Object { -not (Test-Path (Join-Path $target $_)) }
if ($missing.Count -gt 0) {
    Write-Host "FAILED - 缺少: $($missing -join ', ')" -ForegroundColor Red
    exit 1
}

$installedVersion = (Get-Content (Join-Path $target 'package.json') -Raw | ConvertFrom-Json).version
Write-Host "OK - 已安装 $installedVersion 到 $target" -ForegroundColor Green
Write-Host "启动 QoderCN，点活动栏的 Jira Board 图标即可打开看板。"
