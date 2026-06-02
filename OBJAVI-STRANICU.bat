@echo off
cd /d "%~dp0"
echo.
echo 365 Brisevo - objava stranice i Firebase pravila
echo.
echo Ako se otvori Google prijava, prijavi se na racun koji ima pristup projektu brisevo-93197.
echo.
firebase.exe login
echo.
echo Objavljujem Firestore pravila, indekse i web stranicu...
firebase.exe deploy --only firestore:rules,firestore:indexes,hosting --project brisevo-93197
echo.
echo Gotovo. Ako je gore pisalo Deploy complete, lajkovi i komentari bi trebali raditi.
pause
