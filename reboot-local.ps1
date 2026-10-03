[CmdletBinding()]
param(
    [int]$FrontendPort = 4153,
    [int]$BackendPort = 8000,
    [switch]$NoBrowser,
    [switch]$StopOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$FrontendRoot = Join-Path $RepoRoot "frontend"
$PythonPath = Join-Path $RepoRoot ".venv\Scripts\python.exe"
$PackageJson = Join-Path $FrontendRoot "package.json"

function Assert-OnDemandRuntime {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue

    if ($null -eq $nodeCommand) {
        $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    }

    if ($null -eq $nodeCommand) {
        throw (
            "Node.js was not found in PATH. " +
            "The on-demand yt-dlp extractor requires Node locally."
        )
    }

    $ffmpegCommand = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue

    if ($null -eq $ffmpegCommand) {
        $ffmpegCommand = Get-Command ffmpeg -ErrorAction SilentlyContinue
    }

    if ($null -eq $ffmpegCommand) {
        throw (
            "FFmpeg was not found in PATH. " +
            "Install FFmpeg so on-demand tracks can be normalized and published."
        )
    }

    $ffprobeCommand = Get-Command ffprobe.exe -ErrorAction SilentlyContinue

    if ($null -eq $ffprobeCommand) {
        $ffprobeCommand = Get-Command ffprobe -ErrorAction SilentlyContinue
    }

    if ($null -eq $ffprobeCommand) {
        throw (
            "ffprobe was not found in PATH. " +
            "Install the complete FFmpeg package so audio validation can run."
        )
    }

    & $PythonPath -c "import yt_dlp; print(yt_dlp.version.__version__)" | Out-Null

    if ($LASTEXITCODE -ne 0) {
        throw (
            "yt-dlp is not available in the HyperSync virtual environment. " +
            "Run go again without -SkipDependencies."
        )
    }

    Write-Host ""
    Write-Host "On-demand runtime ready:" -ForegroundColor Cyan
    Write-Host ("  Node:    " + (& $nodeCommand.Source --version)) -ForegroundColor Green

    $ffmpegVersion = @(
        & $ffmpegCommand.Source -version 2>$null
    )[0]

    Write-Host ("  FFmpeg:  " + $ffmpegVersion) -ForegroundColor Green
    Write-Host "  ffprobe: ready" -ForegroundColor Green
    Write-Host "  yt-dlp:  ready" -ForegroundColor Green
}

function ConvertTo-PowerShellLiteral {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    return "'" + $Value.Replace("'", "''") + "'"
}

function Test-PortInUse {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port
    )

    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    return $null -ne $listener
}

function Get-FirstFreePort {
    param(
        [Parameter(Mandatory = $true)]
        [int[]]$Candidates
    )

    foreach ($candidate in $Candidates) {
        if (-not (Test-PortInUse -Port $candidate)) {
            return $candidate
        }
    }

    throw "HyperSync could not find a free local development port."
}

function Test-HyperSyncDevCommandLine {
    param(
        [string]$CommandLine
    )

    if ([string]::IsNullOrWhiteSpace($CommandLine)) {
        return $false
    }

    $belongsToRepo =
        $CommandLine.IndexOf(
            $RepoRoot,
            [System.StringComparison]::OrdinalIgnoreCase
        ) -ge 0

    if (-not $belongsToRepo) {
        return $false
    }

    return (
        $CommandLine -match "HYPERSYNC_LOCAL_SERVER" -or
        $CommandLine -match "vite(\.js)?" -or
        $CommandLine -match "uvicorn\s+backend\.app\.main:app" -or
        $CommandLine -match "npm(\.cmd)?\s+run\s+dev"
    )
}

