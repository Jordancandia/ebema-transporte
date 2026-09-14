@echo off
cd /d "%~dp0"

echo ===== VERSIONADO AUTOMATICO (A-07) =====
where node >nul 2>&1
if %errorlevel%==0 (
  node bump-version.js
) else (
  echo AVISO: no se encontro "node" en PATH - se omite el bump automatico de version.
  echo Verificar a mano que todos los "?v=..." del repo sean iguales antes de continuar.
)

(
  echo ===== LIMPIAR LOCKS =====
  del /f /q ".git\index.lock" 2>nul
  del /f /q ".git\HEAD.lock" 2>nul
  del /f /q ".git\config.lock" 2>nul
  del /f /q ".git\objects\maintenance.lock" 2>nul
  del /f /q ".git\refs\heads\main.lock" 2>nul
  for /r ".git" %%F in (*.lock) do del /f /q "%%F" 2>nul
  if exist ".git\HEAD.lock" (echo HEAD.lock_SIGUE) else (echo HEAD.lock_OK)
  if exist ".git\index.lock" (echo index.lock_SIGUE) else (echo index.lock_OK)
  echo ===== IDENTITY =====
  git config user.email "jcandia@ebema.cl"
  git config user.name "Jordan Candia"
  echo ===== DEJAR DE TRACKEAR deploy_log.txt (una sola vez, no falla si ya no esta) =====
  git rm --cached --ignore-unmatch deploy_log.txt >nul 2>&1
  echo ===== ADD =====
  git add -A
  echo ===== COMMIT =====
  git commit -m "deploy: actualizacion automatica %date% %time%"
  echo ===== PULL =====
  git pull --rebase origin main
  echo ===== PUSH =====
  git push origin main
  echo ===== LOG =====
  git log --oneline -3
  echo ===== STATUS =====
  git status -sb
) > deploy_log.txt 2>&1
start notepad deploy_log.txt
