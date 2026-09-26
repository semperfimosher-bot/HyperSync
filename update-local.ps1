$ErrorActionPreference = "Stop"

$Repo = "C:\Users\TrojanIV\Desktop\HyperSync"
$Branch = "feature/offline-pwa-downloads"

$PreferredFrontendPort = 4153
$PreferredBackendPort = 8000

Write-Host ""
Write-Host "=== HyperSync Local Update + Reboot ===" -ForegroundColor Cyan


# ------------------------------------------------------------
# Helpers
# ------------------------------------------------------------

function Test-PortInUse {
    param(
        [int]$Port
    )

    $connection = Get-NetTCPConnection `
        -LocalPort $Port `
        -State Listen `
        -ErrorAction SilentlyContinue

    return $null -ne $connection
}


function Get-FreePort {
    param(
        [int[]]$Ports
    )

    foreach ($port in $Ports) {
        if (-not (Test-PortInUse -Port $port)) {
            return $port
        }
    }

    throw "Could not find a free HyperSync development port."
}


function Stop-HyperSyncProcesses {
    Write-Host ""
    Write-Host "Stopping old HyperSync servers..." -ForegroundColor Yellow

    $processes = Get-CimInstance Win32_Process `
        -ErrorAction SilentlyContinue |
        Where-Object {
            $commandLine = [string]$_.CommandLine

            if ([string]::IsNullOrWhiteSpace($commandLine)) {
                return $false
            }

            $isHyperSync =
                $commandLine.IndexOf(
                    $Repo,
                    [System.StringComparison]::OrdinalIgnoreCase
                ) -ge 0

            $isDevServer =
                $commandLine -match "vite" -or
                $commandLine -match "npm(\.cmd)?\s+run\s+dev" -or
                $commandLine -match "uvicorn\s+backend\.app\.main:app"

            return $isHyperSync -and $isDevServer
        }

    foreach ($process in $processes) {
        try {
            Write-Host "Stopping PID $($process.ProcessId)" `
                -ForegroundColor DarkGray

            Stop-Process `
                -Id $process.ProcessId `
                -Force `
                -ErrorAction Stop
        }
        catch {
            Write-Warning (
                "Could not stop PID " +
                $process.ProcessId
            )
        }
    }

    Start-Sleep -Milliseconds 750
}


# ------------------------------------------------------------
# Go to repo
# ------------------------------------------------------------

Set-Location $Repo


# ------------------------------------------------------------
# Refuse to update if a merge conflict is unresolved
# ------------------------------------------------------------

$unmergedFiles = @(
    git diff `
        --name-only `
        --diff-filter=U
)

