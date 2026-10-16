@echo off
REM Chạy quy trình hằng ngày trên Windows. Lên lịch bằng Task Scheduler:
REM   Create Basic Task -> Daily 05:30 -> Start a program -> chọn tệp này.
chcp 65001 >nul
cd /d "%~dp0\.."
set PY=python
if exist ".venv\Scripts\python.exe" set PY=.venv\Scripts\python.exe
if not exist reports\logs mkdir reports\logs
%PY% main.py daily >> reports\logs\daily.log 2>&1
%PY% main.py report >> reports\logs\daily.log 2>&1
