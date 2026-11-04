$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$logRoot = Join-Path $projectRoot '.local'
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
$pythonPath = Join-Path $projectRoot 'backend\.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw 'Create backend/.venv and install backend/requirements.txt first; see README.md.'
}
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'frontend\node_modules\vite\bin\vite.js'))) {
    throw 'Run npm ci in frontend first.'
}

function Test-Endpoint([string]$Url, [string]$Expected) {
    try {
        $response = Invoke-WebRequest -Uri $Url -TimeoutSec 2 -UseBasicParsing
        return $response.Content.Contains($Expected)
    } catch { return $false }
}

if (-not (Test-Endpoint 'http://127.0.0.1:8000/' 'FinSense Board API is running')) {
    if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Where-Object OwningProcess -gt 0) {
        throw 'Port 8000 is occupied by another service.'
    }
    $apiProcess = Start-Process -FilePath $pythonPath -ArgumentList '-u','-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8000' -WorkingDirectory (Join-Path $projectRoot 'backend') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot 'backend.out.log') -RedirectStandardError (Join-Path $logRoot 'backend.err.log') -PassThru
    $apiProcess.Id | Set-Content (Join-Path $logRoot 'backend.pid')
}
if (-not (Test-Endpoint 'http://127.0.0.1:5173/' 'ZPBOARD')) {
    if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | Where-Object OwningProcess -gt 0) {
        throw 'Port 5173 is occupied by another service.'
    }
    $nodePath = (Get-Command node.exe).Source
    $webProcess = Start-Process -FilePath $nodePath -ArgumentList 'node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort' -WorkingDirectory (Join-Path $projectRoot 'frontend') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot 'frontend.out.log') -RedirectStandardError (Join-Path $logRoot 'frontend.err.log') -PassThru
    $webProcess.Id | Set-Content (Join-Path $logRoot 'frontend.pid')
}
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    if ((Test-Endpoint 'http://127.0.0.1:8000/health' 'healthy') -and (Test-Endpoint 'http://127.0.0.1:5173/' 'ZPBOARD')) {
        Write-Host 'Dashboard: http://127.0.0.1:5173'
        Write-Host 'API docs:  http://127.0.0.1:8000/docs'
        exit 0
    }
    Start-Sleep -Seconds 1
}
throw 'Startup failed. Check .local/backend.err.log and .local/frontend.err.log.'