if ($unmergedFiles.Count -gt 0) {
    Write-Host ""
    Write-Host "Git has unresolved merge conflicts:" `
        -ForegroundColor Red

    foreach ($file in $unmergedFiles) {
        Write-Host "  $file" -ForegroundColor Red
    }

    throw "Resolve the merge conflict before running update-local.ps1."
}


# ------------------------------------------------------------
# Update feature branch
# ------------------------------------------------------------

Write-Host ""
Write-Host "Updating Git branch..." -ForegroundColor Yellow

git fetch origin

git switch $Branch

git pull `
    --rebase `
    --autostash `
    origin `
    $Branch

if ($LASTEXITCODE -ne 0) {
    throw "Git update failed."
}


Write-Host ""
Write-Host "Current commit:" -ForegroundColor Cyan

git log -1 --oneline


# ------------------------------------------------------------
# Update frontend dependencies
# ------------------------------------------------------------

Write-Host ""
Write-Host "Checking frontend dependencies..." -ForegroundColor Yellow

Set-Location "$Repo\frontend"

npm install

if ($LASTEXITCODE -ne 0) {
    throw "npm install failed."
}


# ------------------------------------------------------------
# Stop previous HyperSync dev servers
# ------------------------------------------------------------

Set-Location $Repo

Stop-HyperSyncProcesses


# ------------------------------------------------------------
# Pick clean ports
# ------------------------------------------------------------

$FrontendPort = Get-FreePort `
    -Ports @(
        $PreferredFrontendPort
        4154
        4155
        4156
        4157
        4158
        4159
        4160
        5173
        5174
        5175
    )


$BackendPort = Get-FreePort `
    -Ports @(
        $PreferredBackendPort
        8001
        8002
        8003
        8004
        8005
    )


$FrontendUrl = "http://localhost:$FrontendPort"
$BackendUrl = "http://127.0.0.1:$BackendPort"


# ------------------------------------------------------------
# Start backend
# ------------------------------------------------------------

Write-Host ""
Write-Host "Starting backend..." -ForegroundColor Green
Write-Host $BackendUrl -ForegroundColor DarkCyan

$BackendCommand = @"
Set-Location '$Repo'
& '$Repo\.venv\Scripts\python.exe' -m uvicorn backend.app.main:app --host 127.0.0.1 --port $BackendPort --reload
"@

Start-Process powershell.exe `
    -WorkingDirectory $Repo `
    -ArgumentList @(
        "-NoLogo"
        "-NoExit"
        "-ExecutionPolicy"
        "Bypass"
        "-Command"
        $BackendCommand
    )


# ------------------------------------------------------------
# Wait until backend is actually ready
# ------------------------------------------------------------

Write-Host ""
Write-Host "Waiting for backend..." -ForegroundColor Yellow

$BackendReady = $false

for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
        $response = Invoke-WebRequest `
            -Uri "$BackendUrl/" `
            -UseBasicParsing `
            -TimeoutSec 1

        if ($response.StatusCode -eq 200) {
            $BackendReady = $true
            break
        }
    }
    catch {
        # Backend is still starting.
    }

    Start-Sleep -Milliseconds 500
}

if (-not $BackendReady) {
    throw (
        "Backend did not become ready at " +
        $BackendUrl +
        ". Check the backend PowerShell window."
    )
}

Write-Host "Backend is ready." -ForegroundColor Green


# ------------------------------------------------------------
# Start frontend only AFTER backend is ready
# ------------------------------------------------------------

Write-Host ""
Write-Host "Starting frontend..." -ForegroundColor Green
Write-Host $FrontendUrl -ForegroundColor Green

$FrontendCommand = @"
`$env:HYPERSYNC_DEV_HOST = 'localhost'
`$env:HYPERSYNC_DEV_PORT = '$FrontendPort'
`$env:HYPERSYNC_BACKEND_PORT = '$BackendPort'

Set-Location '$Repo\frontend'

npm run dev
"@

Start-Process powershell.exe `
    -WorkingDirectory "$Repo\frontend" `
    -ArgumentList @(
        "-NoLogo"
        "-NoExit"
        "-ExecutionPolicy"
        "Bypass"
        "-Command"
        $FrontendCommand
    )


# ------------------------------------------------------------
# Wait until frontend is ready
# ------------------------------------------------------------

Write-Host ""
Write-Host "Waiting for frontend..." -ForegroundColor Yellow

$FrontendReady = $false

for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
        $response = Invoke-WebRequest `
            -Uri $FrontendUrl `
            -UseBasicParsing `
            -TimeoutSec 1

        if ($response.StatusCode -eq 200) {
            $FrontendReady = $true
            break
        }
    }
    catch {
        # Frontend is still starting.
    }

    Start-Sleep -Milliseconds 500
}

if (-not $FrontendReady) {
    throw (
        "Frontend did not become ready at " +
        $FrontendUrl +
        ". Check the frontend PowerShell window."
    )
}

Write-Host "Frontend is ready." -ForegroundColor Green


# ------------------------------------------------------------
# Open browser
# ------------------------------------------------------------

Write-Host ""
Write-Host "Opening HyperSync..." -ForegroundColor Green

Start-Process $FrontendUrl


# ------------------------------------------------------------
# Done
# ------------------------------------------------------------

Set-Location $Repo

Write-Host ""
Write-Host "===================================" -ForegroundColor Green
Write-Host " HyperSync updated and restarted" -ForegroundColor Green
Write-Host " Branch:   $Branch" -ForegroundColor Green
Write-Host " Backend:  $BackendUrl" -ForegroundColor Green
Write-Host " Frontend: $FrontendUrl" -ForegroundColor Green
Write-Host "===================================" -ForegroundColor Green
Write-Host ""