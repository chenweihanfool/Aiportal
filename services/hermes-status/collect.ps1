<#
.SYNOPSIS
    Collects host system status (CPU/RAM/disk, Docker container health,
    scheduled-task results, recent deploy activity) and pushes it to
    Aiportal's HERMES 戰情室 endpoints.
.DESCRIPTION
    Run on the deploy host every few minutes via Windows Task Scheduler (see
    setup_task.ps1). Same "compute everything before writing, log-and-exit
    on failure" discipline as services/busyness-index/compute_daily.py: the
    full status snapshot is built in memory first, and only POSTed once
    every collection step has succeeded, so a partial failure never
    overwrites hermes_status_snapshot with half-empty data.

    Container/scheduled-task name filters below are deliberately dynamic
    (docker ps lists whatever is actually running; $TaskNamePatterns is a
    wildcard match) rather than a hardcoded list, since the exact container
    and task names on the real deploy host weren't available to confirm
    from the machine this script was written on.

    Recent-activity entries are NOT written by instrumenting HERMES itself —
    they're read from the `update.log` files that update.ps1 (Aiportal /
    pf-cwh / FitnessForge / ...) already appends to on every deploy. A small
    per-file line-count cursor (activity_cursor.json, in this directory)
    tracks what's already been posted so re-running this script doesn't
    re-post the same lines.

    Prerequisite (not done by this script): a `.env` file in this same
    directory (copy .env.example, fill in ADMIN_PASSWORD / API_BASE_URL).
#>

$ErrorActionPreference = "Stop"
$ScriptDir = $PSScriptRoot

# ── Config ──────────────────────────────────────────────────────────────
# Wildcard patterns, not exact names — adjust once you can see the real
# task names on the deploy host (`Get-ScheduledTask | Select TaskName`).
$TaskNamePatterns = @("*Aiportal*", "*Busyness*", "*Hermes*", "*Fitness*", "*pf-cwh*", "*Health*", "*Duplicati*", "*SyncBack*")

# repo name -> update.log path, same file update.ps1 already writes via
# `Add-Content -Path $LogFile`. Missing paths are skipped, not fatal —
# not every repo on this host necessarily has update.ps1 deployed yet.
$UpdateLogPaths = @{
    "Aiportal"     = "F:\WEBAPP\SRC\Aiportal\update.log"
    "pf-cwh"       = "F:\WEBAPP\SRC\pf-cwh\update.log"
    "FitnessForge" = "F:\WEBAPP\SRC\FitnessForge\update.log"
    "Geospatial"   = "F:\WEBAPP\SRC\Geospatial\update.log"
    "vikunja"      = "F:\WEBAPP\SRC\vikunja\update.log"
}

$CursorPath = Join-Path $ScriptDir "activity_cursor.json"
$LogDir = Join-Path $ScriptDir "logs"
$ErrorLogPath = Join-Path $LogDir "hermes_status_error.log"

function Write-ErrorLog {
    param([string]$Message)
    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') | $Message"
    Add-Content -Path $ErrorLogPath -Value $line -Encoding UTF8
}

# ── Load .env (ADMIN_PASSWORD / API_BASE_URL) ──────────────────────────
$EnvPath = Join-Path $ScriptDir ".env"
if (-not (Test-Path $EnvPath)) {
    Write-ErrorLog "No .env found at $EnvPath -- copy .env.example and fill in ADMIN_PASSWORD / API_BASE_URL."
    exit 1
}
$EnvConfig = @{}
Get-Content $EnvPath | ForEach-Object {
    if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$') {
        $EnvConfig[$matches[1]] = $matches[2]
    }
}
$AdminPassword = $EnvConfig["ADMIN_PASSWORD"]
$ApiBaseUrl = $EnvConfig["API_BASE_URL"]
if (-not $AdminPassword -or -not $ApiBaseUrl) {
    Write-ErrorLog "ADMIN_PASSWORD or API_BASE_URL missing from .env"
    exit 1
}
$ApiBaseUrl = $ApiBaseUrl.TrimEnd("/")
$Headers = @{ "x-admin-password" = $AdminPassword; "Content-Type" = "application/json" }

