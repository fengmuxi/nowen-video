@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul

REM ============================================================
REM  nowen-video 前端 Vite 本地开发启动脚本
REM
REM  使用方法：
REM    1) 根据需要修改下方 [用户配置] 区域的端口
REM    2) 双击运行本脚本，或在命令行中执行 run-web.bat
REM
REM  注意：SERVER_PORT 必须与后端实际监听端口一致，
REM       Vite 会把 /api 请求代理到 http://localhost:%SERVER_PORT%
REM ============================================================

REM ====================== [用户配置] ==========================
REM 优先级：命令行参数  >  环境变量  >  默认值
REM   第一个参数 %1 = 前端端口，第二个参数 %2 = 后端代理端口
if not "%~1"=="" set "WEB_PORT=%~1"
if not "%~2"=="" set "SERVER_PORT=%~2"
if "%WEB_PORT%"=="" set "WEB_PORT=3000"
if "%SERVER_PORT%"=="" set "SERVER_PORT=8080"
REM 前端构建版本：优先使用环境变量，其次使用最新 Git tag
if "%VITE_APP_VERSION%"=="" (
    for /f "usebackq delims=" %%v in (`git -C "%~dp0\.." describe --tags --abbrev^=0 --match "v[0-9]*" 2^>nul`) do set "VITE_APP_VERSION=%%v"
    if defined VITE_APP_VERSION if "!VITE_APP_VERSION:~0,1!"=="v" set "VITE_APP_VERSION=!VITE_APP_VERSION:~1!"
)
if "%VITE_APP_VERSION%"=="" set "VITE_APP_VERSION=0.1.0"
REM ============================================================

pushd "%~dp0\..\web"

REM 通过环境变量传给 vite.config.ts，使代理目标可动态调整
set "VITE_API_PROXY_TARGET=http://localhost:%SERVER_PORT%"

echo.
echo ============================================================
echo  启动 nowen-video 前端 (Vite Dev Server)
echo  前端端口   : %WEB_PORT%
echo  应用版本   : %VITE_APP_VERSION%
echo  后端代理至 : %VITE_API_PROXY_TARGET%
echo  工作目录   : %CD%
echo ============================================================
echo.

if not exist "node_modules" (
    echo [info] 未检测到 node_modules，正在执行 npm install ...
    call npm install
    if errorlevel 1 (
        echo [error] npm install 失败
        popd
        exit /b 1
    )
)

call npm run dev -- --port %WEB_PORT% --host

set "EXIT_CODE=%ERRORLEVEL%"
popd
endlocal & exit /b %EXIT_CODE%
