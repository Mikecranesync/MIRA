@echo off
REM ============================================================
REM  MIRA RAG Sidecar — Windows Service Installer (via NSSM)
REM  Installs the sidecar as a Windows service named MiraRAG
REM
REM  Prerequisites:
REM    - NSSM (https://nssm.cc/) must be on PATH
REM    - Python 3.12+ must be installed
REM    - uv must be installed (pip install uv)
REM
REM  Usage:
REM    install_service_windows.bat [properties_file_path]
REM
REM  Example:
REM    install_service_windows.bat "C:\Program Files\Inductive Automation\Ignition\data\factorylm\factorylm.properties"
REM ============================================================

setlocal

set SERVICE_NAME=MiraRAG
set SIDECAR_DIR=%~dp0..
set PROPERTIES_FILE=%~1

echo.
echo ==========================================
echo   MIRA RAG Sidecar — Service Installer
echo ==========================================
echo.

REM Check NSSM
where nssm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: nssm not found on PATH.
    echo Download from https://nssm.cc/ and add to PATH.
    exit /b 1
)

REM Check Python
where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: python not found on PATH.
    exit /b 1
)

REM Check uv
where uv >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: uv not found on PATH. Install with: pip install uv
    exit /b 1
)

REM Install dependencies
echo [1/4] Installing dependencies with uv ...
pushd "%SIDECAR_DIR%"
uv sync
if %ERRORLEVEL% neq 0 (
    echo ERROR: uv sync failed.
    popd
    exit /b 1
)
popd
echo       OK

REM Stop existing service if running
echo [2/4] Checking for existing service ...
nssm status %SERVICE_NAME% >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo       Stopping existing %SERVICE_NAME% service ...
    nssm stop %SERVICE_NAME% >nul 2>&1
    nssm remove %SERVICE_NAME% confirm >nul 2>&1
    echo       Removed existing service.
)

REM Install service
echo [3/4] Installing %SERVICE_NAME% service ...
nssm install %SERVICE_NAME% "%SIDECAR_DIR%\.venv\Scripts\python.exe" -m uvicorn app:app --host 127.0.0.1 --port 5000
nssm set %SERVICE_NAME% AppDirectory "%SIDECAR_DIR%"
nssm set %SERVICE_NAME% DisplayName "MIRA RAG Sidecar"
nssm set %SERVICE_NAME% Description "FactoryLM MIRA RAG engine — ChromaDB + LLM inference on localhost:5000"
nssm set %SERVICE_NAME% Start SERVICE_AUTO_START
nssm set %SERVICE_NAME% AppStdout "%SIDECAR_DIR%\logs\service_stdout.log"
nssm set %SERVICE_NAME% AppStderr "%SIDECAR_DIR%\logs\service_stderr.log"
nssm set %SERVICE_NAME% AppRotateFiles 1
nssm set %SERVICE_NAME% AppRotateBytes 10485760

REM Set environment variables from properties file if provided
if not "%PROPERTIES_FILE%"=="" (
    if exist "%PROPERTIES_FILE%" (
        nssm set %SERVICE_NAME% AppEnvironmentExtra PROPERTIES_FILE=%PROPERTIES_FILE%
        echo       Properties file: %PROPERTIES_FILE%
    ) else (
        echo       WARNING: Properties file not found: %PROPERTIES_FILE%
    )
)

REM Create logs directory
if not exist "%SIDECAR_DIR%\logs" mkdir "%SIDECAR_DIR%\logs"

echo       Service installed.

REM Start service
echo [4/4] Starting %SERVICE_NAME% service ...
nssm start %SERVICE_NAME%
timeout /t 3 /nobreak >nul

REM Verify
nssm status %SERVICE_NAME% | findstr /i "running" >nul
if %ERRORLEVEL% equ 0 (
    echo       Service is RUNNING.
) else (
    echo       WARNING: Service may not have started. Check logs at:
    echo       %SIDECAR_DIR%\logs\service_stderr.log
)

echo.
echo ==========================================
echo   Installation Complete
echo ==========================================
echo.
echo   Service: %SERVICE_NAME%
echo   URL:     http://localhost:5000/status
echo   Logs:    %SIDECAR_DIR%\logs\
echo.
echo   To check: nssm status %SERVICE_NAME%
echo   To stop:  nssm stop %SERVICE_NAME%
echo   To remove: uninstall_service_windows.bat
echo.

endlocal
