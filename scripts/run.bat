@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul

REM ============================================================
REM  nowen-video 本地开发一键交互脚本
REM
REM  功能：
REM    1) 选择要启动的服务（后端 / 前端 / 全部）
REM    2) 手动填写端口（直接回车使用默认值）
REM    3) 自动拉起对应的命令行窗口
REM
REM  使用：双击运行本脚本，按提示操作即可
REM ============================================================

set "SCRIPT_DIR=%~dp0"
REM 去掉末尾反斜杠，避免路径拼接时 \" 转义引号
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

:menu
cls
echo.
echo ============================================================
echo            nowen-video local dev launcher
echo ============================================================
echo.
echo   [1] Start Backend  (Go server)
echo   [2] Start Frontend (Vite dev server)
echo   [3] Start ALL      (Backend + Frontend)
echo   [0] Exit
echo.
echo ============================================================
set "CHOICE="
set /p "CHOICE=请输入选项 [0-3]: "

if "%CHOICE%"=="1" goto run_server
if "%CHOICE%"=="2" goto run_web
if "%CHOICE%"=="3" goto run_all
if "%CHOICE%"=="0" goto end

echo.
echo [warn] 无效输入，请重试...
timeout /t 2 /nobreak >nul
goto menu


REM ============================================================
REM  仅启动后端
REM ============================================================
:run_server
echo.
echo ----------- 启动后端服务 -----------
call :ask_server_port
echo.
echo 即将启动后端，端口: %SERVER_PORT%
echo.
start "nowen-video-server port %SERVER_PORT%" cmd /k "set SERVER_PORT=%SERVER_PORT% & set NOWEN_APP_PORT=%SERVER_PORT% & call "%SCRIPT_DIR%\run-server.bat""
goto end


REM ============================================================
REM  仅启动前端
REM ============================================================
:run_web
echo.
echo ----------- 启动前端服务 -----------
call :ask_web_port
call :ask_server_port_for_proxy
echo.
echo 即将启动前端，端口: %WEB_PORT%, 代理后端: http://localhost:%SERVER_PORT%
echo.
start "nowen-video-web port %WEB_PORT%" cmd /k "set WEB_PORT=%WEB_PORT% & set SERVER_PORT=%SERVER_PORT% & call "%SCRIPT_DIR%\run-web.bat""
goto end


REM ============================================================
REM  全部启动
REM ============================================================
:run_all
echo.
echo ----------- 启动全部服务 后端 + 前端 -----------
call :ask_server_port
call :ask_web_port
echo.
echo 即将启动:
echo   后端端口: %SERVER_PORT%
echo   前端端口: %WEB_PORT%
echo.

echo [1/2] 启动后端服务窗口 ...
start "nowen-video-server port %SERVER_PORT%" cmd /k "set SERVER_PORT=%SERVER_PORT% & set NOWEN_APP_PORT=%SERVER_PORT% & call "%SCRIPT_DIR%\run-server.bat""

echo 等待后端初始化 2 秒 ...
timeout /t 2 /nobreak >nul

echo [2/2] 启动前端 Vite 窗口 ...
start "nowen-video-web port %WEB_PORT%" cmd /k "set WEB_PORT=%WEB_PORT% & set SERVER_PORT=%SERVER_PORT% & call "%SCRIPT_DIR%\run-web.bat""

echo.
echo 已分别启动后端和前端窗口，关闭对应窗口即可停止服务。
echo 浏览器访问 http://localhost:%WEB_PORT%
echo.
goto end


REM ============================================================
REM  子例程：询问后端端口（默认 8080）
REM ============================================================
:ask_server_port
set "INPUT="
set /p "INPUT=请输入后端端口 [默认 8080，直接回车使用默认]: "
if "%INPUT%"=="" (
    set "SERVER_PORT=8080"
) else (
    set "SERVER_PORT=%INPUT%"
)
goto :eof


REM ============================================================
REM  子例程：询问前端端口（默认 3000）
REM ============================================================
:ask_web_port
set "INPUT="
set /p "INPUT=请输入前端端口 [默认 3000，直接回车使用默认]: "
if "%INPUT%"=="" (
    set "WEB_PORT=3000"
) else (
    set "WEB_PORT=%INPUT%"
)
goto :eof


REM ============================================================
REM  子例程：询问后端端口（用于前端代理目标）
REM ============================================================
:ask_server_port_for_proxy
set "INPUT="
set /p "INPUT=请输入要代理的后端端口 [默认 8080，直接回车使用默认]: "
if "%INPUT%"=="" (
    set "SERVER_PORT=8080"
) else (
    set "SERVER_PORT=%INPUT%"
)
goto :eof


:end
echo.
pause
endlocal
exit /b 0
