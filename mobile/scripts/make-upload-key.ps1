# Makes BiteVo Rider's upload key for the Google Play Store, once. The .aab builds
# (npm run build:android -- -AppUrl https://driverapi.bitevo.in -Bundle) are signed with it.
#   ~/.bitevo/rider-upload.jks          the key (RSA 2048, valid ~27 years, alias "upload")
#   ~/.bitevo/rider-upload.properties   where it is and its password (random, never printed or committed)
# Back up BOTH files somewhere safe (a password manager, an encrypted drive): every update to the Play Store
# must be signed with this same key. If it is lost, Play support can reset it, which takes days.
# The key stays out of the repo. It never overwrites an existing key.
param([string]$Folder = (Join-Path $HOME '.bitevo'))
$ErrorActionPreference = 'Stop'

$jks = Join-Path $Folder 'rider-upload.jks'
$props = Join-Path $Folder 'rider-upload.properties'
if ((Test-Path $jks) -or (Test-Path $props)) {
  throw "An upload key is already there ($Folder). Not making another: Play only accepts the key it has seen."
}

# keytool from the same Java the build uses.
$tools = if ($env:BITEVO_ANDROID_TOOLS) { $env:BITEVO_ANDROID_TOOLS } else { 'D:\Android' }
$java = if (Test-Path "$tools\jdk") { (Get-ChildItem "$tools\jdk" -Directory | Select-Object -First 1).FullName }
        elseif ($env:JAVA_HOME) { $env:JAVA_HOME }
        else { Join-Path $env:ProgramFiles 'Android\Android Studio\jbr' }
$keytool = Join-Path $java 'bin\keytool.exe'
if (-not (Test-Path $keytool)) { throw "No keytool at ${keytool}: install Android Studio, or set JAVA_HOME." }

# A random 32-character password (PKCS12 keys use the store's password for the key too).
$chars = [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$password = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })

New-Item -ItemType Directory -Force $Folder | Out-Null
# keytool reports progress on stderr, which Windows PowerShell would take for an error under 'Stop'.
$ErrorActionPreference = 'Continue'
& $keytool -genkeypair -keystore $jks -storetype PKCS12 -alias upload -keyalg RSA -keysize 2048 -validity 10000 `
  -storepass $password -keypass $password -dname 'CN=BiteVo Rider, O=BiteVo, C=IN' 2>&1 | Out-Null
$made = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($made -ne 0 -or -not (Test-Path $jks)) { throw "keytool failed ($made)" }

# Forward slashes: a backslash is an escape character in .properties files.
@(
  "storeFile=$($jks -replace '\\', '/')"
  "storePassword=$password"
  'keyAlias=upload'
  "keyPassword=$password"
) | Set-Content -Path $props -Encoding ascii

$ErrorActionPreference = 'Continue'
$sha = (& $keytool -list -v -keystore $jks -storepass $password -alias upload 2>$null | Select-String 'SHA256:').ToString().Trim()
$ErrorActionPreference = 'Stop'
"Upload key made: $jks"
"Its password is in: $props"
"Certificate $sha"
'Back up both files now. Every Play Store update must be signed with this key.'
