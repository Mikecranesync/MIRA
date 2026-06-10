@echo off
REM Always-on launcher for the live-plc-bridge on the PLC laptop (bench LAN host).
REM Publishes real Micro 820 / GS10 data to the VPS broker so the VPS anomaly
REM engine can run 24/7. Registered as a Scheduled Task (at log on). See DEPLOY.md.
set PLC_HOST=192.168.1.100
set PLC_PORT=502
set MQTT_HOST=100.68.120.99
set MQTT_PORT=1883
set UNS_PREFIX=demo/cell1/conveyor/cv101
set STREAM=bridge
set SOURCE=plc-bridge
set POLL_MS=500
set LOG_LEVEL=INFO
"C:\Users\hharp\AppData\Local\Python\pythoncore-3.14-64\python.exe" -u "C:\Users\hharp\Documents\MIRA-monorepo\plc\live-plc-bridge\bridge.py" >> "%LOCALAPPDATA%\mira-live-plc-bridge.log" 2>&1
