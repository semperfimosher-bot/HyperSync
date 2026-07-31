param(
    [switch]$SkipDatabase,
    [switch]$SkipSecurityAudit,
    [switch]$RequireDocker
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path `
    -Parent `
    $PSScriptRoot

Set-Location $ProjectRoot


function Stop-Verification {
    param(
        [string]$CheckName,
        [object[]]$Output = @()
    )

    Write-Host ""
    Write-Host `
        "VERIFICATION FAILED: $CheckName" `
        -ForegroundColor Red

    if ($Output.Count -gt 0) {
        Write-Host ""

        foreach ($line in $Output) {
            Write-Host $line
        }
    }

    exit 1
}


function Invoke-NativeCapture {
    param(
        [string]$CheckName,
        [scriptblock]$Command,
        [int[]]$AllowedExitCodes = @(0),
        [string]$FailOnOutputPattern = ""
    )

    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $exitCode = 1
    $output = @()

    try {
        $global:LASTEXITCODE = 0

        $output = @(
            & $Command 2>&1 |
                ForEach-Object {
                    $_.ToString()
                }
        )

        $exitCode = $LASTEXITCODE
    }
    catch {
        $output = @(
            $_.Exception.ToString()
        )

        $exitCode = 1
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }

    if (-not ($AllowedExitCodes -contains $exitCode)) {
        Stop-Verification `
            -CheckName "$CheckName (exit code $exitCode)" `
            -Output $output
    }

    if (
        $FailOnOutputPattern -and
        (($output -join "`n") -match $FailOnOutputPattern)
    ) {
        Stop-Verification `
            -CheckName "$CheckName emitted a warning" `
            -Output $output
    }

    return [PSCustomObject]@{
        ExitCode = $exitCode
        Output = $output
    }
}


function Invoke-NativeCheck {
    param(
        [string]$CheckName,
        [scriptblock]$Command,
        [string]$FailOnOutputPattern = ""
    )

    [void](
        Invoke-NativeCapture `
            -CheckName $CheckName `
            -Command $Command `
            -FailOnOutputPattern $FailOnOutputPattern
    )
}


function Require-Command {
    param(
        [string]$CommandName
    )

    if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
        Stop-Verification `
            -CheckName "Required command" `
            -Output @(
                "Command not found: $CommandName"
            )
    }
}


# ------------------------------------------------------------
# Required local tools and environment
# ------------------------------------------------------------

Require-Command "git"
Require-Command "node"
Require-Command "npm.cmd"

$python = Join-Path `
    $ProjectRoot `
    ".venv\Scripts\python.exe"

if (-not (Test-Path $python -PathType Leaf)) {
    Stop-Verification `
        -CheckName "Python virtual environment" `
        -Output @(
            "Missing: .venv\Scripts\python.exe"
        )
}

if (-not (Test-Path ".env" -PathType Leaf)) {
    Stop-Verification `
        -CheckName "Local environment file" `
        -Output @(
            "Missing: .env"
        )
}

$gitRootResult = Invoke-NativeCapture `
    -CheckName "Git repository root" `
    -Command {
        git rev-parse --show-toplevel
    }

$gitRoot = (
    $gitRootResult.Output |
        Select-Object -First 1
).Trim()

if (
    [System.IO.Path]::GetFullPath($gitRoot).TrimEnd("\") -ne
    [System.IO.Path]::GetFullPath($ProjectRoot).TrimEnd("\")
) {
    Stop-Verification `
        -CheckName "Git repository root" `
        -Output @(
            "Expected: $ProjectRoot"
            "Found: $gitRoot"
        )
}


# ------------------------------------------------------------
# Git safety, merge state, secrets, generated files, whitespace
# ------------------------------------------------------------

Invoke-NativeCheck `
    -CheckName ".env ignore rule" `
    -Command {
        git check-ignore -q -- .env
    }

$conflictResult = Invoke-NativeCapture `
    -CheckName "Git conflict-marker scan" `
    -AllowedExitCodes @(0, 1) `
    -Command {
        git grep `
            -n `
            -E `
            "^(<<<<<<<|=======|>>>>>>>)" `
            -- `
            .
    }

if ($conflictResult.ExitCode -eq 0) {
    Stop-Verification `
        -CheckName "Git conflict markers" `
        -Output $conflictResult.Output
}

$unmergedResult = Invoke-NativeCapture `
    -CheckName "Git unmerged-file check" `
    -Command {
        git ls-files --unmerged
    }

if ($unmergedResult.Output.Count -gt 0) {
    Stop-Verification `
        -CheckName "Git unmerged files" `
        -Output $unmergedResult.Output
}

$forbiddenTrackedResult = Invoke-NativeCapture `
    -CheckName "Tracked-file safety check" `
    -Command {
        git ls-files `
            -- `
            ".env" `
            ":(glob).env.*" `
            ":(exclude).env.example" `
            ":(glob).venv/**" `
            ":(glob)**/__pycache__/**" `
            ":(glob)**/*.pyc" `
            ":(glob).pytest_cache/**" `
            ":(glob).ruff_cache/**" `
            ":(glob)frontend/node_modules/**" `
            ":(glob)frontend/dist/**" `
            ":(glob)storage/**" `
            ":(glob)**/*.log"
    }

if ($forbiddenTrackedResult.Output.Count -gt 0) {
    Stop-Verification `
        -CheckName "Secret or generated files tracked by Git" `
        -Output $forbiddenTrackedResult.Output
}

Invoke-NativeCheck `
    -CheckName "Unstaged Git whitespace validation" `
    -Command {
        git diff --check
    }

Invoke-NativeCheck `
    -CheckName "Staged Git whitespace validation" `
    -Command {
        git diff --cached --check
    }


# ------------------------------------------------------------
# PowerShell syntax for every tracked PowerShell script
# ------------------------------------------------------------

$powerShellFilesResult = Invoke-NativeCapture `
    -CheckName "PowerShell file discovery" `
    -Command {
        git ls-files -- "*.ps1"
    }

$powerShellErrors = @()

foreach ($relativePath in $powerShellFilesResult.Output) {
    if (-not $relativePath) {
        continue
    }

    $tokens = $null
    $parseErrors = $null
    $fullPath = Join-Path $ProjectRoot $relativePath

    [System.Management.Automation.Language.Parser]::ParseFile(
        $fullPath,
        [ref]$tokens,
        [ref]$parseErrors
    ) | Out-Null

    foreach ($parseError in @($parseErrors)) {
        $powerShellErrors += "$relativePath - $parseError"
    }
}

if ($powerShellErrors.Count -gt 0) {
    Stop-Verification `
        -CheckName "PowerShell syntax" `
        -Output $powerShellErrors
}


# ------------------------------------------------------------
# Deep project and backend structure checks
# ------------------------------------------------------------

Invoke-NativeCheck `
    -CheckName "Python dependency consistency" `
    -Command {
        & $python -m pip check
    }

Invoke-NativeCheck `
    -CheckName "Deep project and backend verification" `
    -Command {
        & $python -m scripts.verify_backend
    }


# ------------------------------------------------------------
# Python linting, formatting, typing, security, tests, compilation
# ------------------------------------------------------------

Invoke-NativeCheck `
    -CheckName "Ruff lint check" `
    -Command {
        & $python -m ruff check `
            backend `
            bot `
            migrations `
            scripts `
            tests
    }

Invoke-NativeCheck `
    -CheckName "Ruff formatting check" `
    -Command {
        & $python -m ruff format `
            --check `
            backend `
            bot `
            migrations `
            scripts `
            tests
    }

Invoke-NativeCheck `
    -CheckName "Pyright type check" `
    -Command {
        & $python -m pyright --warnings
    }

Invoke-NativeCheck `
    -CheckName "Bandit backend security scan" `
    -Command {
        & $python -m bandit `
            -q `
            -r `
            backend `
            bot `
            -ll `
            -ii
    }

Invoke-NativeCheck `
    -CheckName "Tests and Python warnings" `
    -Command {
        & $python -m pytest `
            -q `
            -W error `
            --strict-config `
            --strict-markers
    }

Invoke-NativeCheck `
    -CheckName "Python syntax compilation" `
    -Command {
        & $python -m compileall `
            -q `
            -f `
            backend `
            bot `
            migrations `
            scripts `
            tests
    }

if (-not $SkipSecurityAudit) {
    Invoke-NativeCheck `
        -CheckName "Python dependency vulnerability audit" `
        -Command {
            & $python -m pip_audit `
                --strict `
                -r requirements.backend.txt
        }
}


# ------------------------------------------------------------
# Alembic migration graph and live Neon compatibility
# ------------------------------------------------------------

Invoke-NativeCheck `
    -CheckName "Alembic heads" `
    -Command {
        & $python -m alembic heads
    }

Invoke-NativeCheck `
    -CheckName "Alembic migration history" `
    -Command {
        & $python -m alembic history
    }

Invoke-NativeCheck `
    -CheckName "Alembic upgrade SQL generation" `
    -Command {
        & $python -m alembic upgrade head --sql
    }

if (-not $SkipDatabase) {
    Invoke-NativeCheck `
        -CheckName "Alembic current revision" `
        -Command {
            & $python -m alembic current
        }

    Invoke-NativeCheck `
        -CheckName "Models match the database" `
        -Command {
            & $python -m alembic check
        }

    Invoke-NativeCheck `
        -CheckName "Neon schema verification" `
        -Command {
            & $python -m scripts.check_schema
        }
}


# ------------------------------------------------------------
# Frontend dependency tree, syntax, build warnings, and security
# ------------------------------------------------------------

$viteProcesses = @()

try {
    $escapedProjectRoot = [regex]::Escape($ProjectRoot)

    $viteProcesses = @(
        Get-CimInstance `
            Win32_Process `
            -Filter "Name = 'node.exe'" `
            -ErrorAction Stop |
            Where-Object {
                $_.CommandLine -and
                $_.CommandLine -match "vite" -and
                $_.CommandLine -match $escapedProjectRoot
            }
    )
}
catch {
    $viteProcesses = @()
}

if ($viteProcesses.Count -gt 0) {
    Stop-Verification `
        -CheckName "Running Vite process" `
        -Output @(
            "Stop the HyperSync Vite development server with Ctrl+C before verification."
        )
}

Push-Location ".\frontend"

try {
    $warningPattern = "(?im)^\s*(npm\s+warn|warning:|\(!\))"

    Invoke-NativeCheck `
        -CheckName "Frontend clean dependency installation" `
        -FailOnOutputPattern $warningPattern `
        -Command {
            npm.cmd ci
        }

    Invoke-NativeCheck `
        -CheckName "Frontend dependency-tree compatibility" `
        -Command {
            npm.cmd ls --all
        }

    Invoke-NativeCheck `
        -CheckName "Frontend production build" `
        -FailOnOutputPattern $warningPattern `
        -Command {
            npm.cmd run build
        }

    Invoke-NativeCheck `
        -CheckName "Frontend dependency security audit" `
        -Command {
            npm.cmd audit --audit-level=low
        }
}
finally {
    Pop-Location
}


# ------------------------------------------------------------
# Optional local Docker/BuildKit validation
# ------------------------------------------------------------

if ($RequireDocker) {
    Require-Command "docker"

    Invoke-NativeCheck `
        -CheckName "Docker daemon" `
        -Command {
            docker version
        }

    Invoke-NativeCheck `
        -CheckName "Backend Docker BuildKit validation" `
        -Command {
            docker buildx build `
                --check `
                --file Dockerfile.backend `
                .
        }

    Invoke-NativeCheck `
        -CheckName "Frontend Docker BuildKit validation" `
        -Command {
            docker buildx build `
                --check `
                --file frontend/Dockerfile `
                .
        }
}


# ------------------------------------------------------------
# Final validation after tools may have generated files
# ------------------------------------------------------------

Invoke-NativeCheck `
    -CheckName "Final unstaged Git whitespace validation" `
    -Command {
        git diff --check
    }

Invoke-NativeCheck `
    -CheckName "Final staged Git whitespace validation" `
    -Command {
        git diff --cached --check
    }

Write-Host `
    "All good Shane, Hoorah" `
    -ForegroundColor Blue

exit 0
