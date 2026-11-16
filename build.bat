@echo off
setlocal EnableExtensions

rem --- Chay tu ban sao trong %TEMP%: git pull co the thay chinh file build.bat trong luc dang chay
rem     (cmd doc file .bat theo tung dong, file bi thay giua chung se chay lech dong). ---
if /i "%~1"=="--copy" goto :main
copy /y "%~f0" "%TEMP%\cvla-build.bat" >nul 2>nul || goto :main
"%TEMP%\cvla-build.bat" --copy "%~dp0."
:main
if /i "%~1"=="--copy" (cd /d "%~2") else (cd /d "%~dp0")

call :version CUR
if defined CUR (echo Phien ban hien tai: %CUR%) else (echo Phien ban hien tai: khong doc duoc package.json)

rem --- Kiem tra ban cap nhat tren GitHub (chi keo khi an toan: co git, la repo git, khong co thay doi cuc bo) ---
if not exist ".git" (
    echo Thu muc nay khong phai repo git ^(tai ZIP?^), bo qua buoc cap nhat.
    goto :noupdate
)
echo Dang kiem tra ban cap nhat tren GitHub...
set "LOG=%TEMP%\cvla-fetch.log"
set "OKGIT="
set "TRIED="
set "SEEN=;"
rem Thu lan luot: git trong PATH, roi Git for Windows o cac cho cai dat thuong gap (may co the co nhieu ban git;
rem ban trong PATH cua cmd co the khong co Git Credential Manager nen repo private bao "Repository not found").
for /f "delims=" %%g in ('where git 2^>nul') do if not defined OKGIT call :tryfetch "%%g"
if not defined OKGIT if exist "%ProgramFiles%\Git\cmd\git.exe" call :tryfetch "%ProgramFiles%\Git\cmd\git.exe"
if not defined OKGIT if exist "%LOCALAPPDATA%\Programs\Git\cmd\git.exe" call :tryfetch "%LOCALAPPDATA%\Programs\Git\cmd\git.exe"
if not defined OKGIT (
    if not defined TRIED (
        echo Khong tim thay git. Cai Git for Windows tai https://git-scm.com roi chay lai. Bo qua buoc cap nhat.
        goto :noupdate
    )
    call :explain
    goto :noupdate
)
rem Dung dung ban git vua fetch duoc cho cac lenh sau.
for %%d in ("%OKGIT%") do set "PATH=%%~dpd;%PATH%"

set "BEHIND=0"
for /f %%i in ('git rev-list --count HEAD..@{u} 2^>nul') do set "BEHIND=%%i"
call :version NEW "@{u}"
if "%BEHIND%"=="0" (
    echo Dang la ban moi nhat: %CUR%
    goto :noupdate
)
if not defined NEW set "NEW=?"
echo.
echo === Co ban moi tren GitHub: %CUR% -^> %NEW% ^(%BEHIND% commit^) ===
git log --oneline -n 10 HEAD..@{u}
echo.
set "ANS="
set /p "ANS=Cap nhat len %NEW% roi build? [y/N] "
if /i not "%ANS%"=="y" (
    echo Bo qua cap nhat, build ban hien tai %CUR%.
    goto :noupdate
)
set "DIRTY="
for /f %%i in ('git status --porcelain --untracked-files=no') do set "DIRTY=1"
if not defined DIRTY goto :dopull
echo.
echo Cac file dang co thay doi chua commit:
git status --porcelain --untracked-files=no
echo.
set "ANS2="
set /p "ANS2=Ghi de ^(BO^) cac thay doi nay de cap nhat? [y/N] "
if /i not "%ANS2%"=="y" (
    echo Giu nguyen thay doi cua ban, bo qua cap nhat, build ban hien tai %CUR%.
    goto :noupdate
)
git reset --hard HEAD
if errorlevel 1 (
    echo Khong bo duoc thay doi. Bo qua cap nhat.
    goto :noupdate
)
:dopull
git pull --ff-only
if errorlevel 1 (
    echo Pull that bai ^(nhanh da tach khoi GitHub^). Bo qua, build ban hien tai %CUR%.
) else (
    call :version CUR
    echo Da cap nhat len ban moi nhat: %CUR%
)
:noupdate

