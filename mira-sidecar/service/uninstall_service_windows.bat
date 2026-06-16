@echo off
REM MIRA RAG Sidecar — Windows Service Uninstaller

set SERVICE_NAME=MiraRAG

echo Stopping %SERVICE_NAME% ...
nssm stop %SERVICE_NAME% >nul 2>&1

echo Removing %SERVICE_NAME% ...
nssm remove %SERVICE_NAME% confirm >nul 2>&1

echo Done. Service %SERVICE_NAME% has been removed.
