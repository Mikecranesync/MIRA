@echo off
REM ============================================================
REM  Build the Conv_Simple_1.9 CCW package (Trends V2).
REM  Double-click this on the PLC laptop with CCW CLOSED.
REM    1) clones Conv_Simple_1.8 -> 1.9 (1.8 untouched)
REM    2) bakes the V1.9 slave map (CCW reads on open)
REM    3) pre-injects the 9 V1.9 variables + program into the
REM       clone's project DB (best-effort; see INSTALL card)
REM  Goal: open Conv_Simple_1.9 -> Build -> Download. If CCW shows
REM  missing vars or the old program, the pre-inject didn't take on
REM  your CCW build -> follow the manual fallback in the INSTALL card.
REM ============================================================
setlocal
cd /d "%~dp0"

echo.
echo === Conv_Simple_1.9 package builder (with pre-inject) ===
echo (Conv_Simple_1.8 is cloned, not modified.)
echo.

python "%~dp0build_conv_simple_1_9.py" --dry-run
if errorlevel 1 goto :err

echo.
set /p GO="Build + pre-inject Conv_Simple_1.9 now? [Y/N] "
if /i not "%GO%"=="Y" goto :cancel

echo.
echo --- [step A] clone + bake slave map ---
python "%~dp0build_conv_simple_1_9.py" --force
if errorlevel 1 goto :err

echo.
echo --- [step B] pre-inject V1.9 variables + program (experimental) ---
python "%~dp0inject_vars_accdb.py"
if errorlevel 1 (
  echo.
  echo NOTE: pre-inject failed, but the clean clone + baked slave map are fine.
  echo Open Conv_Simple_1.9 and follow the manual steps in the INSTALL card.
  goto :done
)

:done
echo.
echo Next: open Conv_Simple_1.9\Conv_Simple_1.9.ccwsln in CCW.
echo   Best case: Build -^> Download (vars + program + map already applied).
echo   If CCW shows missing vars or the OLD program, re-run this with the
echo   clean-only option below and follow _V1.9_APPLY\INSTALL_ConvSimple_v1.9.md:
echo        python build_conv_simple_1_9.py --force
echo.
pause
goto :eof

:cancel
echo Cancelled. Nothing changed.
pause
goto :eof

:err
echo.
echo BUILD FAILED - see the error above. Nothing was downloaded to the PLC.
pause
