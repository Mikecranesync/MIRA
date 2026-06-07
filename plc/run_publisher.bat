@echo off
REM ============================================================
REM  run_publisher.bat - start the MIRA PLC edge publisher.
REM  Polls the PLC and pushes live data to the MQTT broker on
REM  the VPS, which feeds the always-on web dashboard:
REM     http://100.68.120.99:8080   (open over Tailscale)
REM
REM  This is the "edge node" half. Keep it running whenever you
REM  want the web dashboard to show live data. Later this same
REM  script moves to the dedicated edge gateway on the PLC switch.
REM ============================================================
setlocal
cd /d "%~dp0"
echo Starting PLC -^> MQTT publisher (Ctrl+C to stop)...
python "%~dp0mqtt_publisher.py" --broker 100.68.120.99 --interval 1.0
endlocal
