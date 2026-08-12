@echo off
REM One-shot Android build, same shape as JellyWave's build-release.bat.
REM
REM Two machine-specific workarounds, neither of which changes anything
REM permanently -- both are set for this process only:
REM
REM   JAVA_HOME  JDK 21. Some Capacitor libraries ship Java 21 bytecode, which
REM              an older compiler physically cannot produce. The JDK on PATH
REM              here is 11, so it has to be pointed at explicitly.
REM   TEMP/TMP   The default Windows temp path contains a non-ASCII character
REM              (the accented username), which breaks the JDK's loopback
REM              selector pipe on this machine.
REM
REM Usage:  build-apk.bat            -> debug APK, signed with the debug key
REM         build-apk.bat release    -> release APK, needs android/keystore/

setlocal
set "JAVA_HOME=C:\Program Files\Java\jdk-21"
set "TEMP=C:\jtmp"
set "TMP=C:\jtmp"
if not exist "%TEMP%" mkdir "%TEMP%"

set "TASK=assembleDebug"
if /I "%~1"=="release" set "TASK=assembleRelease"

echo Rebuilding web assets...
call npm run build || exit /b 1
call npx cap sync android || exit /b 1

echo Running gradle %TASK%...
REM Absolute path on purpose: this machine has NoDefaultCurrentDirectoryInExePath
REM set, so cmd won't find gradlew.bat just because it's in the working directory.
pushd "%~dp0android"
call "%~dp0android\gradlew.bat" %TASK%
set "RESULT=%ERRORLEVEL%"
popd

if "%RESULT%"=="0" (
  echo.
  if /I "%TASK%"=="assembleDebug" (
    echo APK: mobile\android\app\build\outputs\apk\debug\app-debug.apk
  ) else (
    echo APK: mobile\android\app\build\outputs\apk\release\app-release.apk
  )
)
exit /b %RESULT%
