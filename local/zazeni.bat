@echo off
rem Zažene Dom Obroki (Windows). Okno pustite odprto, dokler aplikacijo uporabljate.
cd /d "%~dp0.."
if not exist local\nastavitve.env (
  echo Manjka local\nastavitve.env - glejte Kakoinstaliram.pdf, korak 4.
  pause
  exit /b 1
)
if not exist node_modules\pg (
  echo Namescam knjiznice ...
  call npm install --omit=dev
)
node local\server.mjs
pause
