@echo off
REM Always-on launcher for the bench trend historian on the PLC laptop.
REM Serves the TRENDS tab (ConvSimpleLive Perspective iframe) on :8766 and owns the
REM PLC's bench Modbus poll slot. Registered as a boot-scoped Scheduled Task via
REM install_trend_historian_task.ps1 — see TREND_HISTORIAN.md "Run as a service".
REM
REM Root cause this fixes (2026-07-13): the historian was a manually-launched script;
REM after a reboot/logoff nothing restarted it, so the TRENDS iframe (:8766) died.
REM
REM --bind 0.0.0.0 so remote Perspective clients (phone / Hub Command Center browser
REM over the tailnet) can load the viewer — 127.0.0.1 renders only on this laptop.
set PLC_HOST=192.168.1.100
set TREND_HTTP_PORT=8766
"C:\Users\hharp\AppData\Local\Python\pythoncore-3.14-64\python.exe" -u "C:\Users\hharp\Documents\MIRA-monorepo\plc\conv_simple_anomaly\trend_historian.py" --host %PLC_HOST% --bind 0.0.0.0 --http-port %TREND_HTTP_PORT% >> "%LOCALAPPDATA%\mira-trend-historian.log" 2>&1
