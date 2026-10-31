# 启动本地预览：静态服务 + 自动打开浏览器
# 用法：右键「使用 PowerShell 运行」，或在本目录执行 .\start-demo.ps1

$ErrorActionPreference = 'Stop'
$port = 8787
$root = $PSScriptRoot

$python = 'C:\Users\Admin\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
if (-not (Test-Path $python)) {
  $cmd = Get-Command python -ErrorAction SilentlyContinue
  if (-not $cmd) { Write-Host '未找到 Python，请安装 Python 3 或改用其他静态服务器。' -ForegroundColor Red; exit 1 }
  $python = $cmd.Source
}

$url = "http://127.0.0.1:$port/"

# 端口已被占用（例如上次的预览还开着）则直接打开浏览器
$busy = $null -ne (Test-NetConnection -ComputerName 127.0.0.1 -Port $port -WarningAction SilentlyContinue | Where-Object { $_.TcpTestSucceeded })
if ($busy) {
  Write-Host "端口 $port 已在监听，直接打开 $url" -ForegroundColor Yellow
  Start-Process $url
  exit 0
}

$server = Start-Process -FilePath $python `
  -ArgumentList @('-m', 'http.server', "$port", '--bind', '127.0.0.1', '--directory', $root) `
  -PassThru -WindowStyle Hidden

Start-Sleep -Milliseconds 1200
Start-Process $url

Write-Host ''
Write-Host "时薪时钟预览已启动：$url" -ForegroundColor Green
Write-Host '按 Ctrl+C 停止服务。' -ForegroundColor DarkGray
Write-Host ''

try {
  Wait-Process -Id $server.Id
} finally {
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
}
