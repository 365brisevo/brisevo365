@echo off
cd /d "%~dp0"
set "NODE_EXE=%~dp0.tools\node-v20.18.1-win-x64\node.exe"
set "FIREBASE_JS=%~dp0.tools\firebase-cli-noscripts\node_modules\firebase-tools\lib\bin\firebase.js"
set "XDG_CONFIG_HOME=%~dp0.tools\config"
set "XDG_CACHE_HOME=%~dp0.tools\cache"
set "FIREBASE_CLI_PREVIEWS="
set "FIREBASE_SKIP_UPDATE_CHECK=true"

echo.
echo 365 Brisevo - objava stranice i Firebase pravila
echo.
echo Ako se otvori Google prijava, prijavi se na racun koji ima pristup projektu brisevo-93197.
echo.
if not exist "%NODE_EXE%" (
  echo Nedostaje lokalni Node alat. Javi Codexu da ponovi pripremu alata.
  pause
  exit /b 1
)

if not exist "%FIREBASE_JS%" (
  echo Nedostaje lokalni Firebase CLI. Javi Codexu da ponovi pripremu alata.
  pause
  exit /b 1
)

"%NODE_EXE%" "%FIREBASE_JS%" login
if errorlevel 1 (
  echo.
  echo Firebase prijava nije uspjela. Deploy nije pokrenut.
  pause
  exit /b 1
)

echo.
echo Objavljujem Firestore pravila, indekse i web stranicu...
"%NODE_EXE%" "%FIREBASE_JS%" deploy --only firestore:rules,firestore:indexes,hosting --project brisevo-93197
if errorlevel 1 (
  echo.
  echo Deploy nije uspio. Kopiraj poruku iznad ili posalji screenshot Codexu.
  pause
  exit /b 1
)

echo.
echo Gotovo. Ako je gore pisalo Deploy complete, lajkovi i komentari bi trebali raditi.
pause
