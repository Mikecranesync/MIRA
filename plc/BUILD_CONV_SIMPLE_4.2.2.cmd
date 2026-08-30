@echo off
setlocal
cd /d "%~dp0\.."
python plc\build_conv_simple_4_2_2.py %*
endlocal

