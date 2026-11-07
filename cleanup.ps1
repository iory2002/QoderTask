$ErrorActionPreference = "Stop"
Write-Host "=== 清理旧版扩展，只保留 0.1.7 ===" -ForegroundColor Cyan

$keepVersion = "0.1.7"
$extDir = "$env:USERPROFILE\.qoder-cn\extensions"

Get-ChildItem $extDir -Filter "your-name.todo-panel*" -Directory | ForEach-Object {
    if ($_.Name -like "*$keepVersion") {
        Write-Host "保留: $($_.Name)" -ForegroundColor Green
    } else {
        Write-Host "删除: $($_.Name)"
        Remove-Item $_.FullName -Recurse -Force
    }
}

Write-Host ""
Write-Host "剩余扩展:" -ForegroundColor Cyan
Get-ChildItem $extDir -Filter "your-name*" -Directory | ForEach-Object { Write-Host "  $($_.Name)" -ForegroundColor Green }

Write-Host ""
Write-Host "清理完成！重新打开 Qoder 即可。" -ForegroundColor Cyan
Write-Host "按任意键退出..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

