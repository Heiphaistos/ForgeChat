@echo off
setlocal enabledelayedexpansion
title ForgeChat Desktop — Build v3.2.0

echo.
echo ============================================
echo   ForgeChat Desktop Builder v3.2.0
echo ============================================
echo.

:: Verifications prerequis
where rustc >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERREUR] Rust non trouve. Installe depuis https://rustup.rs
    pause & exit /b 1
)
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERREUR] Node.js non trouve. Installe depuis https://nodejs.org
    pause & exit /b 1
)

:: Chemin du script
set SCRIPT_DIR=%~dp0
set ROOT_DIR=%SCRIPT_DIR%..

echo [1/5] Build du client React...
cd /d "%ROOT_DIR%\client"
call npm ci --prefer-offline
if %errorlevel% neq 0 (
    echo [WARN] npm ci a echoue, tentative avec npm install...
    call npm install
)
call npm run build
if %errorlevel% neq 0 (
    echo [ERREUR] Build client React echoue.
    pause & exit /b 1
)

echo [2/5] Installation deps desktop...
cd /d "%SCRIPT_DIR%"
call npm install --silent
if %errorlevel% neq 0 (
    echo [ERREUR] npm install desktop echoue.
    pause & exit /b 1
)

echo [3/5] Verification icones...
if not exist "%SCRIPT_DIR%src-tauri\icons\icon.ico" (
    echo [WARN] Icone icon.ico manquante dans src-tauri\icons\
    echo [INFO] Pour generer : npx tauri icon chemin\vers\image.png
)

echo [4/5] Compilation Tauri (NSIS installer)...
cd /d "%SCRIPT_DIR%"
call npx tauri build 2>&1
if %errorlevel% neq 0 (
    echo [ERREUR] Build Tauri echoue.
    pause & exit /b 1
)

echo [5/5] Copie des artefacts dans dist-desktop\...
set BUNDLE=%SCRIPT_DIR%src-tauri\target\release\bundle
set OUT=%SCRIPT_DIR%..\dist-desktop

if not exist "%OUT%" mkdir "%OUT%"

:: Installeur NSIS
set FOUND_NSIS=0
for /r "%BUNDLE%\nsis" %%f in (*.exe) do (
    if !FOUND_NSIS!==0 (
        copy "%%f" "%OUT%\ForgeChat-Setup-v3.2.0.exe" >nul
        echo [OK] Installeur : dist-desktop\ForgeChat-Setup-v3.2.0.exe
        set FOUND_NSIS=1
    )
)
if %FOUND_NSIS%==0 (
    echo [WARN] Installeur NSIS non trouve dans %BUNDLE%\nsis\
)

:: Binaire portable (raw release exe)
if exist "%SCRIPT_DIR%src-tauri\target\release\forgechat-desktop.exe" (
    copy "%SCRIPT_DIR%src-tauri\target\release\forgechat-desktop.exe" "%OUT%\ForgeChat-Portable-v3.2.0.exe" >nul
    echo [OK] Portable  : dist-desktop\ForgeChat-Portable-v3.2.0.exe
) else (
    echo [INFO] Binaire portable non trouve - le build NSIS peut l'avoir exclu
)

echo.
echo ============================================
echo   Build termine !
echo   Dossier : dist-desktop\
echo ============================================
echo.
pause
