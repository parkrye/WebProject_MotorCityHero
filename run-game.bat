@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 모터시티 히어로 : 미스터 D - 로컬 서버

rem py 런처를 우선 쓰고, 없으면 python 을 찾는다.
set "PYCMD="
where py >nul 2>&1 && set "PYCMD=py -3"
if not defined PYCMD (
  where python >nul 2>&1 && set "PYCMD=python"
)
if not defined PYCMD (
  echo.
  echo  [!] Python 을 찾지 못했습니다.
  echo      https://www.python.org/downloads/ 에서 설치한 뒤 다시 실행하세요.
  echo      설치할 때 "Add python.exe to PATH" 를 반드시 체크해야 합니다.
  echo.
  pause
  exit /b 1
)

rem 인자는 그대로 넘긴다. 예) run-game.bat --port 50000 / --local-only / --close-firewall
%PYCMD% "tools\serve.py" %*
set "EXITCODE=%ERRORLEVEL%"

if not "%EXITCODE%"=="0" (
  echo.
  echo  [!] 서버가 종료되었습니다. ^(코드 %EXITCODE%^)
  pause
)
exit /b %EXITCODE%
