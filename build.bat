@echo off
setlocal
cd /d "%~dp0"

rem --- Kiem tra ban cap nhat tren GitHub (chi keo khi an toan: co git, la repo git, khong co thay doi cuc bo) ---
where git >nul 2>nul
if errorlevel 1 goto :noupdate
if not exist ".git" goto :noupdate
echo Dang kiem tra ban cap nhat tren GitHub...
git fetch --quiet
if errorlevel 1 (
    echo Khong ket noi duoc GitHub, bo qua buoc cap nhat.
    goto :noupdate
)
set "BEHIND=0"
for /f %%i in ('git rev-list --count HEAD..@{u} 2^>nul') do set "BEHIND=%%i"
if "%BEHIND%"=="0" (
    echo Dang la ban moi nhat.
    goto :noupdate
)
echo Co %BEHIND% commit moi tren GitHub.
set "DIRTY="
for /f %%i in ('git status --porcelain --untracked-files=no') do set "DIRTY=1"
if defined DIRTY (
    echo Ban dang co thay doi chua commit, KHONG tu dong pull de tranh mat code. Hay commit hoac stash roi chay lai.
    goto :noupdate
)
git pull --ff-only
if errorlevel 1 (
    echo Pull that bai ^(nhanh da tach khoi GitHub^). Bo qua, build ban hien tai.
) else (
    echo Da cap nhat len ban moi nhat.
)
:noupdate

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
