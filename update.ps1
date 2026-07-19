<#
.SYNOPSIS
    Aiportal Update Script - pull latest code + rebuild + restart containers + schema sync + health check
.DESCRIPTION
    Steps:
      1. git pull (from chenweihanfool/Aiportal on GitHub)
      2. docker compose up -d --build (build + (re)create both api-server and gis-portal)
      3. pnpm --filter db push (drizzle-kit schema sync -- safe to run every deploy)
      4. health check (verify /api/healthz responds)

    Same pattern as pf-cwh/fitnessforge on this host. Postgres itself is NOT
    managed by this docker-compose file -- it's an existing instance shared with
    other apps (see DATABASE_URL in .env), so there's no "postgres" service
    to restart here.

    Prerequisite (one-time, not done by this script): a `.env` file must exist next to
    docker-compose.yml with real secrets (copy .env.example and fill in), since it's
    git-ignored and won't come from `git pull`.

    Usage:
      - Double-click this .ps1 file
      - Or run in PowerShell: & "F:\WEBAPP\SRC\Aiportal\update.ps1"
.NOTES
    Version: 1.0
#>

$ErrorActionPreference = "Continue"
$RepoDir = "F:\WEBAPP\SRC\Aiportal"
$LogFile = "$RepoDir\update.log"
$StartTime = Get-Date
$HealthUrl = "https://cwh2023.asuscomm.com/aiportal/"
$HealthCheckUrl = "http://127.0.0.1:5139/api/healthz"
$AppPort = 5139

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "        Aiportal Update Script v1.0       " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Start: $($StartTime.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor Gray
Write-Host ""

# Shared deploy helpers (Test-PortListening / Wait-ForPort) -- see
# https://github.com/chenweihanfool/deploy-helpers-
$modulePath = "F:\WEBAPP\Deploy\deploy-helpers\DeployHelpers.psm1"
if (-not (Test-Path $modulePath)) {
    Write-Host "ERROR: Shared module not found at $modulePath" -ForegroundColor Red
    Write-Host "  Clone from: git@github.com:chenweihanfool/deploy-helpers-.git" -ForegroundColor Yellow
    exit 1
}
Import-Module $modulePath -Force

function Run-Native {
    param([scriptblock]$ScriptBlock)
    $output = & $ScriptBlock
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "Exit code: $exitCode - $output"
    }
    return $output
}

# ==============================================
# Step 1: git pull
# ==============================================
Write-Host "[1/4] Pulling latest code from GitHub..." -ForegroundColor Yellow
try {
    Push-Location $RepoDir
    $gitResult = Run-Native { git pull 2>&1 }
    Write-Host $gitResult
    if ($gitResult -match "Updating") {
        Write-Host "  >> Changes pulled" -ForegroundColor Green
    } else {
        Write-Host "  >> Already up to date" -ForegroundColor Gray
    }
    Pop-Location
}
catch {
    Write-Host "ERROR git pull: $_" -ForegroundColor Red
    Pop-Location
    exit 1
}

# ==============================================
# Step 2: docker compose up -d --build (build + start in one shot)
# ==============================================
Write-Host "[2/4] Building + starting containers..." -ForegroundColor Yellow
try {
    Push-Location $RepoDir
    $upResult = cmd /c "docker compose up -d --build 2>&1"
    Write-Host $upResult
    # Skip LASTEXITCODE here -- Docker Desktop on this Windows host can emit a
    # false-positive .hermes-tmp cleanup warning (non-zero exit) after an
    # otherwise successful build+start. Wait-ForPort + the health check below
    # are the real signals.
    Write-Host "  >> Containers built & started" -ForegroundColor Green

    if (-not (Wait-ForPort -Port $AppPort -Retries 15 -DelaySeconds 2)) {
        throw "api-server did not start listening on port $AppPort within 30s"
    }
    Write-Host "  >> api-server listening on port $AppPort" -ForegroundColor Green
    Pop-Location
}
catch {
    Write-Host "ERROR docker up --build: $_" -ForegroundColor Red
    Write-Host "Make sure Docker Desktop is running and .env exists (copy from .env.example)" -ForegroundColor Yellow
    Pop-Location
    exit 1
}

# ==============================================
# Step 3: schema sync (drizzle-kit push)
# ==============================================
Write-Host "[3/4] Syncing database schema..." -ForegroundColor Yellow
try {
    Push-Location $RepoDir
    # Aiportal uses pnpm workspace; schema is under lib/db/, pushed via pnpm --filter db
    $pushResult = cmd /c "pnpm --filter db push 2>&1"
    Write-Host $pushResult
    if ($LASTEXITCODE -ne 0) {
        throw "pnpm --filter db push failed (exit code: $LASTEXITCODE)"
    }
    Write-Host "  >> Schema synced" -ForegroundColor Green
    Pop-Location
}
catch {
    Write-Host "ERROR schema sync: $_" -ForegroundColor Red
    Write-Host "  If this failed, run manually: cd $RepoDir && pnpm --filter db push" -ForegroundColor Yellow
    Pop-Location
}

# ==============================================
# Step 4: Health check
# ==============================================
Write-Host "[4/4] Health check..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

# Check api-server internal health endpoint
try {
    $statusCode = (Invoke-WebRequest -Uri $HealthCheckUrl -UseBasicParsing -TimeoutSec 15).StatusCode
    if ($statusCode -eq 200) {
        Write-Host "  >> PASS - Aiportal api-server is running (HTTP $statusCode)" -ForegroundColor Green
    } else {
        Write-Host "  >> WARNING - HTTP $statusCode, verify manually" -ForegroundColor Yellow
    }
}
catch {
    Write-Host "  >> FAILED - Health check on $HealthCheckUrl" -ForegroundColor Red
    Write-Host "     Try: docker compose logs --tail=50 api-server" -ForegroundColor Yellow
}

# Check the public-facing URL too
try {
    $publicCode = (Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 15).StatusCode
    if ($publicCode -eq 200) {
        Write-Host "  >> PASS - Public URL responds (HTTP $publicCode)" -ForegroundColor Green
    } else {
        Write-Host "  >> WARNING - Public URL HTTP $publicCode" -ForegroundColor Yellow
    }
}
catch {
    Write-Host "  >> NOTE - Public URL check failed (expected if behind Apache auth)" -ForegroundColor Gray
}

# ==============================================
# Done
# ==============================================
$EndTime = Get-Date
$Duration = ($EndTime - $StartTime).TotalSeconds
Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Update complete! ($($Duration.ToString('0.0'))s)" -ForegroundColor Cyan
Write-Host $HealthUrl -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$LogLine = "$($StartTime.ToString('yyyy-MM-dd HH:mm:ss')) | ${Duration:0.0}s | Done"
Add-Content -Path $LogFile -Value $LogLine -Encoding UTF8
