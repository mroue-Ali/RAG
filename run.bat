@echo off
REM ============================================================
REM  rag - dev launcher
REM  Opens the backend (FastAPI) and the frontend (Vite), each in
REM  its own terminal window, then opens the app in your browser.
REM  Close a window to stop that one.
REM
REM  The database is a Postgres container (docker-compose.yml), so
REM  Docker Desktop should be running. The first visit to a new
REM  instance shows a setup page that creates your account.
REM  What this machine can do (local models, open sign-up) is set
REM  in backend\.env: see backend\.env.example.
REM
REM  The first run sets everything up (Python environment, packages,
REM  config files), so it takes a few minutes. Later runs are quick.
REM  Set RAG_NO_BROWSER=1 to stop it opening a browser tab.
REM ============================================================
setlocal

set "ROOT=%~dp0"
set "BACKEND_URL=http://127.0.0.1:8000"
set "APP_URL=http://localhost:5180"

echo.
echo   rag
echo   ===
echo.

REM ---- Is it already running? ------------------------------------------
REM Our backend's health check reports its database. Something else on the
REM port answers differently, and a second backend there would only fail.
set "BACKEND=stopped"
curl -s -m 2 "%BACKEND_URL%/api/health" > "%TEMP%\rag-probe.txt" 2>nul
if not errorlevel 1 set "BACKEND=foreign"
findstr /c:"\"database\":" "%TEMP%\rag-probe.txt" >nul 2>nul
if not errorlevel 1 set "BACKEND=running"
del "%TEMP%\rag-probe.txt" >nul 2>nul
if "%BACKEND%"=="foreign" goto :port_taken

set "FRONTEND=stopped"
curl -s -m 2 -o nul "%APP_URL%/" 2>nul
if not errorlevel 1 set "FRONTEND=running"

REM ---- [1/4] Tools ------------------------------------------------------
where npm >nul 2>nul
if errorlevel 1 goto :no_node
if exist "%ROOT%backend\venv\Scripts\python.exe" goto :tools_ok
where python >nul 2>nul
if errorlevel 1 goto :no_python
:tools_ok
echo   [1/4] Python and Node.js found.

REM ---- [2/4] Backend ----------------------------------------------------
cd /d "%ROOT%backend"

if exist "venv\Scripts\python.exe" goto :venv_ok
echo   [2/4] Creating the Python environment. First time only.
python -m venv venv
if errorlevel 1 goto :failed
:venv_ok

REM Reinstall only when requirements.txt differs from what was last installed,
REM so pulling a change that adds a package fixes itself on the next run.
fc /b "requirements.txt" "venv\requirements.installed" >nul 2>nul
if not errorlevel 1 goto :packages_ok
echo   [2/4] Installing backend packages. This can take a few minutes.
venv\Scripts\python.exe -m pip install -q --disable-pip-version-check -r requirements.txt
if errorlevel 1 goto :failed
copy /y "requirements.txt" "venv\requirements.installed" >nul
:packages_ok

if exist ".env" goto :env_ok
copy ".env.example" ".env" >nul
echo   [!] Created backend\.env from the example. It uses a local SQLite
echo       database until you put your own DATABASE_URL in it.
:env_ok

REM The database runs in Docker (docker-compose.yml), the same way it will on
REM the VPS. Without Docker the backend still starts, on a local SQLite file.
where docker >nul 2>nul
if errorlevel 1 goto :no_docker
echo   [2/4] Starting the database (Docker).
docker compose -f "%ROOT%docker-compose.yml" up -d --wait db >nul 2>"%TEMP%ag-db.txt"
if errorlevel 1 goto :db_failed
del "%TEMP%ag-db.txt" >nul 2>nul
goto :db_done
:no_docker
echo   [!] Docker is not installed, so the database container cannot start.
echo       The backend will use a local SQLite file instead.
goto :db_done
:db_failed
echo   [!] The database container did not start. Is Docker Desktop running?
echo       The backend will use a local SQLite file until it does.
type "%TEMP%ag-db.txt"
del "%TEMP%ag-db.txt" >nul 2>nul
:db_done
echo   [2/4] Backend ready.

REM ---- [3/4] Frontend ---------------------------------------------------
cd /d "%ROOT%frontend"

fc /b "package.json" "node_modules\.package.installed" >nul 2>nul
if not errorlevel 1 goto :modules_ok
echo   [3/4] Installing frontend packages. This can take a few minutes.
call npm install
if errorlevel 1 goto :failed
copy /y "package.json" "node_modules\.package.installed" >nul
:modules_ok
echo   [3/4] Frontend ready.

REM ---- [4/4] Launch -----------------------------------------------------
if "%BACKEND%"=="running" goto :backend_up
echo   [4/4] Launching backend  -^> %BACKEND_URL%  (docs: /docs)
REM "title" runs inside the new window because Windows Terminal ignores the name given to "start".
start "rag backend" cmd /k "title rag backend && cd /d "%ROOT%backend" && venv\Scripts\python.exe -m uvicorn main:app --reload --reload-dir app --port 8000"
goto :backend_done
:backend_up
echo   [4/4] Backend is already running. Leaving it alone.
:backend_done

if "%FRONTEND%"=="running" goto :frontend_up
echo   [4/4] Launching frontend -^> %APP_URL%
start "rag frontend" cmd /k "title rag frontend && cd /d "%ROOT%frontend" && npm run dev"
goto :frontend_done
:frontend_up
echo   [4/4] Frontend is already running. Leaving it alone.
:frontend_done

REM Wait until both answer, so the browser does not open on an error page.
echo.
echo   Waiting for the app to come up...
for /L %%i in (1,1,90) do (
    curl -s -m 2 -o nul "%BACKEND_URL%/api/health" 2>nul && curl -s -m 2 -o nul "%APP_URL%/" 2>nul && goto :ready
    call :sleep 1
)
echo.
echo   [!] Not answering after 90 seconds. Look in the two windows that
echo       opened: one of them will show what went wrong.
echo.
pause
exit /b 1

:ready
echo   Ready: %APP_URL%
if not defined RAG_NO_BROWSER start "" "%APP_URL%"
echo.
echo   This window can be closed. To stop the app, close the two windows
echo   named "rag backend" and "rag frontend".
call :sleep 6
exit /b 0

REM ======================================================================

:sleep
REM ping instead of timeout: timeout refuses to run when no keyboard is attached.
set /a PINGS=%1 + 1
ping -n %PINGS% 127.0.0.1 >nul
exit /b 0

:no_node
echo   [X] Node.js is not installed.
echo       Install it from https://nodejs.org then run this again.
echo.
pause
exit /b 1

:no_python
echo   [X] Python is not installed.
echo       Install Python 3.11 or newer from https://www.python.org then run this again.
echo.
pause
exit /b 1

:port_taken
echo   [X] Port 8000 is in use by another program, so the backend cannot start.
echo       Close whatever is using it, then run this again.
echo.
pause
exit /b 1

:failed
echo.
echo   [X] Setup failed. Scroll up for the reason.
echo.
pause
exit /b 1
