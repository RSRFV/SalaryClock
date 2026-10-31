# 无 Gradle 的 Android APK 手工构建脚本（JDK17 + build-tools 34 + platform 34）
# 依赖：E:\WorkSpace\.tools 下的 jdk / sdk（本机已验证可用）
$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot
$repo = (Resolve-Path (Join-Path $here '..')).Path
$tools = 'E:\WorkSpace\.tools'
$sdk = Join-Path $tools 'sdk'
$bt = Join-Path $sdk 'build-tools\android-14'
$platform = Join-Path $sdk 'platforms\android-UpsideDownCake'
$jdk = (Get-ChildItem (Join-Path $tools 'jdk') -Directory | Select-Object -First 1).FullName
$env:JAVA_HOME = $jdk
$env:PATH = "$jdk\bin;$env:PATH"

$node = 'D:\nodejs\node.exe'
& $node (Join-Path $here 'scripts\prepare-web.mjs')

$build = Join-Path $here 'build'
if (Test-Path $build) { Remove-Item $build -Recurse -Force }
New-Item -ItemType Directory -Force (Join-Path $build 'gen'), (Join-Path $build 'classes'), (Join-Path $build 'dex') | Out-Null

Write-Host '== aapt2 compile =='
& (Join-Path $bt 'aapt2.exe') compile --dir (Join-Path $here 'res') -o (Join-Path $build 'res.zip')
if ($LASTEXITCODE -ne 0) { throw 'aapt2 compile failed' }

Write-Host '== aapt2 link =='
& (Join-Path $bt 'aapt2.exe') link -o (Join-Path $build 'app-unsigned.apk') `
  -I (Join-Path $platform 'android.jar') `
  --manifest (Join-Path $here 'AndroidManifest.xml') `
  -A (Join-Path $here 'assets') `
  --java (Join-Path $build 'gen') `
  (Join-Path $build 'res.zip')
if ($LASTEXITCODE -ne 0) { throw 'aapt2 link failed' }

Write-Host '== javac =='
$javacCmd = "`"$jdk\bin\javac.exe`" -encoding UTF-8 -source 8 -target 8 -bootclasspath `"$platform\android.jar`" -d `"$build\classes`" `"$build\gen\com\rsrfv\salaryclock\R.java`" `"$here\java\com\rsrfv\salaryclock\MainActivity.java`""
cmd /c $javacCmd
if ($LASTEXITCODE -ne 0) { throw 'javac failed' }

Write-Host '== d8 =='
$classFiles = Get-ChildItem (Join-Path $build 'classes') -Recurse -Filter *.class | ForEach-Object { $_.FullName }
& (Join-Path $bt 'd8.bat') --lib (Join-Path $platform 'android.jar') --min-api 21 --output (Join-Path $build 'dex') @classFiles
if ($LASTEXITCODE -ne 0) { throw 'd8 failed' }

Write-Host '== add classes.dex =='
$py = 'C:\Users\Admin\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
$addDex = @"
import zipfile, sys
apk = r'$build\app-unsigned.apk'
dex = r'$build\dex\classes.dex'
with zipfile.ZipFile(apk, 'a') as z:
    z.write(dex, 'classes.dex')
print('classes.dex added')
"@
$addDex | & $py -

Write-Host '== zipalign =='
& (Join-Path $bt 'zipalign.exe') -f 4 (Join-Path $build 'app-unsigned.apk') (Join-Path $build 'app-aligned.apk')
if ($LASTEXITCODE -ne 0) { throw 'zipalign failed' }

Write-Host '== sign =='
$ks = Join-Path $build 'debug.keystore'
if (-not (Test-Path $ks)) {
  & (Join-Path $jdk 'bin\keytool.exe') -genkeypair -keystore $ks -storepass android -alias androiddebugkey `
    -keypass android -keyalg RSA -keysize 2048 -validity 10000 `
    -dname "CN=Android Debug,O=Android,C=US" -noprompt
}
$dist = Join-Path $repo 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$apk = Join-Path $dist 'SalaryClock-android-debug.apk'
& (Join-Path $bt 'apksigner.bat') sign --ks $ks --ks-pass pass:android --key-pass pass:android --out $apk (Join-Path $build 'app-aligned.apk')
if ($LASTEXITCODE -ne 0) { throw 'apksigner failed' }

Write-Host '== verify =='
& (Join-Path $bt 'apksigner.bat') verify --print-certs $apk
Get-Item $apk | Select-Object FullName, Length, LastWriteTime | Format-List
