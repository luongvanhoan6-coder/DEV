@echo off
chcp 65001 >nul
REM Bam dup chuot vao file nay (Windows) de tu cai + mo ZL-CRM tai http://localhost:3080
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0mo-zl-crm.ps1"
pause
