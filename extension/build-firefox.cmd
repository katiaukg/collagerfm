@echo off
setlocal

set "OUTPUT=%~dp0dist\firefox"
if not exist "%OUTPUT%" mkdir "%OUTPUT%"

copy /Y "%~dp0background.js" "%OUTPUT%\background.js" >nul
copy /Y "%~dp0bridge.js" "%OUTPUT%\bridge.js" >nul
copy /Y "%~dp0history.css" "%OUTPUT%\history.css" >nul
copy /Y "%~dp0history.html" "%OUTPUT%\history.html" >nul
copy /Y "%~dp0history.js" "%OUTPUT%\history.js" >nul
copy /Y "%~dp0i18n.js" "%OUTPUT%\i18n.js" >nul
copy /Y "%~dp0popup.css" "%OUTPUT%\popup.css" >nul
copy /Y "%~dp0popup.html" "%OUTPUT%\popup.html" >nul
copy /Y "%~dp0popup.js" "%OUTPUT%\popup.js" >nul
copy /Y "%~dp0lastfm-content.js" "%OUTPUT%\lastfm-content.js" >nul
copy /Y "%~dp0manifest.firefox.json" "%OUTPUT%\manifest.json" >nul
if not exist "%OUTPUT%\icons" mkdir "%OUTPUT%\icons"
copy /Y "%~dp0icons\icon*.png" "%OUTPUT%\icons\" >nul
copy /Y "%~dp0icons\icon.svg" "%OUTPUT%\icons\" >nul
if not exist "%OUTPUT%\_locales" mkdir "%OUTPUT%\_locales"
xcopy /E /I /Y "%~dp0_locales" "%OUTPUT%\_locales" >nul

echo Pacote Firefox criado em: %OUTPUT%
endlocal
