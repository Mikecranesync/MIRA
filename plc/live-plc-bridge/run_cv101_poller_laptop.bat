@echo off
REM CV-101 read-only Modbus DI_05 fallback -> production mira-relay (bench laptop only).
REM Credentials come from the gateway factorylm.properties (tenant + HMAC key); never set here.
REM Stop: end the python process running cv101_relay_poller.py. See cv101_relay_poller.py docstring.
set PLC_HOST=192.168.1.100
set PLC_PORT=502
set PLC_UNIT=1
set RELAY_INGEST_URL=https://app.factorylm.com/api/v1/tags/ingest
set POLL_S=0.25
set HEARTBEAT_S=5
set LOG_LEVEL=INFO
"C:\Users\hharp\AppData\Local\Python\pythoncore-3.14-64\python.exe" -I -u "%~dp0cv101_relay_poller.py" >> "%LOCALAPPDATA%\mira-cv101-relay-poller.log" 2>&1
