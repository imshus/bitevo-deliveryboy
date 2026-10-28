# Builds BiteVo Rider (the APK) on this PC, with Java 17, the Android SDK and Gradle's download cache kept in
# D:\Android like the customer app (set BITEVO_ANDROID_TOOLS for another folder). Nothing is changed in Windows'
# settings: the paths apply only while this script runs. The APK is copied to mobile\BiteVoRider.apk.
#   npm run build:android                                       the dev server, as the Android emulator sees it
#   npm run build:android -- -AppUrl http://192.168.1.20:2003   the dev server, from a phone on the same Wi-Fi
#   npm run build:android -- -AppUrl https://rider.bitevo.in    the live app
#   npm run test:sender                                         LocationSender against the dev API (no APK)
param(
  # The rider web app. Also the API, unless ApiUrl says it lives on another domain.
  [string]$AppUrl = $(if ($env:BITEVO_RIDER_URL) { $env:BITEVO_RIDER_URL } else { 'http://10.0.2.2:2003' }),
  [string]$ApiUrl = $env:BITEVO_RIDER_API_URL,
  [switch]$Test,
  [string]$TestApi = 'http://127.0.0.1:4002'
)
$ErrorActionPreference = 'Stop'
$tools = if ($env:BITEVO_ANDROID_TOOLS) { $env:BITEVO_ANDROID_TOOLS } else { 'D:\Android' }
$env:JAVA_HOME = (Get-ChildItem (Join-Path $tools 'jdk') -Directory | Select-Object -First 1).FullName
$env:ANDROID_HOME = Join-Path $tools 'Sdk'
$env:GRADLE_USER_HOME = Join-Path $tools 'gradle-home'

$mobile = Split-Path $PSScriptRoot -Parent
if ($Test) {
  $tasks = @('testDebugUnitTest', '--rerun', "-PtestApi=$TestApi")
} else {
  $tasks = @('assembleRelease', "-PappUrl=$AppUrl")
  if ($ApiUrl) { $tasks += "-PapiUrl=$ApiUrl" }
}
Push-Location (Join-Path $mobile 'android')
try {
  & .\gradlew.bat @tasks --console=plain
  if ($LASTEXITCODE -ne 0) { throw "Gradle failed ($LASTEXITCODE)" }
} finally {
  Pop-Location
}
if ($Test) { return }

$apk = Join-Path $mobile 'android\app\build\outputs\apk\release\app-release.apk'
$out = Join-Path $mobile 'BiteVoRider.apk'
Copy-Item $apk $out -Force
"APK ready: $out ($([math]::Round((Get-Item $out).Length / 1MB, 1)) MB), for $AppUrl"
