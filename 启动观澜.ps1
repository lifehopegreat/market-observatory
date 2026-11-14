$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location -LiteralPath $root
$url = 'http://127.0.0.1:8765'
try {
    $health = Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 2
    if ($health.application -eq 'guanlan') {
        Start-Process $url
        Write-Host "观澜已在运行：$url"
        exit 0
    }
    throw '端口 8765 被其他服务占用，请先停止该服务。'
} catch {
    if ($_.Exception.Message -like '*被其他服务占用*') { throw }
}
$python = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) {
    & python -m venv (Join-Path $root '.venv')
    if ($LASTEXITCODE -ne 0) { throw '需要 Python 3.12+，请安装后重试。' }
    & $python -m pip install -r (Join-Path $root 'requirements.lock')
    if ($LASTEXITCODE -ne 0) { throw '后端依赖安装失败，请检查网络或 Python 环境。' }
}
& $python -c "import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('pypdf') else 1)"
if ($LASTEXITCODE -ne 0) {
    & $python -m pip install -r (Join-Path $root 'requirements.lock')
    if ($LASTEXITCODE -ne 0) { throw '更新后端依赖失败，请检查网络。' }
}
if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules'))) {
    & npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw '前端依赖安装失败，需要 Node.js 22+ 和 npm。' }
}
$index = Join-Path $root 'dist\index.html'
$latestSource = Get-ChildItem -LiteralPath (Join-Path $root 'src') -File -Recurse | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not (Test-Path -LiteralPath $index) -or $latestSource.LastWriteTime -gt (Get-Item -LiteralPath $index).LastWriteTime) {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw '前端构建失败，服务未启动。' }
}
$data = Join-Path $root 'data'
New-Item -ItemType Directory -Path $data -Force | Out-Null
$process = Start-Process -FilePath $python -ArgumentList @('-m','uvicorn','backend.app:app','--host','127.0.0.1','--port','8765','--no-access-log') -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $data 'server.stdout.log') -RedirectStandardError (Join-Path $data 'server.stderr.log')
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 300
    try {
        $health = Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 2
        if ($health.application -eq 'guanlan') {
            Set-Content -LiteralPath (Join-Path $data 'server.pid') -Value $process.Id -Encoding ascii
            Start-Process $url
            Write-Host "观澜已启动：$url；进程 ID：$($process.Id)"
            exit 0
        }
    } catch { }
    if ($process.HasExited) { throw "服务启动失败，查看 $data\server.stderr.log" }
}
if (-not $process.HasExited) { Stop-Process -Id $process.Id }
throw "服务未就绪，查看 $data\server.stderr.log"
