@echo off
REM Deal Hunter — scheduled run wrapper
REM Logs to logs/hunt-YYYY-MM-DD.log

cd /d "C:\Programming\Important Projects\deal-hunter"

REM Generate log filename with date
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set dt=%%I
set logdate=%dt:~0,4%-%dt:~4,2%-%dt:~6,2%

if not exist logs mkdir logs

echo [%date% %time%] Starting deal-hunter run >> logs\hunt-%logdate%.log

REM Run the full pipeline. FBMP forces headed mode internally;
REM all other scrapers run headless.
call npx tsx src/index.ts >> logs\hunt-%logdate%.log 2>&1

echo [%date% %time%] Run complete (exit code %ERRORLEVEL%) >> logs\hunt-%logdate%.log
