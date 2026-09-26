# HyperSync full-project health audit
# Run from the repository root:
#   .\audit-hypersync.ps1
#
# Or paste this entire script directly into PowerShell.

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$Failures = New-Object System.Collections.Generic.List[string]
$Warnings = New-Object System.Collections.Generic.List[string]
$Passed   = New-Object System.Collections.Generic.List[string]

function Section {
    param([string]$Name)

    Write-Host ""
    Write-Host ("=" * 78) -ForegroundColor DarkGray
    Write-Host "  $Name" -ForegroundColor Cyan
    Write-Host ("=" * 78) -ForegroundColor DarkGray
}

function Pass {
    param([string]$Message)

    $script:Passed.Add($Message)
    Write-Host "[PASS] $Message" -ForegroundColor Green
}

function Warn {
    param([string]$Message)

    $script:Warnings.Add($Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Fail {
    param([string]$Message)

    $script:Failures.Add($Message)
    Write-Host "[FAIL] $Message" -ForegroundColor Red
}

function Run-Check {
    param(
        [string]$Name,
        [scriptblock]$Command,
        [bool]$Required = $true
    )

    Write-Host ""
    Write-Host ">>> $Name" -ForegroundColor White

    $global:LASTEXITCODE = 0

    try {
        & $Command

        $Code = $LASTEXITCODE

        if ($null -eq $Code) {
            $Code = 0
        }

        if ($Code -eq 0) {
            Pass $Name
            return $true
        }

        if ($Required) {
            Fail "$Name (exit code $Code)"
        }
        else {
            Warn "$Name (exit code $Code)"
        }

        return $false
    }
    catch {
        if ($Required) {
            Fail "$Name - $($_.Exception.Message)"
        }
        else {
            Warn "$Name - $($_.Exception.Message)"
        }

        return $false
    }
}

function Has-Command {
    param([string]$Name)

    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}


# ---------------------------------------------------------------------------
# Basic repository checks
# ---------------------------------------------------------------------------

Section "Repository"

if (-not (Test-Path ".git")) {
    Fail "This does not appear to be the HyperSync repository root."
    Write-Host ""
    Write-Host "cd into the HyperSync repo and run the script again." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path "backend")) {
    Fail "backend/ directory is missing."
}

if (-not (Test-Path "frontend")) {
    Fail "frontend/ directory is missing."
}

if (-not (Test-Path "pyproject.toml")) {
    Fail "pyproject.toml is missing."
}

if (-not (Test-Path "alembic.ini")) {
    Fail "alembic.ini is missing."
}

Run-Check "Git status" {
    git status --short
}

Run-Check "Show current branch" {
    git branch --show-current
}

$CurrentBranch = (git branch --show-current 2>$null).Trim()

if ($CurrentBranch -eq "feature/offline-pwa-downloads") {
    Pass "Correct working branch: feature/offline-pwa-downloads"
}
else {
    Warn "Current branch is '$CurrentBranch', not feature/offline-pwa-downloads"
}

Run-Check "Git repository integrity" {
    git fsck --full
}


# ---------------------------------------------------------------------------
# Tool versions
# ---------------------------------------------------------------------------

Section "Development Tools"

if (Has-Command "python") {
    Run-Check "Python version" {
        python --version
    }
}
else {
    Fail "python is not available in PATH."
}

if (Has-Command "node") {
    Run-Check "Node.js version" {
        node --version
    }
}
else {
    Fail "node is not available in PATH."
}

if (Has-Command "npm") {
    Run-Check "npm version" {
        npm --version
    }
}
else {
    Fail "npm is not available in PATH."
}


# ---------------------------------------------------------------------------
# Virtual environment
# ---------------------------------------------------------------------------

Section "Python Environment"

$VenvPython = $null

if (Test-Path ".\.venv\Scripts\python.exe") {
    $VenvPython = (Resolve-Path ".\.venv\Scripts\python.exe").Path
    Pass "Found .venv Python"
}
elseif (Has-Command "python") {
    $VenvPython = "python"
    Warn ".venv was not found; using Python from PATH."
}
else {
    Fail "No usable Python interpreter."
}

if ($VenvPython) {

    Run-Check "Python package consistency (pip check)" {
        & $VenvPython -m pip check
    }

    Run-Check "Python syntax compile: backend + tests + migrations" {
        & $VenvPython -m compileall -q `
            backend `
            tests `
            migrations

        if ($LASTEXITCODE -ne 0) {
            exit $LASTEXITCODE
        }
    }


    # -----------------------------------------------------------------------
    # Ruff
    # -----------------------------------------------------------------------

    Section "Python Lint / Formatting"

    Run-Check "Ruff lint - all configured error classes" {
        & $VenvPython -m ruff check .
    }

    Run-Check "Ruff formatting check" {
        & $VenvPython -m ruff format --check .
    }


    # -----------------------------------------------------------------------
    # Static typing
    # -----------------------------------------------------------------------

    Section "Static Type Checking"

    Run-Check "Pyright" {
        & $VenvPython -m pyright
    }


    # -----------------------------------------------------------------------
    # Security static analysis
    # -----------------------------------------------------------------------

    Section "Python Security Analysis"

    Run-Check "Bandit security scan" {
        & $VenvPython -m bandit `
            -r backend `
            -x ".venv,frontend,node_modules" `
            -ll
    }


    # -----------------------------------------------------------------------
    # Alembic
    # -----------------------------------------------------------------------

    Section "Database / Alembic"

    Run-Check "Alembic migration graph" {
        & $VenvPython -m alembic heads
    }

    $Heads = @(
        & $VenvPython -m alembic heads 2>$null |
        Select-String "\(head\)"
    )

    if ($Heads.Count -eq 1) {
        Pass "Alembic has exactly one migration head"
    }
    elseif ($Heads.Count -eq 0) {
        Fail "Alembic reported no migration head."
    }
    else {
        Fail "Alembic has multiple migration heads: $($Heads.Count)"
    }

    # Only performs comparison/checking. It does NOT upgrade the DB.
    if ($env:DATABASE_URL -or (Test-Path ".env")) {
        Run-Check "Alembic model/schema drift check" {
            & $VenvPython -m alembic check
        } $false

        Run-Check "Current database migration revision" {
            & $VenvPython -m alembic current
        } $false
    }
    else {
        Warn "DATABASE_URL/.env not available; live DB migration checks skipped."
    }


    # -----------------------------------------------------------------------
    # Backend tests
    # -----------------------------------------------------------------------

    Section "Backend Test Suite"

    Run-Check "Pytest - ALL warnings are errors" {
        & $VenvPython -m pytest `
            -q `
            -W error `
            --tb=long
    }


    # -----------------------------------------------------------------------
    # Python dependency vulnerabilities
    # -----------------------------------------------------------------------

    Section "Python Dependency Vulnerabilities"

    Run-Check "pip-audit vulnerability scan" {
        & $VenvPython -m pip_audit `
            -r requirements.backend.txt
    } $false
}


# ---------------------------------------------------------------------------
# Frontend
# ---------------------------------------------------------------------------

Section "Frontend Dependencies"

if (-not (Test-Path "frontend\package.json")) {
    Fail "frontend/package.json is missing."
}
else {

    Push-Location frontend

    try {

        if (-not (Test-Path "node_modules")) {
            Fail "frontend/node_modules is missing. Run: npm ci"
        }
        else {
            Pass "frontend/node_modules exists"
        }

        if (Test-Path "package-lock.json") {
            Pass "frontend/package-lock.json exists"
        }
        else {
            Warn "frontend/package-lock.json is missing."
        }


        # -------------------------------------------------------------------
        # JS syntax
        # -------------------------------------------------------------------

        Section "Frontend JavaScript Syntax"

        $JsFiles = @(
            Get-ChildItem `
                -Path "src" `
                -Recurse `
                -File `
                -Include "*.js"
        )

        $SyntaxFailures = 0

        foreach ($File in $JsFiles) {

            # JSX files are handled by Vite build instead of node --check.
            if ($File.Extension -eq ".js") {
                node --check $File.FullName 2>&1

                if ($LASTEXITCODE -ne 0) {
                    $SyntaxFailures++
                    Write-Host "[BROKEN] $($File.FullName)" -ForegroundColor Red
                }
            }
        }

        if ($SyntaxFailures -eq 0) {
            Pass "JavaScript syntax checks"
        }
        else {
            Fail "$SyntaxFailures JavaScript file(s) failed syntax validation."
        }


        # -------------------------------------------------------------------
        # ALL Node tests, not only package.json's subset
        # -------------------------------------------------------------------

        Section "Frontend Test Suite"

        $FrontendTests = @(
            Get-ChildItem `
                -Path "src" `
                -Recurse `
                -File `
                -Filter "*.test.js" |
            ForEach-Object {
                $_.FullName
            }
        )

        if ($FrontendTests.Count -gt 0) {

            Run-Check "ALL frontend node:test files ($($FrontendTests.Count))" {
                node --test $FrontendTests
            }
        }
        else {
            Fail "No frontend .test.js files found."
        }


        # Existing project's selected offline suite as a separate check.
        Run-Check "Configured npm test:offline suite" {
            npm run test:offline
        }


        # -------------------------------------------------------------------
        # Production build
        # -------------------------------------------------------------------

        Section "Frontend Production Build"

        Run-Check "Vite production build" {
            npm run build
        }


        # -------------------------------------------------------------------
        # Dependency audit
        # -------------------------------------------------------------------

        Section "Frontend Dependency Vulnerabilities"

        Run-Check "npm audit" {
            npm audit --audit-level=low
        } $false
    }
    finally {
        Pop-Location
    }
}


# ---------------------------------------------------------------------------
# Secret/key/file safety checks
# ---------------------------------------------------------------------------

Section "Tracked Secret / Key Scan"

$TrackedFiles = @(git ls-files)

$DangerousTrackedFiles = @(
    $TrackedFiles |
    Where-Object {
        $_ -match '(^|/)\.env($|\.)' -and
        $_ -ne ".env.example"
    }
)

if ($DangerousTrackedFiles.Count -gt 0) {
    Fail "Tracked .env files found:"
    $DangerousTrackedFiles | ForEach-Object {
        Write-Host "    $_" -ForegroundColor Red
    }
}
else {
    Pass "No private .env files are tracked"
}


$TrackedPrivateKeys = @(
    $TrackedFiles |
    Where-Object {
        $_ -match '(?i)(private[-_]?key|\.pem$|\.key$|id_rsa$|id_ed25519$)'
    }
)

if ($TrackedPrivateKeys.Count -gt 0) {
    Fail "Possible private key files are tracked:"
    $TrackedPrivateKeys | ForEach-Object {
        Write-Host "    $_" -ForegroundColor Red
    }
}
else {
    Pass "No obvious private-key files are tracked"
}


Write-Host ""
Write-Host "Scanning tracked source for PEM private-key headers..." -ForegroundColor White

$PemMatches = @(
    git grep -n -I `
        -E "BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY" `
        2>$null
)

if ($PemMatches.Count -gt 0) {
    Fail "Private-key material appears inside tracked files."

    $PemMatches | ForEach-Object {
        Write-Host $_ -ForegroundColor Red
    }
}
else {
    Pass "No tracked PEM private-key headers found"
}


Write-Host ""
Write-Host "Scanning for suspicious hard-coded credential names..." -ForegroundColor White

$SecretMatches = @(
    git grep -n -I `
        -E '(JWT_SECRET|B2_APPLICATION_KEY|WEB_PUSH_VAPID_PRIVATE_KEY|ADMIN_DATABASE_DELETE_PASSWORD|ADMIN_ACCOUNT_CREATION_PASSWORD)[[:space:]]*=[[:space:]]*[^[:space:]]+' `
        -- `
        ':!.env.example' `
        2>$null
)

if ($SecretMatches.Count -gt 0) {
    Warn "Possible hard-coded secret assignments were found."

    $SecretMatches | ForEach-Object {
        Write-Host $_ -ForegroundColor Yellow
    }
}
else {
    Pass "No obvious hard-coded server secrets found in tracked files"
}


# ---------------------------------------------------------------------------
# Merge conflict / TODO garbage / accidentally committed generated data
# ---------------------------------------------------------------------------

Section "Repository Hygiene"

$ConflictMarkers = @(
    git grep -n -I `
        -E '^(<<<<<<<|=======|>>>>>>>)' `
        2>$null
)

if ($ConflictMarkers.Count -gt 0) {
    Fail "Unresolved Git merge-conflict markers found."

    $ConflictMarkers | ForEach-Object {
        Write-Host $_ -ForegroundColor Red
    }
}
else {
    Pass "No unresolved merge-conflict markers"
}


$TrackedGenerated = @(
    $TrackedFiles |
    Where-Object {
        $_ -match '(^|/)(node_modules|dist|__pycache__|\.venv|storage)/'
    }
)

if ($TrackedGenerated.Count -gt 0) {
    Warn "Generated/runtime files appear to be tracked:"

    $TrackedGenerated | ForEach-Object {
        Write-Host "    $_" -ForegroundColor Yellow
    }
}
else {
    Pass "No obvious generated/runtime directories are tracked"
}


# ---------------------------------------------------------------------------
# Case-sensitive imports/files can fail on Linux/Northflank
# ---------------------------------------------------------------------------

Section "Linux / Deployment Compatibility"

$DuplicateCaseNames = @(
    $TrackedFiles |
    Group-Object {
        $_.ToLowerInvariant()
    } |
    Where-Object {
        $_.Count -gt 1
    }
)

if ($DuplicateCaseNames.Count -gt 0) {
    Fail "Files differing only by capitalization detected. Linux deployments can break."

    foreach ($Group in $DuplicateCaseNames) {
        $Group.Group | ForEach-Object {
            Write-Host "    $_" -ForegroundColor Red
        }
    }
}
else {
    Pass "No case-collision filenames detected"
}


# ---------------------------------------------------------------------------
# Final git diff check
# ---------------------------------------------------------------------------

Section "Working Tree"

git status --short

if ([string]::IsNullOrWhiteSpace((git status --porcelain))) {
    Pass "Working tree clean"
}
else {
    Warn "Working tree contains changes/untracked files"
}


# ---------------------------------------------------------------------------
# Final report
# ---------------------------------------------------------------------------

Section "FINAL AUDIT REPORT"

Write-Host ""
Write-Host "Passed:   $($Passed.Count)" -ForegroundColor Green
Write-Host "Warnings: $($Warnings.Count)" -ForegroundColor Yellow
Write-Host "Failures: $($Failures.Count)" -ForegroundColor Red

if ($Warnings.Count -gt 0) {
    Write-Host ""
    Write-Host "WARNINGS" -ForegroundColor Yellow

    foreach ($Item in $Warnings) {
        Write-Host "  - $Item" -ForegroundColor Yellow
    }
}

if ($Failures.Count -gt 0) {
    Write-Host ""
    Write-Host "FAILURES" -ForegroundColor Red

    foreach ($Item in $Failures) {
        Write-Host "  - $Item" -ForegroundColor Red
    }
}

Write-Host ""

if ($Failures.Count -eq 0 -and $Warnings.Count -eq 0) {
    Write-Host "CLEAN: No failures or warnings were detected." -ForegroundColor Green
    exit 0
}

if ($Failures.Count -eq 0) {
    Write-Host "No hard failures, but review the warnings above." -ForegroundColor Yellow
    exit 0
}

Write-Host "BROKEN CHECKS DETECTED. Fix the failures above before deploying." -ForegroundColor Red
exit 1