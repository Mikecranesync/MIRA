@echo off
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
cd /d "%~dp0"
echo START %date% %time% > out\gemini_retry.log
set GEMINI_MODEL_FORCE=gemini-3.5-flash-lite
doppler run --project factorylm --config dev --preserve-env=GEMINI_MODEL_FORCE -- py run_bakeoff.py --lane gemini --run-id r1 --only "gs10-fault-oca,gs10-table-rated-current,gs10-units-kw,pf525-absent-price,pf525-ambig-pf40,pf525-clear-fault,pf525-fault-f004,pf525-fault-table-f005,pf525-param-dcbus,pf525-revision,pf525-warning-capacitors,t2108-identity,t2108-multi-charge,t2108-spec-input" >> out\gemini_retry.log 2>&1
echo GEMINI_RETRY_DONE %date% %time% >> out\gemini_retry.log
