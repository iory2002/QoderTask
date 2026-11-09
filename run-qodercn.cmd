@echo off
REM 启动 QoderCN IDE，并让 Node 用 Windows 系统证书库做 TLS 链校验。
REM
REM 背景：内网 Jenkins / GitLab 的证书由 GE HealthCare 自签根签发，Node 自带的 CA 库里没有，
REM 默认校验必然失败（unable to verify the first certificate）。Node 只在进程启动时读
REM NODE_USE_SYSTEM_CA，所以必须在这里设好再启动 IDE。
REM
REM 链校验仍然生效，只放行主机名比对（内网证书的 SAN 里没有我们实际请求的主机名）。
REM
REM 用法：双击本文件，或 run-qodercn.cmd "C:\path\to\Qoder CN IDE.exe"

setlocal
set "NODE_USE_SYSTEM_CA=1"

set "QODER_EXE=%~1"
if "%QODER_EXE%"=="" set "QODER_EXE=C:\Program Files\QoderCN\QoderCN.exe"

if not exist "%QODER_EXE%" (
    echo 找不到 IDE 可执行文件: "%QODER_EXE%"
    echo 请把路径作为参数传入，例如:
    echo   run-qodercn.cmd "C:\Users\me\AppData\Local\Programs\Qoder CN IDE\Qoder CN IDE.exe"
    pause
    exit /b 1
)

echo 启动: "%QODER_EXE%"  (NODE_USE_SYSTEM_CA=%NODE_USE_SYSTEM_CA%)
start "" "%QODER_EXE%" %2 %3 %4 %5
endlocal