function Get-HyperSyncProcessTreeIds {
    $allProcesses = @(
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
    )

    $rootIds = @(
        $allProcesses |
            Where-Object {
                Test-HyperSyncDevCommandLine -CommandLine ([string]$_.CommandLine)
            } |
            ForEach-Object {
                [int]$_.ProcessId
            }
    )

    if ($rootIds.Count -eq 0) {
        return @()
    }

    $selected = [System.Collections.Generic.HashSet[int]]::new()

    foreach ($rootId in $rootIds) {
        [void]$selected.Add($rootId)
    }

    $changed = $true

    while ($changed) {
        $changed = $false

        foreach ($process in $allProcesses) {
            $parentId = [int]$process.ParentProcessId
            $processId = [int]$process.ProcessId

            if (
                $selected.Contains($parentId) -and
                -not $selected.Contains($processId)
            ) {
                [void]$selected.Add($processId)
                $changed = $true
            }
        }
    }

    return @($selected | ForEach-Object { $_ })
}

function Stop-HyperSyncDevProcesses {
    Write-Host ""
    Write-Host "Stopping old HyperSync local servers..." -ForegroundColor Yellow

    for ($pass = 0; $pass -lt 3; $pass += 1) {
        $processIds = @(
            Get-HyperSyncProcessTreeIds
        )

        if ($processIds.Count -eq 0) {
            if ($pass -eq 0) {
                Write-Host "No old HyperSync dev processes found." -ForegroundColor DarkGray
            }

            return
        }

        foreach ($processId in ($processIds | Sort-Object -Descending)) {
            if ($processId -eq $PID) {
                continue
            }

            try {
                Stop-Process -Id $processId -Force -ErrorAction Stop

                Write-Host (
                    "Stopped PID " +
                    $processId
                ) -ForegroundColor DarkGray
            }
            catch {
                if (
                    Get-Process -Id $processId -ErrorAction SilentlyContinue
                ) {
                    Write-Warning (
                        "Could not stop HyperSync PID " +
                        $processId +
                        ": " +
                        $_.Exception.Message
                    )
                }
            }
        }

        Start-Sleep -Milliseconds 500
    }

    $remaining = @(
        Get-HyperSyncProcessTreeIds
    )

    if ($remaining.Count -gt 0) {
        throw (
            "HyperSync could not stop all old local server processes. " +
            "Remaining PIDs: " +
            ($remaining -join ", ")
        )
    }
}

function Wait-ForHttp {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url,

        [int]$Attempts = 120
    )

    for ($attempt = 0; $attempt -lt $Attempts; $attempt += 1) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 1

            if (
                $response.StatusCode -ge 200 -and
                $response.StatusCode -lt 500
            ) {
                return $true
            }
        }
        catch {
            # The server is still starting.
        }

        Start-Sleep -Milliseconds 250
    }

    return $false
}

if (-not (Test-Path -LiteralPath $PythonPath)) {
    throw (
        "HyperSync virtual environment was not found at " +
        $PythonPath +
        ". Run update-local.ps1 or go so dependencies can be prepared."
    )
}

if (-not (Test-Path -LiteralPath $PackageJson)) {
    throw "frontend/package.json was not found."
}

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue

if ($null -eq $npmCommand) {
    $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
}

if ($null -eq $npmCommand) {
    throw "npm was not found in PATH."
}

$currentPowerShell = (
    Get-Process -Id $PID -ErrorAction SilentlyContinue
).Path

if ([string]::IsNullOrWhiteSpace($currentPowerShell)) {
    $currentPowerShell = "powershell.exe"
}

Stop-HyperSyncDevProcesses

if ($StopOnly) {
    Write-Host "Old HyperSync local servers are stopped." -ForegroundColor Green
    return
}

Assert-OnDemandRuntime

if ($BackendPort -gt 0) {
    if (Test-PortInUse -Port $BackendPort) {
        throw (
            "Requested backend port " +
            $BackendPort +
            " is already in use by a non-HyperSync process."
        )
    }
}
else {
    $BackendPort = 8000
}

if ($FrontendPort -gt 0) {
    if (Test-PortInUse -Port $FrontendPort) {
        throw (
            "Requested frontend port " +
            $FrontendPort +
            " is already in use by a non-HyperSync process."
        )
    }
}
else {
    $FrontendPort = 4153
}

$FrontendUrl = "http://localhost:$FrontendPort"
$BackendUrl = "http://127.0.0.1:$BackendPort"

