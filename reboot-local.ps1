param(
    [int]$FrontendPort = 0,
    [int]$BackendPort = 0,
    [switch]$NoBrowser
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = $PSScriptRoot
$FrontendRoot = Join-Path $RepoRoot "frontend"
$PythonPath = Join-Path $RepoRoot ".venv\Scripts\python.exe"
$PackageJson = Join-Path $FrontendRoot "package.json"

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

    $listener = Get-NetTCPConnection `
        -State Listen `
        -LocalPort $Port `
        -ErrorAction SilentlyContinue

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

function Stop-HyperSyncDevProcesses {
    $processes = Get-CimInstance Win32_Process `
        -ErrorAction SilentlyContinue |
        Where-Object {
            $commandLine = [string]$_.CommandLine

            if ([string]::IsNullOrWhiteSpace($commandLine)) {
                return $false
            }

            $belongsToRepo =
                $commandLine.IndexOf(
                    $RepoRoot,
                    [System.StringComparison]::OrdinalIgnoreCase
                ) -ge 0

            $looksLikeDevServer =
                $commandLine -match "vite(\.js)?" -or
                $commandLine -match "uvicorn\s+backend\.app\.main:app" -or
                $commandLine -match "npm(\.cmd)?\s+run\s+dev"

            return $belongsToRepo -and $looksLikeDevServer
        }

    foreach ($process in $processes) {
        try {
            Stop-Process `
                -Id $process.ProcessId `
                -Force `
                -ErrorAction Stop

            Write-Host (
                "Stopped old HyperSync dev process PID " +
                $process.ProcessId
            ) -ForegroundColor DarkGray
        }
        catch {
            Write-Warning (
                "Could not stop old HyperSync process PID " +
                $process.ProcessId +
                ": " +
                $_.Exception.Message
            )
        }
    }

    if ($processes) {
        Start-Sleep -Milliseconds 600
    }
}

function Wait-ForTcpPort {
    param(
        [Parameter(Mandatory = $true)]
        [string]$HostName,

        [Parameter(Mandatory = $true)]
        [int]$Port,

        [int]$Attempts = 120
    )

    for ($attempt = 0; $attempt -lt $Attempts; $attempt += 1) {
        $client = $null

        try {
            $client = [System.Net.Sockets.TcpClient]::new()
            $connectTask = $client.ConnectAsync($HostName, $Port)

            if (
                $connectTask.Wait(250) -and
                $client.Connected
            ) {
                return $true
            }
        }
        catch {
            # The server is still starting.
        }
        finally {
            if ($null -ne $client) {
                $client.Dispose()
            }
        }

        Start-Sleep -Milliseconds 250
    }

    return $false
}

if (-not (Test-Path -LiteralPath $PythonPath)) {
    throw (
        "HyperSync virtual environment was not found at " +
        $PythonPath +
        ". Create .venv before running this script."
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

Stop-HyperSyncDevProcesses

if ($BackendPort -gt 0) {
    if (Test-PortInUse -Port $BackendPort) {
        throw (
            "Requested backend port " +
            $BackendPort +
            " is already in use."
        )
    }
}
else {
    $BackendPort = Get-FirstFreePort `
        -Candidates (8000..8020)
}

if ($FrontendPort -gt 0) {
    if (Test-PortInUse -Port $FrontendPort) {
        throw (
            "Requested frontend port " +
            $FrontendPort +
            " is already in use."
        )
    }
}
else {
    # 4153 is HyperSync's clean local-dev origin.
    # 5173 remains a fallback for compatibility.
    $frontendCandidates = @(
        4153
        5173
    ) + (4154..4199) + (5174..5199)

    $FrontendPort = Get-FirstFreePort `
        -Candidates $frontendCandidates
}

$repoLiteral = ConvertTo-PowerShellLiteral $RepoRoot
$frontendLiteral = ConvertTo-PowerShellLiteral $FrontendRoot
$pythonLiteral = ConvertTo-PowerShellLiteral $PythonPath
$npmLiteral = ConvertTo-PowerShellLiteral $npmCommand.Source

$backendCommand = (
    "Set-Location -LiteralPath " +
    $repoLiteral +
    "; & " +
    $pythonLiteral +
    " -m uvicorn backend.app.main:app" +
    " --host 127.0.0.1" +
    " --port " +
    $BackendPort +
    " --reload"
)

$frontendCommand = (
    "`$env:HYPERSYNC_DEV_HOST = 'localhost'; " +
    "`$env:HYPERSYNC_DEV_PORT = '" +
    $FrontendPort +
    "'; " +
    "`$env:HYPERSYNC_BACKEND_PORT = '" +
    $BackendPort +
    "'; " +
    "Set-Location -LiteralPath " +
    $frontendLiteral +
    "; & " +
    $npmLiteral +
    " run dev"
)

Write-Host ""
Write-Host "Starting HyperSync local development..." -ForegroundColor Cyan
Write-Host (
    "Backend:  http://127.0.0.1:" +
    $BackendPort
) -ForegroundColor DarkCyan
Write-Host (
    "Frontend: http://localhost:" +
    $FrontendPort
) -ForegroundColor Green
Write-Host ""

$backendProcess = Start-Process `
    -FilePath "powershell.exe" `
    -WorkingDirectory $RepoRoot `
    -ArgumentList @(
        "-NoLogo",
        "-NoExit",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        $backendCommand
    ) `
    -PassThru

$frontendProcess = Start-Process `
    -FilePath "powershell.exe" `
    -WorkingDirectory $FrontendRoot `
    -ArgumentList @(
        "-NoLogo",
        "-NoExit",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        $frontendCommand
    ) `
    -PassThru

$backendReady = Wait-ForTcpPort `
    -HostName "127.0.0.1" `
    -Port $BackendPort

$frontendReady = Wait-ForTcpPort `
    -HostName "localhost" `
    -Port $FrontendPort

if (-not $backendReady) {
    Write-Warning (
        "Backend did not become reachable. " +
        "Check the HyperSync backend window."
    )
}

if (-not $frontendReady) {
    Write-Warning (
        "Frontend did not become reachable. " +
        "Check the HyperSync frontend window."
    )
}

if ($frontendReady) {
    $frontendUrl =
        "http://localhost:" +
        $FrontendPort +
        "/"

    Write-Host ""
    Write-Host (
        "HyperSync frontend ready: " +
        $frontendUrl
    ) -ForegroundColor Green

    if (-not $NoBrowser) {
        Start-Process $frontendUrl
    }
}

Write-Host ""
Write-Host (
    "Backend PID: " +
    $backendProcess.Id
) -ForegroundColor DarkGray
Write-Host (
    "Frontend terminal PID: " +
    $frontendProcess.Id
) -ForegroundColor DarkGray
