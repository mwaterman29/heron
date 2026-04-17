@echo off
schtasks /create /tn "DealHunter" /tr "C:\Programming\Important Projects\deal-hunter\run-hunt.bat" /sc daily /st 13:00 /IT
