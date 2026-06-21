@echo off
setlocal
title ForgeChat Desktop — Build v3.2.0

echo.
echo ====================================
echo   ForgeChat Desktop Builder v3.2.0
echo ====================================
echo.

:: Vérifier Rust
where rustc >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERREUR] Rust non trouve. Installe depuis https://rustup.rs
    pause & exit /b 1
)

:: Vérifier Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERREUR] Node.js non trouve. Installe depuis https://nodejs.org
    pause & exit /b 1
)

echo [1/4] Build du client React...
cd ..\client
call npm ci
call npm run build
if %errorlevel% neq 0 (
    echo [ERREUR] Build client echoue.
    pause & exit /b 1
)

echo [2/4] Installation des deps Tauri...
cd ..\desktop
call npm install

echo [3/4] Verification des icones...
if not exist "src-tauri\icons\icon.ico" (
    echo [WARN] Icones manquantes - copier dans src-tauri\icons\ ou lancer : npx tauri icon
)

echo [4/4] Compilation Tauri...
call npx tauri build

if %errorlevel% neq 0 (
    echo.
    echo [ERREUR] Build Tauri echoue.
    pause & exit /b 1
)

echo.
echo ====================================
echo   Build termine avec succes !
echo   Installeur : src-tauri\target\release\bundle\nsis\ForgeChat_3.2.0_x64-setup.exe
echo   Portable   : src-tauri\target\release\forgechat-desktop.exe
echo ====================================
pause
