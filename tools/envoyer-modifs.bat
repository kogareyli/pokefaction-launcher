@echo off
chcp 65001 >nul
title Envoyer mes modifs PokéFaction
cd /d "%~dp0.."
where node >nul 2>nul || (
  echo Node.js est introuvable. Installe-le depuis https://nodejs.org puis relance.
  pause
  exit /b 1
)
node tools\envoyer-modifs.js %*
echo.
pause
