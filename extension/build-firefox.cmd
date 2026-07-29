@echo off
setlocal

set "OUTPUT=%~dp0dist\firefox"
if not exist "%OUTPUT%" mkdir "%OUTPUT%"

copy /Y "%~dp0background.js" "%OUTPUT%\background.js" >nul
copy /Y "%~dp0bridge.js" "%OUTPUT%\bridge.js" >nul
copy /Y "%~dp0lastfm-content.js" "%OUTPUT%\lastfm-content.js" >nul
copy /Y "%~dp0manifest.firefox.json" "%OUTPUT%\manifest.json" >nul
if not exist "%OUTPUT%\icons" mkdir "%OUTPUT%\icons"
copy /Y "%~dp0icons\icon*.png" "%OUTPUT%\icons\" >nul

echo Pacote Firefox criado em: %OUTPUT%
endlocal
