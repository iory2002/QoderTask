@echo off
echo === Todo Panel 0.1.2 安装脚本 ===
echo.

set "EXT_DIR=%USERPROFILE%\.qoder-cn\extensions\your-name.todo-panel-0.1.2"
set "VSIX=e:\AIGen\QoderTask\todo-panel-0.1.2.vsix"
set "TEMP_DIR=%TEMP%\vsix-install-%RANDOM%"

echo [1/4] 清理旧版本...
for /d %%D in ("%USERPROFILE%\.qoder-cn\extensions\your-name.todo-panel-0.*") do (
    echo   删除: %%D
    rmdir /s /q "%%D" 2>nul
)

echo [2/4] 解压 vsix...
mkdir "%TEMP_DIR%" 2>nul
powershell -NoProfile -Command "Add-Type -Assembly System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory('%VSIX%', '%TEMP_DIR%')"
if errorlevel 1 (
    echo 错误: 解压失败
    pause
    exit /b 1
)

echo [3/4] 安装到扩展目录...
xcopy "%TEMP_DIR%\extension" "%EXT_DIR%" /s /e /i /q /y
if errorlevel 1 (
    echo 错误: 复制失败，请确保 Qoder 已完全关闭
    pause
    exit /b 1
)

echo [4/4] 清理临时文件...
rmdir /s /q "%TEMP_DIR%" 2>nul

echo.
echo 安装成功！请重新打开 Qoder。
pause

