@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul

REM ============================================================
REM  nowen-video 后端本地开发启动脚本
REM
REM  使用方法：
REM    1) 根据需要修改下方 [用户配置] 区域的端口
REM    2) 双击运行本脚本，或在命令行中执行 run-server.bat
REM ============================================================

REM ====================== [用户配置] ==========================
REM 优先级：命令行参数 %1  >  环境变量 SERVER_PORT  >  默认 8080
if not "%~1"=="" set "SERVER_PORT=%~1"
if "%SERVER_PORT%"=="" set "SERVER_PORT=8080"
REM 是否启用调试模式（true / false）
if "%NOWEN_DEBUG%"=="" set "NOWEN_DEBUG=true"
REM 应用版本：优先使用环境变量，其次使用最新 Git tag
if "%NOWEN_VERSION%"=="" (
    for /f "usebackq delims=" %%v in (`git -C "%~dp0\.." describe --tags --abbrev^=0 --match "v[0-9]*" 2^>nul`) do set "NOWEN_VERSION=%%v"
    if defined NOWEN_VERSION if "!NOWEN_VERSION:~0,1!"=="v" set "NOWEN_VERSION=!NOWEN_VERSION:~1!"
)
if "%NOWEN_VERSION%"=="" set "NOWEN_VERSION=0.1.0"
REM ============================================================

REM 切换到项目根目录（脚本父目录）
pushd "%~dp0\.."

REM 通过 viper 的环境变量机制覆盖 app.port
set "NOWEN_APP_PORT=%SERVER_PORT%"
set "CGO_ENABLED=1"

echo.
echo ============================================================
echo  启动 nowen-video 后端服务
echo  监听端口: %SERVER_PORT%
echo  应用版本: %NOWEN_VERSION%
echo  调试模式: %NOWEN_DEBUG%
echo  工作目录: %CD%
echo ============================================================
echo.

go run ./cmd/server

set "EXIT_CODE=%ERRORLEVEL%"
popd
endlocal & exit /b %EXIT_CODE%
