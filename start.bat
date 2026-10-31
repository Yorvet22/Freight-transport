@echo off
REM FreightFlow - one-click start (Windows). Requires MySQL 8 and backend\.env.
setlocal
cd /d "%~dp0backend"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18+ is required. Download it from https://nodejs.org
  pause
  exit /b 1
)

if not exist .env (
  echo backend\.env not found.
  echo Copy backend\.env.example to backend\.env and set your MySQL credentials ^(DB_*^) and SESSION_SECRET.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Preparing the database ^(create, migrate, seed demo data if empty^)...
call npm run db:setup
if errorlevel 1 (
  echo Database setup failed. Is MySQL running? Check the DB_* settings in backend\.env.
  pause
  exit /b 1
)

REM Port for the server and browser URL: PORT from backend\.env if set, else 3000.
set "PORT="
for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do if /i "%%A"=="PORT" if not "%%B"=="" set "PORT=%%B"
if "%PORT%"=="" set "PORT=3000"

start "FreightFlow Server" node server.js
timeout /t 3 /nobreak >nul
start "" "http://localhost:%PORT%/login.html"
echo Server window opened. Close it to stop the server.
endlocal
