@echo off
chcp 65001 >nul
setlocal EnableExtensions DisableDelayedExpansion

for %%I in ("%~dp0.") do set "SCRIPT_DIR=%%~fI"
set "USER_NPM=%APPDATA%\npm"

echo [1/6] Checking Node.js and npm...
where node >nul 2>nul || goto :missing_node
where npm >nul 2>nul || goto :missing_node

for /f "usebackq delims=" %%V in (`node -p "Number(process.versions.node.split('.')[0])"`) do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR goto :missing_node
if %NODE_MAJOR% LSS 20 goto :old_node

echo [2/6] Installing project dependencies...
pushd "%SCRIPT_DIR%"
call npm install --omit=dev
set "NPM_RESULT=%ERRORLEVEL%"
if not "%NPM_RESULT%"=="0" goto :install_failed_popd

echo [3/6] Installing the global mp command...
if not exist "%USER_NPM%" mkdir "%USER_NPM%"
call npm install -g --prefix "%USER_NPM%" --install-links=true "%SCRIPT_DIR%"
set "NPM_RESULT=%ERRORLEVEL%"
if not "%NPM_RESULT%"=="0" goto :install_failed_popd
popd

echo [4/6] Checking the user PATH...
set "MP_USER_BIN=%USER_NPM%"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$bin=$env:MP_USER_BIN; $path=[Environment]::GetEnvironmentVariable('Path','User');" ^
  "$items=@(($path -split ';') | Where-Object { $_ });" ^
  "if (-not ($items | Where-Object { $_.TrimEnd('\') -ieq $bin.TrimEnd('\') })) {" ^
  "  $newPath=if ([string]::IsNullOrWhiteSpace($path)) { $bin } else { $path.TrimEnd(';') + ';' + $bin };" ^
  "  [Environment]::SetEnvironmentVariable('Path',$newPath,'User')" ^
  "}"
if errorlevel 1 goto :path_failed
set "PATH=%USER_NPM%;%PATH%"

echo [5/6] Configuring PowerShell command resolution...
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%\configure-powershell.ps1"
if errorlevel 1 goto :powershell_failed

echo [6/6] Verifying the installation...
if not exist "%USER_NPM%\mp.cmd" goto :verify_failed
if not exist "%USER_NPM%\wxmp.cmd" goto :verify_failed
call "%USER_NPM%\mp.cmd" --version
if errorlevel 1 goto :verify_failed

echo.
echo Installation completed. Open a new terminal, enter a Mini Program project, and run: mp
echo PowerShell fallback command: mp.cmd or wxmp
goto :success

:missing_node
echo.
echo Installation failed: Node.js and npm were not found. Install Node.js 20 or later first.
goto :failed

:old_node
echo.
echo Installation failed: Node.js 20 or later is required. Current major version: %NODE_MAJOR%
goto :failed

:install_failed_popd
popd
echo.
echo Installation failed: npm install returned an error.
goto :failed

:path_failed
echo.
echo Installation failed: unable to add %USER_NPM% to the user PATH.
goto :failed

:powershell_failed
echo.
echo Installation failed: unable to configure the PowerShell mp command.
echo You can still use mp.cmd or wxmp in PowerShell.
goto :failed

:verify_failed
echo.
echo Installation failed: the mp command could not be verified.
goto :failed

:success
if /i not "%~1"=="/nopause" pause
exit /b 0

:failed
if /i not "%~1"=="/nopause" pause
exit /b 1
