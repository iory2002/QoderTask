# Jira Board extension installer: build, package, install.
# Run from a normal terminal with QoderCN fully closed (Ctrl+Q) — the running
# IDE locks ~/.qoder-cn/extensions and the CLI then fails with EPERM.
$ErrorActionPreference = "Stop"

Write-Host "=== Jira Board: build, package, install ===" -ForegroundColor Cyan

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root

try {
    $pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
    $version = $pkg.version
    $vsix = Join-Path $root "todo-panel-$version.vsix"

    # 机器上可能同时装新旧两个 IDE：新版在 "Qoder CN IDE"（带空格），旧版在 "QoderCN"
    $cliCandidates = @(
        "C:\Program Files\Qoder CN IDE\bin\code.cmd",
        "C:\Program Files\QoderCN\bin\code.cmd"
    )
    $cli = $cliCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

    # 0) 版本门禁：1.39.1 的 Electron 有已知问题，扩展装上去会报 Electron 错误
    $ideVersion = $null
    if ($cli) {
        $firstLine = (& $cli --version | Select-Object -First 1)
        if ("$firstLine" -match '^\d+\.\d+\.\d+') { $ideVersion = [version]$Matches[0] }
    }
    if (-not $ideVersion) {
        Write-Host "==> 无法确定 QoderCN 版本，跳过版本检查" -ForegroundColor Yellow
    } elseif ($ideVersion -eq [version]'1.39.1') {
        Write-Host "==> QoderCN 1.39.1 存在 Electron 问题，已中止安装" -ForegroundColor Red
        Write-Host "    该版本的 Electron 运行时会报错（扩展加载失败），装上也是坏的。" -ForegroundColor Yellow
        Write-Host "    请先升级到 1.39.2 或更高版本，再重新运行 install.bat。" -ForegroundColor Yellow
        exit 1
    } elseif ($ideVersion -lt [version]'1.39.1') {
        Write-Host "==> QoderCN $ideVersion 低于 1.39.1，未验证过，继续安装" -ForegroundColor Yellow
    } else {
        Write-Host "==> QoderCN $ideVersion，版本 OK" -ForegroundColor Green
    }

    # 1) 构建 + 打包（compile 已包含 tsc、webview 类型检查与 esbuild，package 还会校验 media/board.js）
    Write-Host "==> npm install" -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

    Write-Host "==> npm run package" -ForegroundColor Cyan
    npm run package
    if ($LASTEXITCODE -ne 0) { throw "packaging failed" }
    if (-not (Test-Path $vsix)) { throw "未生成 $vsix" }

    # 2) 安装：先试官方 CLI，失败则解压兜底
    $installed = $false

    if ($cli) {
        Write-Host "==> 通过 QoderCN CLI 安装" -ForegroundColor Cyan
        & $cli --install-extension $vsix --force
        $installed = $LASTEXITCODE -eq 0
    }

    if (-not $installed) {
        Write-Host "==> CLI 不可用或失败，解压安装" -ForegroundColor Yellow
        $extRoot = Join-Path $env:USERPROFILE ".qoder-cn\extensions"
        $target = Join-Path $extRoot "your-name.todo-panel-$version"

        Get-ChildItem $extRoot -Filter "your-name.todo-panel*" -Directory -ErrorAction SilentlyContinue |
            ForEach-Object { Remove-Item $_.FullName -Recurse -Force }

        $temp = Join-Path $env:TEMP ("vsix-" + [guid]::NewGuid().ToString('N'))
        Add-Type -Assembly System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::ExtractToDirectory($vsix, $temp)
        Copy-Item (Join-Path $temp 'extension') $target -Recurse -Force
        Remove-Item $temp -Recurse -Force

        foreach ($rel in @('package.json', 'out\extension.js', 'media\board.js')) {
            if (-not (Test-Path (Join-Path $target $rel))) { throw "安装后缺少 $rel" }
        }
    }

    Write-Host "OK - 已安装 $version" -ForegroundColor Green
    Write-Host "启动 QoderCN，点活动栏的 Jira Board 图标。首次打开会拉取 board 列与活跃 sprint。"
} finally {
    Pop-Location
}
