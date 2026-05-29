@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul

REM ============================================================
REM  nowen-video 一键启动脚本（后端 + 前端 Vite）
REM
REM  使用方法：
REM    1) 根据需要修改下方 [用户配置] 区域的端口
REM    2) 双击运行本脚本，或在命令行中执行 run-dev.bat
REM    3) 会分别弹出两个命令行窗口，关闭对应窗口即可停止服务
REM ============================================================

REM ====================== [用户配置] ==========================
REM 后端服务监听端口（默认 8080），请按需修改
set "SERVER_PORT=8080"
REM 前端 Vite Dev Server 监听端口（默认 3000），请按需修改
set "WEB_PORT=3000"
REM ============================================================

set "SCRIPT_DIR=%~dp0"

echo.
echo ============================================================
echo  nowen-video 本地开发环境
echo  后端端口: %SERVER_PORT%
echo  前端端口: %WEB_PORT%
echo  前端代理: http://localhost:%SERVER_PORT%
echo ============================================================
echo.

echo [1/2] 启动后端服务窗口 ...
start "nowen-video-server (port %SERVER_PORT%)" cmd /k "set SERVER_PORT=%SERVER_PORT%&& set NOWEN_DEBUG=%NOWEN_DEBUG%&& %SCRIPT_DIR%run-server.bat"

REM 稍等一下，让后端先开始初始化
timeout /t 2 /nobreak >nul

echo [2/2] 启动前端 Vite 窗口 ...
start "nowen-video-web (port %WEB_PORT%)" cmd /k "set WEB_PORT=%WEB_PORT%&& set SERVER_PORT=%SERVER_PORT%&& %SCRIPT_DIR%run-web.bat"

echo.
echo 已分别启动后端和前端窗口，关闭对应窗口即可停止服务。
echo 浏览器访问: http://localhost:%WEB_PORT%
echo.

endlocal
exit /b 0
