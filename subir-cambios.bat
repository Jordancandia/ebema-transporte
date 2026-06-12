@echo off
cd /d "%~dp0"
echo ============================================
echo   SIT EBEMA - Sincronizando con GitHub
echo ============================================
echo.
echo [1/3] Guardando cambios locales...
git add -A
git commit -m "Actualizacion %date% %time%"
echo.
echo [2/3] Descargando cambios del repositorio...
git pull --rebase origin main
echo.
echo [3/3] Subiendo cambios a GitHub...
git push origin main
echo.
if %errorlevel%==0 (
  echo LISTO: cambios sincronizados. La web se actualiza en 1-2 minutos.
) else (
  echo Hubo un error. Revisa el mensaje de arriba.
)
pause