$repoLiteral = ConvertTo-PowerShellLiteral $RepoRoot
$frontendLiteral = ConvertTo-PowerShellLiteral $FrontendRoot
$pythonLiteral = ConvertTo-PowerShellLiteral $PythonPath
$npmLiteral = ConvertTo-PowerShellLiteral $npmCommand.Source

$backendCommandTemplate = @'
$env:HYPERSYNC_LOCAL_SERVER = 'backend'
$env:ENVIRONMENT = 'development'
$env:BACKEND_HOST = '127.0.0.1'
$env:BACKEND_PORT = '{2}'
$env:FRONTEND_PUBLIC_URL = '{3}'
$env:FRONTEND_ORIGINS = '{3},http://127.0.0.1:{4}'
Set-Location -LiteralPath {0}
& {1} -m uvicorn backend.app.main:app --host 127.0.0.1 --port {2} --reload
'@

$backendCommand = $backendCommandTemplate -f @(
    $repoLiteral,
    $pythonLiteral,
    $BackendPort,
    $FrontendUrl,
    $FrontendPort
)

$frontendCommandTemplate = @'
$env:HYPERSYNC_LOCAL_SERVER = 'frontend'
$env:HYPERSYNC_DEV_HOST = 'localhost'
$env:HYPERSYNC_DEV_PORT = '{2}'
$env:HYPERSYNC_BACKEND_PORT = '{3}'
Set-Location -LiteralPath {0}
& {1} run dev
'@

$frontendCommand = $frontendCommandTemplate -f @(
    $frontendLiteral,
    $npmLiteral,
    $FrontendPort,
    $BackendPort
)

Write-Host ""
Write-Host "Starting HyperSync local development with on-demand ingestion..." -ForegroundColor Cyan
Write-Host ("Backend:  " + $BackendUrl) -ForegroundColor DarkCyan
Write-Host ("Frontend: " + $FrontendUrl) -ForegroundColor Green
Write-Host ""

$backendProcess = Start-Process -FilePath $currentPowerShell -WorkingDirectory $RepoRoot -ArgumentList @(
    "-NoLogo",
    "-NoExit",
    "-Command",
    $backendCommand
) -PassThru

Write-Host "Waiting for backend..." -ForegroundColor Yellow

$backendReady = Wait-ForHttp -Url ($BackendUrl + "/")

if (-not $backendReady) {
    throw (
        "Backend did not become ready at " +
        $BackendUrl +
        ". Check the HyperSync backend terminal."
    )
}

Write-Host "Backend is ready." -ForegroundColor Green

$frontendProcess = Start-Process -FilePath $currentPowerShell -WorkingDirectory $FrontendRoot -ArgumentList @(
    "-NoLogo",
    "-NoExit",
    "-Command",
    $frontendCommand
) -PassThru

Write-Host "Waiting for frontend..." -ForegroundColor Yellow

$frontendReady = Wait-ForHttp -Url ($FrontendUrl + "/")

if (-not $frontendReady) {
    throw (
        "Frontend did not become ready at " +
        $FrontendUrl +
        ". Check the HyperSync frontend terminal."
    )
}

Write-Host "Frontend is ready." -ForegroundColor Green

if (-not $NoBrowser) {
    Start-Process ($FrontendUrl + "/")
}

Write-Host ""
Write-Host "===================================" -ForegroundColor Green
Write-Host " HyperSync local servers restarted" -ForegroundColor Green
Write-Host (" Backend:  " + $BackendUrl) -ForegroundColor Green
Write-Host (" Frontend: " + $FrontendUrl) -ForegroundColor Green
Write-Host " On-demand search + temporary playback: enabled" -ForegroundColor Green
Write-Host " Admin Bot ingest controls:             enabled" -ForegroundColor Green
Write-Host (" Backend terminal PID: " + $backendProcess.Id) -ForegroundColor DarkGray
Write-Host (" Frontend terminal PID: " + $frontendProcess.Id) -ForegroundColor DarkGray
Write-Host "===================================" -ForegroundColor Green
Write-Host ""
