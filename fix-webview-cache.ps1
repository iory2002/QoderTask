# 修 QoderCN 打开 WebView 时的报错：
#   Could not register service worker: TypeError: Failed to register a ServiceWorker
#   for scope ('vscode-webview://.../') ...: ServiceWorker script evaluation failed.
#
# 这不是扩展的问题：QoderCN 1.39.1 于 11/7 15:54 升级后，
# %APPDATA%\QoderCN\Service Worker 里留着旧版 Electron/V8 的 service-worker 脚本缓存，
# 新引擎加载它时评估失败，于是所有 vscode-webview:// 页面（不只 Jira Board）都开不出来。
# 清掉浏览器级缓存让 QoderCN 重建即可，登录态与工作区状态不受影响。
#
# 用法：在 QoderCN 里按 Ctrl+Q 完全退出，然后双击 fix-webview-cache.bat
# 或在普通终端里运行本脚本。
$ErrorActionPreference = "Stop"

Write-Host "=== 修复 WebView ServiceWorker 缓存 ===" -ForegroundColor Cyan

# 1) 缓存目录被运行中的 IDE 锁着，必须先退出
$ideNames = @('Qoder CN IDE', 'QoderCN')
$running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $ideNames -contains $_.ProcessName })
if ($running.Count -gt 0) {
    Write-Host "QoderCN 还在运行（$($running.Count) 个进程），缓存目录被锁定。" -ForegroundColor Red
    Write-Host "请先按 Ctrl+Q 完全退出（不是只关窗口），再重新运行本脚本。" -ForegroundColor Yellow
    exit 1
}

$userData = Join-Path $env:APPDATA 'QoderCN'
# 只动浏览器缓存；User / Local Storage / Workspaces 保留，登录态与工作区状态不受影响
$targets = @('Service Worker', 'Cache', 'Code Cache', 'CachedData', 'GPUCache')

foreach ($name in $targets) {
    $path = Join-Path $userData $name
    if (Test-Path $path) {
        Write-Host "删除: $path"
        Remove-Item $path -Recurse -Force
    } else {
        Write-Host "跳过（不存在）: $name" -ForegroundColor DarkGray
    }
}

# 2) 顺手清掉已废弃的旧版扩展（extensions.json 里 0.2.7 仍标着 removed）
$extRoot = Join-Path $env:USERPROFILE '.qoder-cn\extensions'
$installedVersion = (Get-Content (Join-Path $PSScriptRoot 'package.json') -Raw | ConvertFrom-Json).version
Get-ChildItem $extRoot -Filter 'your-name.todo-panel*' -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notlike "*$installedVersion" } |
    ForEach-Object {
        Write-Host "删除旧扩展: $($_.Name)"
        Remove-Item $_.FullName -Recurse -Force
    }

Write-Host ""
Write-Host "完成。启动 QoderCN 后重新打开 Jira Board 即可。" -ForegroundColor Green
Write-Host "按任意键退出..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

