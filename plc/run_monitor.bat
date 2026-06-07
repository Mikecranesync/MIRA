@echo off
REM ============================================================
REM  run_monitor.bat - one-click launcher for the MIRA PLC
REM  Live Dashboard (live_monitor.py).
REM
REM  Double-click this file. It pre-checks the connection to the
REM  bench PLC (Micro 820 Modbus TCP slave at 192.168.1.100:502),
REM  tells you exactly what's wrong if it can't reach it, and
REM  launches the live dashboard once the PLC answers.
REM ============================================================
setlocal
cd /d "%~dp0"

set PLC_HOST=192.168.1.100
set PLC_PORT=502

echo.
echo  MIRA PLC Live Dashboard
echo  Checking connection to %PLC_HOST%:%PLC_PORT% ...
echo.

REM --- Wait for the Modbus TCP port to answer (up to ~30s) ---
set /a TRIES=0
:checkloop
powershell -NoProfile -Command "exit !([bool](Test-NetConnection %PLC_HOST% -Port %PLC_PORT% -WarningAction SilentlyContinue).TcpTestSucceeded)"
if %errorlevel%==0 goto online
set /a TRIES+=1
if %TRIES%==1 (
  echo  PLC not reachable yet. Checklist:
  echo    1^) Ethernet cable from this laptop into the LAN switch ^(or PLC^)
  echo    2^) PLC powered on and in RUN
  echo    3^) PowerShell: Get-NetAdapter Ethernet  should say "Up"
  echo       ^(this laptop's wired port is static 192.168.1.50/24^)
  echo.
  echo  Waiting for the PLC to come online... ^(Ctrl+C to abort^)
)
if %TRIES% geq 15 (
  echo.
  echo  Still no answer from %PLC_HOST%:%PLC_PORT% after 30s. Fix the link above
  echo  and re-run this file. Press any key to exit.
  pause >nul
  exit /b 1
)
timeout /t 2 /nobreak >nul
goto checkloop

:online
echo  PLC ONLINE at %PLC_HOST%:%PLC_PORT% - launching live dashboard...
echo.
python "%~dp0live_monitor.py" --host %PLC_HOST% --poll 1.0
endlocal