rem --- Can Node.js >= %NODEMIN% (build.mjs dung top-level await; Node cu bao "Unexpected reserved word"). Thieu / cu thi tu cai LTS. ---
set "NODEMIN=18"
call :nodecheck
if not defined NODEOK (
    if defined NODEVER (echo Node.js %NODEVER% qua cu, can ban %NODEMIN% tro len. Dang cai dat Node.js LTS...) else (echo Node.js chua duoc cai. Dang cai dat Node.js LTS...)
    where winget >nul 2>nul
    if errorlevel 1 (
        echo Khong tim thay winget. Hay cai Node.js %NODEMIN% tro len thu cong tai https://nodejs.org roi chay lai.
        pause
        exit /b 1
    )
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
    if errorlevel 1 winget upgrade --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
    rem Cap nhat PATH cho phien hien tai, dat len dau de ban moi thang ban cu.
    set "PATH=%ProgramFiles%\nodejs;%APPDATA%\npm;%PATH%"
    call :nodecheck
    if not defined NODEOK (
        echo Da cai Node.js nhung phien nay chua nhan ban moi. Hay dong cua so nay va chay lai build.bat.
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

call :version CUR
echo.
echo Build xong phien ban %CUR% -^> thu muc dist. Edge: edge://extensions -^> Reload.
pause
exit /b 0

rem ============================================================================
rem :nodecheck - dat NODEVER (ban dang co, rong neu chua cai) va NODEOK=1 neu major >= NODEMIN.
:nodecheck
set "NODEVER="
set "NODEOK="
where node >nul 2>nul || exit /b 0
for /f "usebackq delims=" %%v in (`node -p "process.versions.node" 2^>nul`) do set "NODEVER=%%v"
set "NODEMAJOR="
for /f "usebackq delims=" %%v in (`node -p "process.versions.node.split('.')[0]" 2^>nul`) do set "NODEMAJOR=%%v"
if not defined NODEMAJOR exit /b 0
if %NODEMAJOR% GEQ %NODEMIN% set "NODEOK=1"
exit /b 0

rem :tryfetch "duong\dan\git.exe" - fetch bang ban git nay; that bai thi thu lai voi Git Credential Manager
rem (hien hop dang nhap GitHub neu chua dang nhap). Thanh cong thi dat OKGIT.
:tryfetch
rem Bo qua ban git da thu (cung duong dan xuat hien ca trong PATH lan o cho cai dat mac dinh).
echo "%SEEN%" | find /i ";%~1;" >nul && exit /b 1
set "SEEN=%SEEN%%~1;"
set "TRIED=1"
echo   git: %~1
"%~1" fetch >"%LOG%" 2>&1
if not errorlevel 1 (set "OKGIT=%~1" & exit /b 0)
for %%h in (manager manager-core) do (
    if not defined OKGIT (
        "%~1" -c credential.helper= -c credential.helper=%%h fetch >"%LOG%.2" 2>&1
        if not errorlevel 1 set "OKGIT=%~1"
    )
)
if defined OKGIT (echo   ^(dang nhap qua Git Credential Manager^) & exit /b 0)
exit /b 1

rem :explain - in loi that cua git va goi y cach sua theo loai loi.
:explain
echo.
echo Khong fetch duoc tu GitHub. Loi git:
type "%LOG%"
findstr /i /c:"dubious ownership" /c:"unsafe repository" "%LOG%" >nul && (
    echo.
    echo =^> Git chan repo vi thu muc thuoc tai khoan Windows khac ^(chay bang Administrator, o USB, clone bang user khac^).
    echo    Cach sua: git config --global --add safe.directory "%CD:\=/%"
    choice /c YN /n /t 20 /d N /m "   Them ngay vao safe.directory? [Y/N] "
    if not errorlevel 2 (
        git config --global --add safe.directory "%CD:\=/%" && echo    Da them. Hay chay lai build.bat.
    )
    exit /b 0
)
findstr /i /c:"Repository not found" /c:"Authentication failed" /c:"could not read Username" /c:"403" "%LOG%" >nul && (
    echo.
    echo =^> Repo la private: GitHub bao "not found" khi git khong gui thong tin dang nhap, hoac dang nhap bang tai khoan chua duoc them collaborator.
    echo    - Neu ban pull bang GitHub Desktop: dang nhap do KHONG dung duoc cho git dong lenh.
    echo      Mo Git Bash trong thu muc nay, chay: git fetch  ^(hop dang nhap GitHub hien ra, dang nhap DUNG tai khoan collaborator^), roi chay lai build.bat.
    echo    - Neu may da luu tai khoan GitHub khac: Windows ^> Credential Manager ^> Windows Credentials ^> xoa muc git:https://github.com, roi lam nhu tren.
    exit /b 0
)
findstr /i /c:"Could not resolve host" /c:"unable to access" /c:"timed out" "%LOG%" >nul && (
    echo.
    echo =^> Khong ket noi duoc GitHub ^(mang / proxy^). Bo qua cap nhat, build ban hien tai.
)
exit /b 0

rem :version BIEN [ref] - doc "version" trong package.json (o thu muc hien tai, hoac o ref git nhu @{u}) vao bien BIEN.
:version
set "%~1="
if "%~2"=="" (
    for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "try { (Get-Content -Raw package.json | ConvertFrom-Json).version } catch {}" 2^>nul`) do set "%~1=%%v"
) else (
    for /f "usebackq delims=" %%v in (`git show %~2:package.json 2^>nul ^| powershell -NoProfile -Command "try { ($input | Out-String | ConvertFrom-Json).version } catch {}"`) do set "%~1=%%v"
)
exit /b 0