try {
    # ── System resources ───────────────────────────────────────────────
    $cpuPercent = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average

    $os = Get-CimInstance Win32_OperatingSystem
    $memPercent = [math]::Round((1 - ($os.FreePhysicalMemory / $os.TotalVisibleMemorySize)) * 100, 1)

    $disks = @()
    Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
        if ($_.Size -gt 0) {
            $disks += @{
                drive        = $_.DeviceID
                percentUsed  = [math]::Round((1 - ($_.FreeSpace / $_.Size)) * 100, 1)
                freeGb       = [math]::Round($_.FreeSpace / 1GB, 1)
                totalGb      = [math]::Round($_.Size / 1GB, 1)
            }
        }
    }

    # ── Docker container health ────────────────────────────────────────
    # Health status is parsed out of the Status string (e.g. "Up 3 hours
    # (healthy)") rather than a separate `docker inspect` call per
    # container -- avoids N extra subprocesses on hosts with many containers.
    $containers = @()
    $dockerAvailable = $true
    try {
        # Backtick, not backslash, escapes a double quote inside a PowerShell
        # double-quoted string -- backslash isn't a PS escape character, so a
        # literal \" here would break the Go template's `"com.docker.compose.project"` syntax.
        $psLines = @(docker ps -a --format "{{.Names}}||{{.Status}}||{{.Label `"com.docker.compose.project`"}}" 2>$null)
        if ($LASTEXITCODE -ne 0) { $dockerAvailable = $false }
    } catch {
        $dockerAvailable = $false
    }
    if ($dockerAvailable -and $psLines) {
        foreach ($line in $psLines) {
            $parts = $line -split '\|\|'
            if ($parts.Count -lt 2) { continue }
            $status = $parts[1]
            $health = $null
            if ($status -match '\((healthy|unhealthy|starting)\)') { $health = $matches[1] }
            $containers += @{
                name    = $parts[0]
                project = if ($parts.Count -ge 3 -and $parts[2]) { $parts[2] } else { $null }
                status  = $status
                health  = $health
            }
        }
    }

    # ── Scheduled task results ─────────────────────────────────────────
    $scheduledTasks = @()
    $seenTaskNames = @{}
    foreach ($pattern in $TaskNamePatterns) {
        Get-ScheduledTask | Where-Object { $_.TaskName -like $pattern } | ForEach-Object {
            if (-not $seenTaskNames.ContainsKey($_.TaskName)) {
                $seenTaskNames[$_.TaskName] = $true
                $info = Get-ScheduledTaskInfo -TaskName $_.TaskName -TaskPath $_.TaskPath
                $scheduledTasks += @{
                    name           = $_.TaskName
                    lastRunTime    = if ($info.LastRunTime) { $info.LastRunTime.ToString("o") } else { $null }
                    lastTaskResult = if ($null -ne $info.LastTaskResult) { [int]$info.LastTaskResult } else { $null }
                }
            }
        }
    }

    # ── Push snapshot (everything above succeeded, so this is safe to send) ──
    $snapshot = @{
        cpuPercent     = $cpuPercent
        memPercent     = $memPercent
        disks          = $disks
        containers     = $containers
        scheduledTasks = $scheduledTasks
    }
    Invoke-RestMethod -Uri "$ApiBaseUrl/api/admin/hermes-status" -Method Post -Headers $Headers -Body ($snapshot | ConvertTo-Json -Depth 6) | Out-Null
}
catch {
    Write-ErrorLog "Status snapshot collection/POST failed: $_"
    exit 1
}

# ── Recent activity: tail update.log files, POST new lines only ─────────
# Failure here is non-fatal per-file (one unreadable log shouldn't block
# the others or the snapshot above, which has already been sent).
$cursor = @{}
if (Test-Path $CursorPath) {
    # -AsHashtable needs PowerShell 6+; this host runs Windows PowerShell 5.1
    # (same as update.ps1 etc.), so convert the parsed PSCustomObject by hand.
    try {
        $parsed = Get-Content $CursorPath -Raw | ConvertFrom-Json
        foreach ($prop in $parsed.PSObject.Properties) { $cursor[$prop.Name] = $prop.Value }
    } catch {
        $cursor = @{}
    }
}

foreach ($source in $UpdateLogPaths.Keys) {
    $logPath = $UpdateLogPaths[$source]
    if (-not (Test-Path $logPath)) { continue }
    try {
        # @(...) forces an array even when the file has exactly one line --
        # Get-Content otherwise returns a bare string for a single-line file,
        # which has no reliable .Count/range-slicing behavior.
        $lines = @(Get-Content $logPath)
        $alreadySeen = if ($cursor.ContainsKey($source)) { [int]$cursor[$source] } else { 0 }
        if ($lines.Count -le $alreadySeen) { continue }

        $newLines = $lines[$alreadySeen..($lines.Count - 1)]
        foreach ($line in $newLines) {
            # update.ps1 writes: "yyyy-MM-dd HH:mm:ss | Ns | Done"
            $occurredAt = $null
            if ($line -match '^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})') {
                $occurredAt = [datetime]::ParseExact($matches[1], "yyyy-MM-dd HH:mm:ss", $null).ToString("o")
            }
            $body = @{ source = $source; message = "已更新部署 ($line)"; occurredAt = $occurredAt } | ConvertTo-Json
            try {
                Invoke-RestMethod -Uri "$ApiBaseUrl/api/admin/hermes-activity" -Method Post -Headers $Headers -Body $body | Out-Null
            } catch {
                Write-ErrorLog "Activity POST failed for $source : $_"
            }
        }
        $cursor[$source] = $lines.Count
    } catch {
        Write-ErrorLog "Reading $logPath failed: $_"
    }
}

($cursor | ConvertTo-Json) | Set-Content -Path $CursorPath -Encoding UTF8
