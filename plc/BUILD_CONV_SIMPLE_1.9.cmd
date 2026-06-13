@echo off
REM ============================================================
REM  Build the Conv_Simple_1.9 CCW package (Trends V2).
REM  Double-click this on the PLC laptop with CCW CLOSED.
REM  It clones Conv_Simple_1.8 -> 1.9, bakes the V1.9 slave map,
REM  and stages the program + variable kit. 1.8 is never touched.
REM ============================================================
setlocal
cd /d "%~dp0"

echo.
echo === Conv_Simple_1.9 package builder ===
echo (Conv_Simple_1.8 is cloned, not modified.)
echo.

REM Show the plan first.
python "%~dp0build_conv_simple_1_9.py" --dry-run
if errorlevel 1 goto :err

echo.
set /p GO="Build Conv_Simple_1.9 now? [Y/N] "
if /i not "%GO%"=="Y" goto :cancel

python "%~dp0build_conv_simple_1_9.py" --force
if errorlevel 1 goto :err

echo.
echo Next: open Conv_Simple_1.9\Conv_Simple_1.9.ccwsln, then follow
echo       Conv_Simple_1.9\_V1.9_APPLY\INSTALL_ConvSimple_v1.9.md
echo.
pause
goto :eof

:cancel
echo Cancelled. Nothing changed.
pause
goto :eof

:err
echo.
echo BUILD FAILED — see the error above. Nothing was downloaded to the PLC.
pause
