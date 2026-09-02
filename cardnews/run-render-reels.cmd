@echo off
setlocal
REM ---------------------------------------------------------------
REM  ASCII ONLY. Do NOT put Korean text or emoji in this file.
REM  2026-08-11: Korean REM comments silently broke cmd parsing and
REM  the script still returned exit 0 (false success).
REM
REM  Why this wrapper exists (2026-08-21):
REM    1) NODE PIN. The nvm symlink C:\nvm4w\nodejs is switched to
REM       node 10 for day-job work. render-reels.mjs is ESM, so a
REM       bare "node render-reels.mjs" dies with a confusing
REM       "Cannot find module" / SyntaxError stack from node 10.
REM    2) WORKING DIRECTORY. Running from any other folder used to
REM       fail. render-reels.mjs now resolves paths from its own
REM       location, and this wrapper cd's here as well.
REM
REM  Usage:
REM    run-render-reels.cmd                  all recipes, no upload
REM    run-render-reels.cmd --drive          all recipes + Drive
REM    run-render-reels.cmd reels-297        one recipe
REM    run-render-reels.cmd reels-297 --drive
REM ---------------------------------------------------------------
set "HERE=%~dp0"
set "NODE=%LOCALAPPDATA%\nvm\v22.21.1\node.exe"
if not exist "%NODE%" set "NODE=C:\nvm4w\nodejs\node.exe"

pushd "%HERE%"
"%NODE%" --version
"%NODE%" "%HERE%render-reels.mjs" %*
set "RC=%ERRORLEVEL%"
if %RC%==0 (
  "%NODE%" "%HERE%hook-check.mjs"
  set "RC=%ERRORLEVEL%"
)
popd
endlocal & exit /b %RC%
