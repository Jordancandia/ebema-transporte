@echo off
cd /d "%~dp0"
echo ============================================
echo   SIT EBEMA - Reparacion del repositorio
echo ============================================
echo.
echo [1/3] Eliminando archivos de bloqueo huerfanos...
del /f /q ".git\index.lock" 2>nul
del /f /q ".git\HEAD.lock" 2>nul
del /f /q ".git\maintenance.lock" 2>nul
echo Listo.
echo.
echo [2/3] Descargando el historial actualizado de GitHub...
git fetch origin
echo.
echo [3/3] Alineando la copia local con GitHub...
git reset --hard origin/main
echo.
if %errorlevel%==0 (
  echo ============================================
  echo REPARACION COMPLETA. Tu copia local quedo
  echo identica a GitHub. Desde ahora usa
  echo subir-cambios.bat con normalidad.
  echo ============================================
) else (
  echo Hubo un error. Revisa el mensaje de arriba.
)
pause
