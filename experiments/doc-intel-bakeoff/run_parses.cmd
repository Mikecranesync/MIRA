@echo off
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
cd /d "%~dp0"
echo START %date% %time% > out\parse_progress.log
py adapters\parse_docling_batched.py fixtures\t2108_scanned_excerpt.pdf out\ir\t2108_scanned_excerpt.docling-ocr.json --ocr >> out\parse_progress.log 2>&1
py adapters\parse_docling_batched.py fixtures\pf525_user_manual.pdf out\ir\pf525_user_manual.docling.json >> out\parse_progress.log 2>&1
py adapters\parse_docling_batched.py fixtures\gs10_user_manual.pdf out\ir\gs10_user_manual.docling.json >> out\parse_progress.log 2>&1
echo ALL_PARSES_DONE %date% %time% >> out\parse_progress.log
