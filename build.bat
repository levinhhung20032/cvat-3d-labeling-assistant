@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js chua duoc cai. Dang cai dat Node.js LTS...
    where winget >nul 2>nul
    if errorlevel 1 (
        echo Khong tim thay winget. Hay cai Node.js thu cong tai https://nodejs.org roi chay lai.
        pause
        exit /b 1
    )
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
        echo Cai Node.js that bai.
        pause
        exit /b 1
    )
    rem Cap nhat PATH cho phien hien tai
    set "PATH=%PATH%;%ProgramFiles%\nodejs;%APPDATA%\npm"
    where node >nul 2>nul
    if errorlevel 1 (
        echo Da cai Node.js nhung phien nay chua nhan PATH. Hay dong cua so nay va chay lai build.bat.
        pause
        exit /b 1
    )
)

echo Node.js:
call node --version

echo Dang cai thu vien (npm install)...
call npm install
if errorlevel 1 (
    echo npm install that bai.
    pause
    exit /b 1
)

echo Dang build (npm run build)...
call npm run build
if errorlevel 1 (
    echo Build that bai.
    pause
    exit /b 1
)

echo Build xong.
pause
