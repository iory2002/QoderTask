$ErrorActionPreference = "Stop"
Write-Host "=== Todo Panel 0.1.2 Installer ===" -ForegroundColor Cyan

$extDir = "$env:USERPROFILE\.qoder-cn\extensions\your-name.todo-panel-0.1.2"
$vsix = "e:\AIGen\QoderTask\todo-panel-0.1.2.vsix"

# Clean old versions
Get-ChildItem "$env:USERPROFILE\.qoder-cn\extensions" -Filter "your-name.todo-panel*" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "Removing: $($_.Name)"
    Remove-Item $_.FullName -Recurse -Force
}

# Extract vsix
$temp = "$env:TEMP\vsix-install-$(Get-Random)"
Add-Type -Assembly System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory($vsix, $temp)

# Copy to extensions dir
Copy-Item "$temp\extension" $extDir -Recurse -Force
Remove-Item $temp -Recurse -Force

# Verify
if (Test-Path "$extDir\package.json") {
    Write-Host "OK - Installed to: $extDir" -ForegroundColor Green
} else {
    Write-Host "FAILED - package.json not found" -ForegroundColor Red
}

Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
